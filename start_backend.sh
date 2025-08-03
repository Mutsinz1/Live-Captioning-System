#!/bin/bash

echo "🎤 Starting Live Captioning Backend..."

# Check if we're in the right directory
if [ ! -f "backend/main.py" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Navigate to backend directory
cd backend

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Please run setup.sh first"
    exit 1
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Check if uvicorn is available
if ! python -c "import uvicorn" 2>/dev/null; then
    echo "❌ uvicorn not found. Installing dependencies..."
    pip install -r requirements.txt
fi

# Start the server
echo "🚀 Starting server on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""

python run.py 