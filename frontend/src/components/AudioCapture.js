import React, { useState } from 'react';
import './AudioCapture.css';

// Presentational component: the microphone stream, permission state and audio
// level all live in the useTranscription hook so only ONE stream is opened.
const AudioCapture = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onRequestPermission,
  isConnected,
  hasPermission,
  isRequesting,
  audioLevel
}) => {
  const [error, setError] = useState(null);

  const handleRequestPermission = async () => {
    setError(null);
    try {
      await onRequestPermission();
    } catch (err) {
      console.error('Microphone permission denied:', err);
      setError('Microphone access denied. Please allow microphone permissions and try again.');
    }
  };

  const handleStartRecording = async () => {
    if (!hasPermission) {
      await handleRequestPermission();
      return;
    }

    if (!isConnected) {
      setError('Not connected to transcription service. Please check your connection.');
      return;
    }

    try {
      await onStartRecording();
      setError(null);
    } catch (err) {
      setError('Failed to start recording. Please try again.');
    }
  };

  const handleStopRecording = () => {
    onStopRecording();
    setError(null);
  };

  const getAudioLevelColor = () => {
    if (audioLevel < 30) return '#4CAF50'; // Green
    if (audioLevel < 60) return '#FF9800'; // Orange
    return '#F44336'; // Red
  };

  return (
    <div className="audio-capture">
      <div className="audio-capture-header">
        <h3>Audio Capture</h3>
        <div className="audio-level-meter">
          <div
            className="audio-level-bar"
            style={{
              width: `${Math.min(audioLevel * 2, 100)}%`,
              backgroundColor: getAudioLevelColor()
            }}
          />
        </div>
      </div>

      <div className="audio-capture-controls">
        {!hasPermission && (
          <button
            className="btn btn-primary"
            onClick={handleRequestPermission}
            disabled={isRequesting}
          >
            {isRequesting ? 'Requesting...' : 'Enable Microphone'}
          </button>
        )}

        {hasPermission && (
          <>
            {!isRecording ? (
              <button
                className="btn btn-success"
                onClick={handleStartRecording}
                disabled={!isConnected}
              >
                <span className="btn-icon">🎤</span>
                Start Recording
              </button>
            ) : (
              <button
                className="btn btn-danger"
                onClick={handleStopRecording}
              >
                <span className="btn-icon">⏹️</span>
                Stop Recording
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="error-message" role="alert">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      <div className="audio-status">
        <div className="status-item">
          <span className="status-label">Microphone:</span>
          <span className={`status-value ${hasPermission ? 'status-success' : 'status-error'}`}>
            {hasPermission ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Service:</span>
          <span className={`status-value ${isConnected ? 'status-success' : 'status-error'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Recording:</span>
          <span className={`status-value ${isRecording ? 'status-recording' : 'status-idle'}`}>
            {isRecording ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {!isConnected && (
        <div className="connection-warning">
          <p>⚠️ Please ensure the backend service is running</p>
        </div>
      )}
    </div>
  );
};

export default AudioCapture;
