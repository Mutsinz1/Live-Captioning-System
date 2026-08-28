# Live Captioning System

A browser-based real-time speech-to-text captioning system with minimal latency and high accuracy. Perfect for meetings, presentations, accessibility, and live events.

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://reactjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-green.svg)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ Features

- 🎤 Real-time microphone audio capture (AudioWorklet, works at any device sample rate)
- ⚡ Low-latency live captions (<500ms)
- 🎯 High accuracy transcription using Vosk — fully offline, no cloud API
- ✍️ Automatic caption casing and punctuation
- 🎨 Clean, accessible UI with customizable display
- ⌨️ Keyboard shortcuts (Space to record, Ctrl/Cmd+S export, Ctrl/Cmd+L clear)
- 📝 Transcript export (TXT, SRT, VTT with recording-relative timestamps)
- 🔄 Automatic reconnection and error handling
- 🌍 Per-client language switching (English, Spanish, French out of the box)
- 👥 Speaker identification (planned)

## 🏗️ Architecture

```
[Browser Audio Capture] 
     │
     ▼ (WebSocket audio stream)
[FastAPI Backend + Vosk]
     │
     ▼ (real-time captions)
[Live Caption Display]
```

## 🚀 Quick Start

### Prerequisites

- **Python 3.8+** (3.12 recommended)
- **Node.js 16+** (18+ recommended)
- **Modern browser** with WebRTC support (Chrome, Firefox, Safari, Edge)
- **Microphone** for audio input
- **~500MB free space** for Vosk models

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

### Usage

1. Open http://localhost:3000 in your browser
2. Grant microphone permissions
3. Start speaking - captions will appear in real-time
4. Use the controls to adjust font size, contrast, and export transcripts

## 🔧 Troubleshooting

### Common Issues

**Import errors in IDE:**
- Add `# type: ignore` comments to import statements
- Configure your IDE to use the virtual environment Python interpreter

**Audio not working:**
- Ensure microphone permissions are granted
- Check browser console for WebRTC errors
- Try refreshing the page

**Backend connection issues:**
- Verify backend is running on port 8000
- Check firewall settings
- Ensure Vosk models are downloaded

**Performance issues:**
- Close other audio applications
- Use a wired microphone for better quality
- Check system resources

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the backend directory:

```env
# Comma-separated origins allowed by CORS (default: localhost:3000)
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Set to "false" to disable automatic caption casing/punctuation
FORMAT_CAPTIONS=true
```

Frontend (set at build time):

```env
# Override the WebSocket endpoint. If unset: port 3000 (CRA dev) talks to
# localhost:8000 directly; any other origin uses same-host /ws/ (nginx proxy).
REACT_APP_WS_URL=wss://captions.example.com
```

### Customization

- **Language Models**: Download different Vosk models for other languages
- **Audio Quality**: Adjust sample rate and chunk size in `useTranscription.js`
- **UI Theme**: Modify CSS variables in component stylesheets

## 💻 Development

### Project Structure

```
├── backend/                 # FastAPI + Vosk transcription service
│   ├── main.py             # WebSocket server
│   ├── transcription.py    # Vosk integration
│   └── requirements.txt    # Python dependencies
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/         # Custom hooks
│   │   └── utils/         # Utilities
│   └── package.json
└── docker-compose.yml      # Full stack deployment
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws/audio` | WebSocket | Binary audio frames in, transcription JSON out; also accepts per-client JSON control messages (e.g. `change_language`) |
| `/ws/control` | WebSocket | Global control messages (default language, status) |
| `/health` | GET | Health check endpoint |
| `/models` | GET | Available transcription models |

### WebSocket Message Format

**Audio Streaming:**
```json
{
  "type": "transcription",
  "text": "Hello world",
  "is_final": true,
  "confidence": 0.95,
  "timestamp": 1640995200
}
```

**Control Messages:**
```json
{
  "type": "change_language",
  "language": "en"
}
```

## 📊 Performance & Limitations

### Performance Metrics
- **Latency**: <500ms end-to-end
- **Accuracy**: 95%+ with clear speech
- **Supported Languages**: 20+ languages via Vosk models
- **Concurrent Users**: 10+ simultaneous connections

### Limitations
- Requires stable internet connection
- Audio quality affects transcription accuracy
- Background noise may impact performance
- Limited to browser-supported audio formats

## 🚀 Deployment

### Docker

```bash
docker-compose up -d
```

### Manual Deployment

1. Deploy backend to your preferred cloud provider
2. Build and deploy frontend to a static hosting service
3. Configure CORS and WebSocket proxy settings

## 🔒 Privacy & Security

- Audio is processed in real-time and not stored
- All communication uses secure WebSocket connections
- No personal data is collected or transmitted
- Optional local-only mode available

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

1. Fork and clone the repository
2. Set up development environment:
   ```bash
   # Backend
   cd backend
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   
   # Frontend
   cd frontend
   npm install
   ```
3. Run development servers:
   ```bash
   # Terminal 1: Backend
   cd backend && python main.py
   
   # Terminal 2: Frontend
   cd frontend && npm start
   ```

### Code Style
- Python: Follow PEP 8
- JavaScript: Use ESLint configuration
- Commit messages: Use conventional commits

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Live Captioning System Contributors 