import React, { useState, useRef, useEffect } from 'react';
import './AudioCapture.css';

const AudioCapture = ({ isRecording, onStartRecording, onStopRecording, isConnected }) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const requestMicrophonePermission = async () => {
    setIsRequesting(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
      });

      mediaStreamRef.current = stream;
      setHasPermission(true);

      // Set up audio analysis for level meter
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // Start audio level monitoring
      updateAudioLevel();

    } catch (err) {
      console.error('Microphone permission denied:', err);
      setError('Microphone access denied. Please allow microphone permissions and try again.');
      setHasPermission(false);
    } finally {
      setIsRequesting(false);
    }
  };

  const updateAudioLevel = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume level
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    setAudioLevel(average);

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  };

  const handleStartRecording = async () => {
    if (!hasPermission) {
      await requestMicrophonePermission();
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
        {!hasPermission && !isRequesting && (
          <button
            className="btn btn-primary"
            onClick={requestMicrophonePermission}
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
          <p>⚠️ Please ensure the backend service is running on localhost:8000</p>
        </div>
      )}
    </div>
  );
};

export default AudioCapture; 