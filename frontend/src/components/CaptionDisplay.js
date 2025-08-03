import React, { useRef, useEffect } from 'react';
import './CaptionDisplay.css';

const CaptionDisplay = ({ captions, settings }) => {
  const containerRef = useRef(null);
  const liveRegionRef = useRef(null);

  // Auto-scroll to bottom when new captions arrive
  useEffect(() => {
    if (settings.autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [captions, settings.autoScroll]);

  // Update live region for screen readers
  useEffect(() => {
    if (liveRegionRef.current && captions.length > 0) {
      const lastCaption = captions[captions.length - 1];
      liveRegionRef.current.textContent = lastCaption.text;
    }
  }, [captions]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString();
  };

  const getCaptionStyle = () => ({
    fontSize: `${settings.fontSize}px`,
    filter: settings.highContrast ? 'contrast(150%) brightness(120%)' : 'none',
  });

  return (
    <div className="caption-display">
      <div className="caption-header">
        <h3>Live Captions</h3>
        <div className="caption-info">
          <span className="caption-count">
            {captions.length} caption{captions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Live region for screen readers */}
      <div
        ref={liveRegionRef}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      />

      <div 
        ref={containerRef}
        className="caption-content"
        style={getCaptionStyle()}
        role="log"
        aria-label="Live captions"
      >
        {captions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎤</div>
            <p>Start recording to see live captions here</p>
            <p className="empty-hint">
              Your speech will appear as real-time text with minimal latency
            </p>
          </div>
        ) : (
          captions.map((caption, index) => (
            <div
              key={`${caption.timestamp}-${index}`}
              className={`caption-item ${caption.is_final ? 'caption-final' : 'caption-partial'}`}
              data-timestamp={formatTimestamp(caption.timestamp)}
            >
              <div className="caption-text">
                {caption.text}
                {!caption.is_final && (
                  <span className="caption-indicator" aria-label="Partial transcription">
                    ...
                  </span>
                )}
              </div>
              
              {caption.confidence > 0 && (
                <div className="caption-confidence">
                  <div 
                    className="confidence-bar"
                    style={{ width: `${caption.confidence * 100}%` }}
                  />
                  <span className="confidence-text">
                    {Math.round(caption.confidence * 100)}%
                  </span>
                </div>
              )}
              
              <div className="caption-meta">
                <span className="caption-time">
                  {formatTimestamp(caption.timestamp)}
                </span>
                <span className="caption-status">
                  {caption.is_final ? 'Final' : 'Partial'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {captions.length > 0 && (
        <div className="caption-controls">
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (containerRef.current) {
                containerRef.current.scrollTop = 0;
              }
            }}
            aria-label="Scroll to top"
          >
            ↑ Top
          </button>
          
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
            }}
            aria-label="Scroll to bottom"
          >
            ↓ Bottom
          </button>
        </div>
      )}
    </div>
  );
};

export default CaptionDisplay; 