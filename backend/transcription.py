import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional, Any
import numpy as np
from vosk import Model, KaldiRecognizer
import wave

logger = logging.getLogger(__name__)

class TranscriptionService:
    """Service for handling real-time speech transcription using Vosk"""
    
    def __init__(self):
        self.model: Optional[Model] = None
        self.recognizers: Dict[int, KaldiRecognizer] = {}
        self.sessions: Dict[int, Dict[str, Any]] = {}
        self.current_language = "en"
        self.model_path = None
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
            
            # Load default English model
            await self.load_model("en")
            logger.info("Transcription service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize transcription service: {e}")
            raise
    
    async def load_model(self, language: str):
        """Load a Vosk model for the specified language"""
        if language not in self.available_models:
            raise ValueError(f"Language {language} not supported")
        
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
            self.model = await loop.run_in_executor(None, Model, model_path)
            self.current_language = language
            self.model_path = model_path
            logger.info(f"Loaded model for language: {language}")
            
        except Exception as e:
            logger.error(f"Failed to load model for language {language}: {e}")
            raise
    
    async def start_session(self, client_id: int):
        """Start a new transcription session for a client"""
        try:
            if self.model is None:
                raise RuntimeError("No model loaded")
            
            # Create recognizer for this client
            recognizer = KaldiRecognizer(self.model, self.sample_rate)
            recognizer.SetWords(True)  # Enable word-level results for real confidence scores
            self.recognizers[client_id] = recognizer

            # Initialize session data
            self.sessions[client_id] = {
                "start_time": time.time(),
                "transcriptions": [],
                "language": self.current_language
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

                    transcription = {
                        "text": text,
                        "is_final": True,
                        "confidence": confidence,
                        "timestamp": time.time()
                    }

                    # Store transcription
                    self.sessions[client_id]["transcriptions"].append(transcription)

                    return transcription

            else:
                # Partial result
                result = json.loads(recognizer.PartialResult())
                text = result.get("partial", "").strip()
                
                if text:
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
    
    async def change_language(self, language: str):
        """Change the transcription language"""
        try:
            await self.load_model(language)
            
            # Update all active sessions
            for client_id in self.sessions:
                self.sessions[client_id]["language"] = language
                
                # Recreate recognizer with new model
                if client_id in self.recognizers:
                    recognizer = KaldiRecognizer(self.model, self.sample_rate)
                    recognizer.SetWords(True)
                    self.recognizers[client_id] = recognizer
            
            logger.info(f"Changed language to {language}")
            
        except Exception as e:
            logger.error(f"Failed to change language to {language}: {e}")
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
            "current_language": self.current_language,
            "model_loaded": self.model is not None,
            "active_sessions": len(self.sessions),
            "sample_rate": self.sample_rate
        }
    
    async def get_session_transcript(self, client_id: int) -> List[Dict[str, Any]]:
        """Get complete transcript for a session"""
        if client_id not in self.sessions:
            return []
        
        return self.sessions[client_id]["transcriptions"]
    
    async def cleanup(self):
        """Clean up resources"""
        try:
            self.recognizers.clear()
            self.sessions.clear()
            self.model = None
            logger.info("Transcription service cleaned up")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

# Utility functions for audio processing
def convert_audio_format(audio_data: bytes, from_format: str, to_format: str) -> bytes:
    """Convert audio between different formats"""
    # This is a placeholder - implement actual audio conversion as needed
    return audio_data

def detect_silence(audio_data: bytes, threshold: float = 0.01) -> bool:
    """Detect if audio chunk is mostly silence"""
    try:
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        rms = np.sqrt(np.mean(audio_array.astype(np.float32) ** 2))
        return rms < threshold
    except:
        return False 