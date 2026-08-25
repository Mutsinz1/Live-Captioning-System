import { useState, useEffect, useRef, useCallback } from 'react';

// Resolve the WebSocket base URL:
// 1. REACT_APP_WS_URL env var wins (e.g. "wss://captions.example.com")
// 2. CRA dev server (port 3000) talks to the backend directly on port 8000
// 3. Anything else (nginx / production) proxies /ws/ on the same origin
const getWsBase = () => {
  const envUrl = process.env.REACT_APP_WS_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (window.location.port === '3000') {
    return `${protocol}//${window.location.hostname}:8000`;
  }
  return `${protocol}//${window.location.host}`;
};

export const useTranscription = () => {
  const [captions, setCaptions] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef(null);
  const controlWsRef = useRef(null);
  const pendingLanguageRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const processorRef = useRef(null);
  const animationFrameRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const recordingStartRef = useRef(null);
  const maxReconnectAttempts = 5;

  const connectWebSocket = useCallback(() => {
    try {
      wsRef.current = new WebSocket(`${getWsBase()}/ws/audio`);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcription') {
            setCaptions(prev => {
              const newCaptions = [...prev];
              const lastIndex = newCaptions.length - 1;
              const caption = {
                text: data.text,
                is_final: data.is_final,
                confidence: data.confidence,
                timestamp: data.timestamp
              };
              // Replace the trailing partial caption in place; otherwise append
              if (lastIndex >= 0 && !newCaptions[lastIndex].is_final) {
                newCaptions[lastIndex] = caption;
              } else {
                newCaptions.push(caption);
              }
              return newCaptions;
            });
          } else if (data.type === 'error') {
            setError(data.message);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);
        } else {
          setError('Connection lost. Please refresh the page to try again.');
        }
      };

      wsRef.current.onerror = () => {
        setError('Connection error. Please check if the backend service is running.');
      };
    } catch (err) {
      setError('Failed to connect to transcription service.');
    }
  }, []);

  const connectControlWebSocket = useCallback(() => {
    try {
      controlWsRef.current = new WebSocket(`${getWsBase()}/ws/control`);

      controlWsRef.current.onopen = () => {
        // Flush a language change requested while the socket was down
        if (pendingLanguageRef.current) {
          controlWsRef.current.send(JSON.stringify({
            type: 'change_language',
            language: pendingLanguageRef.current
          }));
          pendingLanguageRef.current = null;
        }
      };

      controlWsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error') {
            setError(data.message);
          }
        } catch (err) {
          console.error('Error parsing control message:', err);
        }
      };

      controlWsRef.current.onclose = () => {
        controlWsRef.current = null;
      };

      controlWsRef.current.onerror = () => {
        // Non-fatal: transcription still works without the control channel
      };
    } catch (err) {
      console.error('Failed to connect control WebSocket:', err);
    }
  }, []);

  const changeLanguage = useCallback((language) => {
    if (controlWsRef.current?.readyState === WebSocket.OPEN) {
      controlWsRef.current.send(JSON.stringify({
        type: 'change_language',
        language
      }));
    } else {
      pendingLanguageRef.current = language;
      connectControlWebSocket();
    }
  }, [connectControlWebSocket]);

  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    setAudioLevel(average);
    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  // Request the microphone ONCE and share the stream between the level meter
  // and the transcription pipeline (previously two separate streams were opened).
  const requestPermission = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    setIsRequestingPermission(true);
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
      streamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      sourceRef.current.connect(analyserRef.current);
      updateAudioLevel();

      setHasPermission(true);
      return stream;
    } finally {
      setIsRequestingPermission(false);
    }
  }, [updateAudioLevel]);

  const startTranscription = useCallback(async () => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }
      await requestPermission();

      // Suspended contexts (e.g. after autoplay policies kick in) must be resumed
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          let s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        wsRef.current.send(pcm.buffer);
      };
      sourceRef.current.connect(processor);
      processor.connect(audioContextRef.current.destination);

      if (recordingStartRef.current === null) {
        recordingStartRef.current = Date.now() / 1000;
      }
    } catch (err) {
      setError('Failed to start transcription.');
      throw err;
    }
  }, [requestPermission]);

  const stopTranscription = useCallback(() => {
    // Only tear down the processing chain; keep the stream and analyser alive
    // so the level meter continues working and permission isn't re-requested.
    if (processorRef.current) {
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(processorRef.current); } catch (e) { /* already disconnected */ }
      }
      processorRef.current.disconnect();
      processorRef.current = null;
    }
  }, []);

  const clearCaptions = useCallback(() => {
    setCaptions([]);
    recordingStartRef.current = null;
  }, []);

  const exportTranscript = useCallback((format) => {
    if (captions.length === 0) return;
    const finalCaptions = captions.filter(caption => caption.is_final);
    if (finalCaptions.length === 0) return;

    // Subtitle times must be relative to the start of the recording, not
    // wall-clock epoch time. Fall back to the first caption's timestamp.
    const base = recordingStartRef.current ?? finalCaptions[0].timestamp;

    // Format seconds as HH:MM:SS<sep>mmm
    const formatTime = (totalSeconds, msSeparator) => {
      const clamped = Math.max(0, totalSeconds);
      const hours = Math.floor(clamped / 3600).toString().padStart(2, '0');
      const minutes = Math.floor((clamped % 3600) / 60).toString().padStart(2, '0');
      const seconds = Math.floor(clamped % 60).toString().padStart(2, '0');
      const milliseconds = Math.round((clamped % 1) * 1000).toString().padStart(3, '0');
      return `${hours}:${minutes}:${seconds}${msSeparator}${milliseconds}`;
    };

    // Derive cue timings: each cue starts at its (relative) timestamp and ends
    // at the next cue's start, clamped to a sane 1–7 second range.
    const cues = finalCaptions.map((caption, index) => {
      const start = Math.max(0, caption.timestamp - base);
      const next = finalCaptions[index + 1];
      let duration = next ? next.timestamp - caption.timestamp : 2;
      duration = Math.min(Math.max(duration, 1), 7);
      return { text: caption.text, start, end: start + duration };
    });

    let content = '';
    let filename = `transcript_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
    switch (format) {
      case 'txt':
        content = finalCaptions.map(caption => caption.text).join('\n\n');
        filename += '.txt';
        break;
      case 'srt':
        content = cues.map((cue, index) =>
          `${index + 1}\n${formatTime(cue.start, ',')} --> ${formatTime(cue.end, ',')}\n${cue.text}\n`
        ).join('\n');
        filename += '.srt';
        break;
      case 'vtt':
        content = 'WEBVTT\n\n';
        content += cues.map((cue, index) =>
          `${index + 1}\n${formatTime(cue.start, '.')} --> ${formatTime(cue.end, '.')}\n${cue.text}`
        ).join('\n\n');
        filename += '.vtt';
        break;
      default:
        return;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [captions]);

  useEffect(() => {
    connectWebSocket();
    connectControlWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (wsRef.current) wsRef.current.close();
      if (controlWsRef.current) controlWsRef.current.close();
      if (processorRef.current) processorRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [connectWebSocket, connectControlWebSocket]);

  return {
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
  };
};
