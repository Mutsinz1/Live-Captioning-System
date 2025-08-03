import React from 'react';
import './ControlPanel.css';

const ControlPanel = ({ settings, onSettingsChange, onExport, onClear, captionsCount }) => {
  const handleFontSizeChange = (e) => {
    onSettingsChange({ fontSize: parseInt(e.target.value) });
  };

  const handleHighContrastChange = (e) => {
    onSettingsChange({ highContrast: e.target.checked });
  };

  const handleAutoScrollChange = (e) => {
    onSettingsChange({ autoScroll: e.target.checked });
  };

  const handleLanguageChange = (e) => {
    onSettingsChange({ language: e.target.value });
  };

  const handleExport = (format) => {
    onExport(format);
  };

  return (
    <div className="control-panel">
      <div className="control-section">
        <h3>Display Settings</h3>
        
        <div className="setting-group">
          <label htmlFor="fontSize" className="setting-label">
            Font Size: {settings.fontSize}px
          </label>
          <input
            id="fontSize"
            type="range"
            min="16"
            max="48"
            value={settings.fontSize}
            onChange={handleFontSizeChange}
            className="setting-slider"
          />
        </div>

        <div className="setting-group">
          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={settings.highContrast}
              onChange={handleHighContrastChange}
            />
            <span className="checkmark"></span>
            High Contrast Mode
          </label>
        </div>

        <div className="setting-group">
          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={settings.autoScroll}
              onChange={handleAutoScrollChange}
            />
            <span className="checkmark"></span>
            Auto-scroll to Latest
          </label>
        </div>

        <div className="setting-group">
          <label htmlFor="language" className="setting-label">
            Language
          </label>
          <select
            id="language"
            value={settings.language}
            onChange={handleLanguageChange}
            className="setting-select"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
          </select>
        </div>
      </div>

      <div className="control-section">
        <h3>Transcript Actions</h3>
        
        <div className="action-buttons">
          <button
            className="btn btn-outline"
            onClick={() => handleExport('txt')}
            disabled={captionsCount === 0}
          >
            📄 Export TXT
          </button>
          
          <button
            className="btn btn-outline"
            onClick={() => handleExport('srt')}
            disabled={captionsCount === 0}
          >
            🎬 Export SRT
          </button>
          
          <button
            className="btn btn-outline"
            onClick={() => handleExport('vtt')}
            disabled={captionsCount === 0}
          >
            📺 Export VTT
          </button>
        </div>

        <div className="action-buttons">
          <button
            className="btn btn-danger"
            onClick={onClear}
            disabled={captionsCount === 0}
          >
            🗑️ Clear All
          </button>
        </div>

        <div className="transcript-info">
          <p>
            <strong>{captionsCount}</strong> caption{captionsCount !== 1 ? 's' : ''} captured
          </p>
        </div>
      </div>

      <div className="control-section">
        <h3>Keyboard Shortcuts</h3>
        <div className="shortcuts">
          <div className="shortcut-item">
            <kbd>Space</kbd>
            <span>Start/Stop Recording</span>
          </div>
          <div className="shortcut-item">
            <kbd>Ctrl/Cmd + S</kbd>
            <span>Export Transcript</span>
          </div>
          <div className="shortcut-item">
            <kbd>Ctrl/Cmd + L</kbd>
            <span>Clear All</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ControlPanel; 