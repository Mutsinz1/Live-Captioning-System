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
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sinkRef = useRef(null);
  const processorRef = useRef(null); // ScriptProcessor fallback for old browsers
  const animationFrameRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const recordingStartRef = useRef(null);
  const isUnmountedRef = useRef(false);
  const languageRef = useRef(null);
  const maxReconnectAttempts = 5;

  const connectWebSocket = useCallback(() => {
    try {
      wsRef.current = new WebSocket(`${getWsBase()}/ws/audio`);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        // A reconnect starts a fresh backend session at the default language,
        // so re-assert this client's choice.
        if (languageRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'change_language',
            language: languageRef.current
          }));
        }
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
                timestamp: data.timestamp,
                // data.timestamp comes from the server clock. Subtitle timing
                // must not depend on client/server clocks agreeing, so stamp
                // arrival on the same clock recordingStartRef uses.
                receivedAt: Date.now() / 1000
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
        // close() during unmount still fires onclose; without this guard the
        // handler schedules a reconnect for a component that is already gone.
        if (isUnmountedRef.current) return;
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
        // Status/settings channel only. Language is per-session and travels
        // over the audio socket instead.
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
    // Language is per-session state, so it only ever travels over the audio
    // socket. The control channel sets the server-wide default, which would
    // change what every other connected user is transcribed as.
    languageRef.current = language;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'change_language', language }));
    }
    // Otherwise onopen replays languageRef once the socket connects.
  }, []);

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

      // Use the device's NATIVE sample rate — browsers (notably Safari) may
      // ignore a requested 16kHz rate, so we resample to 16kHz ourselves in
      // the audio worklet instead of trusting the context rate.
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
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

      const ctx = audioContextRef.current;
      if (ctx.audioWorklet) {
        // Modern path: AudioWorklet runs off the main thread and resamples
        // from the context's native rate down to 16kHz.
        await ctx.audioWorklet.addModule(`${process.env.PUBLIC_URL || ''}/pcm-worklet.js`);
        const node = new AudioWorkletNode(ctx, 'pcm-worklet', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          processorOptions: { targetSampleRate: 16000 }
        });
        node.port.onmessage = (e) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(e.data);
          }
        };
        workletNodeRef.current = node;

        // Keep the graph alive without producing audible output
        const sink = ctx.createGain();
        sink.gain.value = 0;
        sinkRef.current = sink;

        sourceRef.current.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
      } else {
        // Fallback for browsers without AudioWorklet: deprecated
        // ScriptProcessorNode with inline linear-interpolation resampling.
        const ratio = ctx.sampleRate / 16000;
        let pos = 1;
        let prev = 0;
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (e) => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const n = input.length;
          const out = [];
          // Same virtual-buffer scheme as pcm-worklet.js: index 0 is the
          // previous block's last sample, so interpolation always has both
          // neighbours instead of reusing the block's final sample.
          while (pos < n) {
            const i = Math.floor(pos);
            const frac = pos - i;
            const s0 = i === 0 ? prev : input[i - 1];
            const s1 = input[i];
            const s = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
            out.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
            pos += ratio;
          }
          pos -= n;
          prev = input[n - 1];
          if (out.length) wsRef.current.send(new Int16Array(out).buffer);
        };
        sourceRef.current.connect(processor);
        processor.connect(ctx.destination);
      }

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
    if (workletNodeRef.current) {
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(workletNodeRef.current); } catch (e) { /* already disconnected */ }
      }
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sinkRef.current) {
      sinkRef.current.disconnect();
      sinkRef.current = null;
    }
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
    // wall-clock epoch time, and must come from ONE clock: receivedAt and
    // recordingStartRef are both browser-side, unlike the server timestamp.
    const cueTime = (caption) => caption.receivedAt ?? caption.timestamp;
    const base = recordingStartRef.current ?? cueTime(finalCaptions[0]);

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
      const start = Math.max(0, cueTime(caption) - base);
      const next = finalCaptions[index + 1];
      let duration = next ? cueTime(next) - cueTime(caption) : 2;
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
    isUnmountedRef.current = false;
    connectWebSocket();
    connectControlWebSocket();
    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (wsRef.current) wsRef.current.close();
      if (controlWsRef.current) controlWsRef.current.close();
      if (workletNodeRef.current) workletNodeRef.current.disconnect();
      if (sinkRef.current) sinkRef.current.disconnect();
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
