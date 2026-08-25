import React, { useState, useEffect, useCallback } from 'react';
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
    hasPermission,
    isRequestingPermission,
    audioLevel,
    requestPermission,
    changeLanguage,
    startTranscription,
    stopTranscription,
    clearCaptions,
    exportTranscript
  } = useTranscription();

  const handleStartRecording = useCallback(async () => {
    try {
      await startTranscription();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, [startTranscription]);

  const handleStopRecording = useCallback(() => {
    stopTranscription();
    setIsRecording(false);
  }, [stopTranscription]);

  const handleSettingsChange = (newSettings) => {
    // Propagate language changes to the backend over the control WebSocket
    if (newSettings.language && newSettings.language !== settings.language) {
      changeLanguage(newSettings.language);
    }
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const handleExport = useCallback((format) => {
    exportTranscript(format);
  }, [exportTranscript]);

  // Keyboard shortcuts advertised in the ControlPanel:
  //   Space           -> start/stop recording
  //   Ctrl/Cmd + S    -> export transcript (TXT)
  //   Ctrl/Cmd + L    -> clear all captions
  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (isRecording) {
          handleStopRecording();
        } else {
          handleStartRecording();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleExport('txt');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        clearCaptions();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, handleStartRecording, handleStopRecording, handleExport, clearCaptions]);

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
            onRequestPermission={requestPermission}
            isConnected={isConnected}
            hasPermission={hasPermission}
            isRequesting={isRequestingPermission}
            audioLevel={audioLevel}
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
