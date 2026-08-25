import asyncio
import json
import logging
import os
from typing import Dict, Set

import uvicorn  # type: ignore


# type: ignore
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore
import numpy as np

from transcription import TranscriptionService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Live Captioning API", version="1.0.0")

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

# Global state
active_connections: Set[WebSocket] = set()
transcription_service = TranscriptionService()

@app.on_event("startup")
async def startup_event():
    """Initialize transcription service on startup"""
    try:
        await transcription_service.initialize()
        logger.info("Transcription service initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize transcription service: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    await transcription_service.cleanup()
    logger.info("Transcription service cleaned up")

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
            # Receive audio data from client
            data = await websocket.receive_bytes()
            
            # Process audio chunk and get transcription
            try:
                transcription_result = await transcription_service.process_audio(
                    client_id, data
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
            message = json.loads(data)
            
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