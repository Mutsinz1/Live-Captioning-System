import asyncio
import json
import logging
import os
import time
from collections import deque
from typing import Dict, List, Optional, Any
import numpy as np
from vosk import Model, KaldiRecognizer

from formatting import format_caption, formatting_enabled

# Cap on transcriptions retained per session. A caption every few seconds over
# a multi-hour session would otherwise grow without bound; the client keeps the
# authoritative transcript for export.
MAX_SESSION_TRANSCRIPTIONS = int(os.environ.get("MAX_SESSION_TRANSCRIPTIONS", "10000"))

logger = logging.getLogger(__name__)

class TranscriptionService:
    """Service for handling real-time speech transcription using Vosk"""
    
    def __init__(self):
        self.models: Dict[str, Model] = {}  # language -> loaded model (cached)
        # One lock per language so concurrent first-use of the same model
        # loads it once instead of every caller reading it from disk.
        self._model_locks: Dict[str, asyncio.Lock] = {}
        self.recognizers: Dict[int, KaldiRecognizer] = {}
        self.sessions: Dict[int, Dict[str, Any]] = {}
        self.default_language = "en"
        self.sample_rate = 16000
        self.chunk_size = 8000  # 0.5 seconds at 16kHz
        
        # Available models (you'll need to download these)
        self.available_models = {
            "en": {
                "name": "vosk-model-small-en-us-0.15",
                "url": "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
                "size": "42MB"
            },
            "es": {
                "name": "vosk-model-small-es-0.42",
                "url": "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip",
                "size": "42MB"
            },
            "fr": {
                "name": "vosk-model-small-fr-0.22",
                "url": "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
                "size": "42MB"
            }
        }
    
    async def initialize(self):
        """Initialize the transcription service and load the default model"""
        try:
            # Set up model directory
            model_dir = os.path.join(os.path.dirname(__file__), "models")
            os.makedirs(model_dir, exist_ok=True)
            
            # Load the default language model
            await self.load_model(self.default_language)
            logger.info("Transcription service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize transcription service: {e}")
            raise
    
    async def load_model(self, language: str) -> Model:
        """Load (or fetch from cache) the Vosk model for a language"""
        if language not in self.available_models:
            raise ValueError(f"Language {language} not supported")

        # Cached — no disk I/O, no reload
        if language in self.models:
            return self.models[language]

        lock = self._model_locks.setdefault(language, asyncio.Lock())
        async with lock:
            # Another caller may have loaded it while we waited for the lock.
            if language in self.models:
                return self.models[language]
            return await self._load_model_locked(language)

    async def _load_model_locked(self, language: str) -> Model:
        model_info = self.available_models[language]
        model_name = model_info["name"]
        model_path = os.path.join(os.path.dirname(__file__), "models", model_name)

        # Check if model exists, if not, provide instructions
        if not os.path.exists(model_path):
            logger.warning(f"Model {model_name} not found at {model_path}")
            logger.info(f"Please download the model from: {model_info['url']}")
            logger.info(f"Extract it to: {model_path}")
            raise FileNotFoundError(f"Model not found. Please download {model_name}")

        try:
            # Model loading reads hundreds of MB from disk — keep it off the
            # event loop so health checks and other clients stay responsive.
            loop = asyncio.get_running_loop()
            model = await loop.run_in_executor(None, Model, model_path)
            self.models[language] = model
            logger.info(f"Loaded model for language: {language}")
            return model

        except Exception as e:
            logger.error(f"Failed to load model for language {language}: {e}")
            raise

    def _make_recognizer(self, model: Model) -> KaldiRecognizer:
        """Create a recognizer with word-level results enabled"""
        recognizer = KaldiRecognizer(model, self.sample_rate)
        recognizer.SetWords(True)
        return recognizer
    
    async def start_session(self, client_id: int, language: Optional[str] = None):
        """Start a new transcription session for a client"""
        try:
            lang = language or self.default_language
            model = await self.load_model(lang)

            # Create recognizer for this client
            self.recognizers[client_id] = self._make_recognizer(model)

            # Initialize session data
            self.sessions[client_id] = {
                "start_time": time.time(),
                "transcriptions": deque(maxlen=MAX_SESSION_TRANSCRIPTIONS),
                "language": lang
            }
            
            logger.info(f"Started transcription session for client {client_id}")
            
        except Exception as e:
            logger.error(f"Failed to start session for client {client_id}: {e}")
            raise
    
    async def end_session(self, client_id: int):
        """End a transcription session for a client"""
        try:
            # Clean up recognizer
            if client_id in self.recognizers:
                del self.recognizers[client_id]
            
            # Clean up session data
            if client_id in self.sessions:
                del self.sessions[client_id]
            
            logger.info(f"Ended transcription session for client {client_id}")
            
        except Exception as e:
            logger.error(f"Error ending session for client {client_id}: {e}")
    
    async def process_audio(self, client_id: int, audio_data: bytes) -> Optional[Dict[str, Any]]:
        """Process audio chunk and return transcription result"""
        try:
            if client_id not in self.recognizers:
                logger.error(f"No recognizer found for client {client_id}")
                return None
            
            recognizer = self.recognizers[client_id]

            # Vosk's AcceptWaveform is CPU-heavy and synchronous — run it in a
            # thread so one client's audio doesn't block the event loop for all
            # other connected clients.
            loop = asyncio.get_running_loop()
            accepted = await loop.run_in_executor(
                None, recognizer.AcceptWaveform, audio_data
            )

            if accepted:
                # Final result
                result = json.loads(recognizer.Result())
                text = result.get("text", "").strip()

                if text:
                    # With SetWords(True), Vosk returns per-word confidence in
                    # result["result"]; average it for a caption-level score.
                    words = result.get("result", [])
                    if words:
                        confidence = sum(w.get("conf", 0.0) for w in words) / len(words)
                    else:
                        confidence = 0.0

                    session = self.sessions.get(client_id)
                    if formatting_enabled():
                        text = format_caption(
                            text,
                            language=session["language"] if session else "en",
                            # Vosk segments on silence, not sentence ends, so
                            # only the very first caption starts a sentence.
                            is_sentence_start=not (session and session["transcriptions"]),
                        )

                    transcription = {
                        "text": text,
                        "is_final": True,
                        "confidence": confidence,
                        "timestamp": time.time()
                    }

                    # Store transcription (session may have ended while the
                    # recognizer ran in the executor)
                    if session is not None:
                        session["transcriptions"].append(transcription)

                    return transcription

            else:
                # Partial result
                result = json.loads(recognizer.PartialResult())
                text = result.get("partial", "").strip()

                if text:
                    session = self.sessions.get(client_id)
                    if formatting_enabled():
                        text = format_caption(
                            text,
                            language=session["language"] if session else "en",
                            is_sentence_start=not (session and session["transcriptions"]),
                        )

                    return {
                        "text": text,
                        "is_final": False,
                        "confidence": 0.0,  # Vosk doesn't provide confidence for partial results
                        "timestamp": time.time()
                    }
            
            return None
            
        except Exception as e:
            logger.error(f"Error processing audio for client {client_id}: {e}")
            return None
    
    async def set_session_language(self, client_id: int, language: str):
        """Change the transcription language for ONE client's session"""
        try:
            if client_id not in self.sessions:
                raise KeyError(f"No session for client {client_id}")

            model = await self.load_model(language)
            self.sessions[client_id]["language"] = language
            self.recognizers[client_id] = self._make_recognizer(model)
            logger.info(f"Client {client_id} language changed to {language}")

        except Exception as e:
            logger.error(
                f"Failed to change language to {language} for client {client_id}: {e}"
            )
            raise

    async def change_language(self, language: str):
        """Set the DEFAULT language that NEW sessions start in.

        Exposed on the global /ws/control channel. It deliberately leaves
        already-running sessions alone: language is per-client state (see
        set_session_language), so rewriting live sessions from here would
        switch every other connected user's captions mid-stream.
        """
        try:
            await self.load_model(language)
            self.default_language = language
            logger.info(f"Default language for new sessions changed to {language}")

        except Exception as e:
            logger.error(f"Failed to change default language to {language}: {e}")
            raise
    
    async def get_available_models(self) -> List[Dict[str, str]]:
        """Get list of available transcription models"""
        models = []
        model_dir = os.path.join(os.path.dirname(__file__), "models")
        
        for lang, info in self.available_models.items():
            model_path = os.path.join(model_dir, info["name"])
            models.append({
                "language": lang,
                "name": info["name"],
                "url": info["url"],
                "size": info["size"],
                "installed": os.path.exists(model_path)
            })
        
        return models
    
    async def get_status(self) -> Dict[str, Any]:
        """Get current service status"""
        return {
            "default_language": self.default_language,
            "loaded_languages": sorted(self.models.keys()),
            "active_sessions": len(self.sessions),
            "session_languages": {
                str(cid): s["language"] for cid, s in self.sessions.items()
            },
            "sample_rate": self.sample_rate
        }
    
    async def get_session_transcript(self, client_id: int) -> List[Dict[str, Any]]:
        """Get complete transcript for a session"""
        if client_id not in self.sessions:
            return []
        
        return list(self.sessions[client_id]["transcriptions"])
    
    async def cleanup(self):
        """Clean up resources"""
        try:
            self.recognizers.clear()
            self.sessions.clear()
            self.models.clear()
            logger.info("Transcription service cleaned up")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

# Utility functions for audio processing
def convert_audio_format(audio_data: bytes, from_format: str, to_format: str) -> bytes:
    """Convert audio between different formats"""
    # This is a placeholder - implement actual audio conversion as needed
    return audio_data

def detect_silence(audio_data: bytes, threshold: float = 0.01) -> bool:
    """Detect if an audio chunk is mostly silence.

    threshold is on the normalised -1.0..1.0 scale, so int16 samples must be
    scaled before comparing. Measuring RMS on raw int16 (peak 32768) against a
    0.01 threshold made this return False for everything but digital silence.
    """
    try:
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        if audio_array.size == 0:
            return True
        normalized = audio_array.astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(normalized ** 2)))
        return rms < threshold
    except (ValueError, TypeError):
        # e.g. a byte count that is not a whole number of int16 samples
        return False 