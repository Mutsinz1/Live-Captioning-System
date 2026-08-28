import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Set

import uvicorn  # type: ignore


# type: ignore
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore

from transcription import TranscriptionService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global state
active_connections: Set[WebSocket] = set()
transcription_service = TranscriptionService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle (replaces deprecated @app.on_event)"""
    try:
        await transcription_service.initialize()
        logger.info("Transcription service initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize transcription service: {e}")
        raise
    yield
    await transcription_service.cleanup()
    logger.info("Transcription service cleaned up")


app = FastAPI(title="Live Captioning API", version="1.0.0", lifespan=lifespan)

# CORS middleware for frontend communication.
# Override with a comma-separated CORS_ORIGINS env var when deploying behind
# a proxy or on a non-localhost host, e.g.:
#   CORS_ORIGINS=https://captions.example.com,http://localhost:3000
cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "live-captioning"}

@app.get("/models")
async def get_available_models():
    """Get available transcription models"""
    try:
        models = await transcription_service.get_available_models()
        return {"models": models}
    except Exception as e:
        logger.error(f"Error getting models: {e}")
        raise HTTPException(status_code=500, detail="Failed to get models")

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time audio streaming and transcription"""
    await websocket.accept()
    active_connections.add(websocket)
    
    client_id = id(websocket)
    logger.info(f"Client {client_id} connected")
    
    try:
        # Initialize transcription session for this client
        await transcription_service.start_session(client_id)

        while True:
            # The audio socket carries binary audio frames AND per-client JSON
            # control messages (e.g. language changes), so the change applies
            # to THIS client's session only.
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))

            if message.get("bytes") is not None:
                # Process audio chunk and get transcription
                try:
                    transcription_result = await transcription_service.process_audio(
                        client_id, message["bytes"]
                    )

                    if transcription_result:
                        # Send transcription back to client
                        response = {
                            "type": "transcription",
                            "text": transcription_result["text"],
                            "is_final": transcription_result["is_final"],
                            "confidence": transcription_result.get("confidence", 0.0),
                            "timestamp": transcription_result.get("timestamp")
                        }

                        await websocket.send_text(json.dumps(response))

                except Exception as e:
                    logger.error(f"Error processing audio for client {client_id}: {e}")
                    error_response = {
                        "type": "error",
                        "message": "Failed to process audio"
                    }
                    await websocket.send_text(json.dumps(error_response))

            elif message.get("text") is not None:
                # Per-client control message
                try:
                    control = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                if control.get("type") == "stop_recording":
                    # Vosk only finalises on detected silence, so a client that
                    # stops mid-utterance would leave its last sentence as a
                    # partial — and exports only include final captions.
                    final = await transcription_service.flush(client_id)
                    if final:
                        await websocket.send_text(json.dumps({
                            "type": "transcription",
                            "text": final["text"],
                            "is_final": True,
                            "confidence": final["confidence"],
                            "timestamp": final["timestamp"],
                        }))

                elif control.get("type") == "change_language":
                    language = control.get("language", "en")
                    try:
                        await transcription_service.set_session_language(
                            client_id, language
                        )
                        await websocket.send_text(json.dumps({
                            "type": "language_changed",
                            "language": language
                        }))
                    except Exception as e:
                        logger.error(
                            f"Language change failed for client {client_id}: {e}"
                        )
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Failed to switch language to '{language}'. "
                                       "Is the model downloaded?"
                        }))
                
    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for client {client_id}: {e}")
    finally:
        # Cleanup
        active_connections.discard(websocket)
        await transcription_service.end_session(client_id)
        logger.info(f"Client {client_id} session ended")

@app.websocket("/ws/control")
async def websocket_control_endpoint(websocket: WebSocket):
    """WebSocket endpoint for control messages (language change, settings, etc.)"""
    await websocket.accept()
    
    try:
        while True:
            # Receive control messages from client
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                # A malformed frame should not tear down the control channel
                logger.warning("Ignoring malformed control message")
                continue

            if message.get("type") == "change_language":
                language = message.get("language", "en")
                await transcription_service.change_language(language)
                response = {"type": "language_changed", "language": language}
                await websocket.send_text(json.dumps(response))
                
            elif message.get("type") == "get_status":
                status = await transcription_service.get_status()
                response = {"type": "status", "status": status}
                await websocket.send_text(json.dumps(response))
                
    except WebSocketDisconnect:
        logger.info("Control client disconnected")
    except Exception as e:
        logger.error(f"Control WebSocket error: {e}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    ) 