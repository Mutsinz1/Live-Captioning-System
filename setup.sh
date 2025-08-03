#!/bin/bash

# Live Captioning System Setup Script
echo "🎤 Setting up Live Captioning System..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed. Please install Python 3.8+ and try again."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed. Please install npm and try again."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Create virtual environment for backend
echo "🐍 Setting up Python backend..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create models directory
mkdir -p models

echo "📥 Downloading Vosk models..."
echo "Please download the following models manually:"
echo "1. English: https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
echo "2. Extract to: backend/models/vosk-model-small-en-us-0.15/"
echo ""
echo "Optional models:"
echo "- Spanish: https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
echo "- French: https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip"
echo ""

cd ..

# Install frontend dependencies
echo "⚛️ Setting up React frontend..."
cd frontend
npm install
cd ..

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To start the application:"
echo ""
echo "1. Start the backend:"
echo "   cd backend"
echo "   source venv/bin/activate"
echo "   python main.py"
echo ""
echo "2. In a new terminal, start the frontend:"
echo "   cd frontend"
echo "   npm start"
echo ""
echo "3. Open http://localhost:3000 in your browser"
echo ""
echo "Or use Docker:"
echo "   docker-compose up -d"
echo ""
echo "📝 Note: Make sure to download the Vosk models before running the application!" 