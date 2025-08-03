#!/usr/bin/env python3
"""
Simple runner script for the Live Captioning Backend
This script ensures all dependencies are available before starting the server.
"""

import sys
import subprocess
import os

def check_dependencies():
    """Check if all required dependencies are installed"""
    required_packages = [
        'fastapi',
        'uvicorn',
        'websockets', 
        'vosk',
        'numpy'
    ]
    
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
            print(f"✅ {package} is available")
        except ImportError:
            missing_packages.append(package)
            print(f"❌ {package} is missing")
    
    if missing_packages:
        print(f"\n❌ Missing packages: {', '.join(missing_packages)}")
        print("Please install them with:")
        print("pip install -r requirements.txt")
        return False
    
    return True

def check_vosk_model():
    """Check if Vosk model is available"""
    model_path = "models/vosk-model-small-en-us-0.15"
    if os.path.exists(model_path):
        print(f"✅ Vosk model found at {model_path}")
        return True
    else:
        print(f"❌ Vosk model not found at {model_path}")
        print("Please download the model from:")
        print("https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip")
        print("And extract it to the models/ directory")
        return False

def main():
    print("🎤 Live Captioning Backend - Dependency Check")
    print("=" * 50)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Check Vosk model
    if not check_vosk_model():
        sys.exit(1)
    
    print("\n✅ All checks passed! Starting server...")
    print("=" * 50)
    
    # Import and run the main application
    try:
        from main import app
        import uvicorn
        
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8000,
            log_level="info"
        )
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 