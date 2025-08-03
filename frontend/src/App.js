import React, { useState, useEffect } from 'react';
import './App.css';
import AudioCapture from './components/AudioCapture';
import CaptionDisplay from './components/CaptionDisplay';
import ControlPanel from './components/ControlPanel';
import StatusIndicator from './components/StatusIndicator';
import { useTranscription } from './hooks/useTranscription';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [settings, setSettings] = useState({
    fontSize: 24,
    highContrast: false,
    language: 'en',
    autoScroll: true
  });

  const {
    captions,
    isConnected,
    error,
    startTranscription,
    stopTranscription,
    clearCaptions,
    exportTranscript
  } = useTranscription();

  const handleStartRecording = async () => {
    try {
      await startTranscription();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const handleStopRecording = () => {
    stopTranscription();
    setIsRecording(false);
  };

  const handleSettingsChange = (newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const handleExport = (format) => {
    exportTranscript(format);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Live Captioning System</h1>
        <StatusIndicator 
          isConnected={isConnected} 
          isRecording={isRecording}
          error={error}
        />
      </header>

      <main className="App-main">
        <div className="caption-container">
          <CaptionDisplay 
            captions={captions}
            settings={settings}
          />
        </div>

        <div className="control-container">
          <AudioCapture
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            isConnected={isConnected}
          />

          <ControlPanel
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onExport={handleExport}
            onClear={clearCaptions}
            captionsCount={captions.length}
          />
        </div>
      </main>

      <footer className="App-footer">
        <p>
          Real-time speech-to-text captioning with minimal latency
        </p>
        <p>
          Powered by Vosk • Built with React & FastAPI
        </p>
      </footer>
    </div>
  );
}

export default App; 