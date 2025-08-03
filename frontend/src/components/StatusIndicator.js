import React from 'react';
import './StatusIndicator.css';

const StatusIndicator = ({ isConnected, isRecording, error }) => {
  const getStatusColor = () => {
    if (error) return '#f44336'; // Red for error
    if (isRecording) return '#4CAF50'; // Green for recording
    if (isConnected) return '#2196F3'; // Blue for connected
    return '#9E9E9E'; // Gray for disconnected
  };

  const getStatusText = () => {
    if (error) return 'Error';
    if (isRecording) return 'Recording';
    if (isConnected) return 'Connected';
    return 'Disconnected';
  };

  const getStatusIcon = () => {
    if (error) return '⚠️';
    if (isRecording) return '🔴';
    if (isConnected) return '🟢';
    return '⚪';
  };

  return (
    <div className="status-indicator">
      <div 
        className="status-dot"
        style={{ backgroundColor: getStatusColor() }}
        aria-label={`Status: ${getStatusText()}`}
      >
        <span className="status-icon">{getStatusIcon()}</span>
      </div>
      <span className="status-text">{getStatusText()}</span>
      
      {error && (
        <div className="status-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default StatusIndicator; 