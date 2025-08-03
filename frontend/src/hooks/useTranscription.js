import { useState, useEffect, useRef, useCallback } from 'react';

export const useTranscription = () => {
  const [captions, setCaptions] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connectWebSocket = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:8000/ws/audio`;
      wsRef.current = new WebSocket(wsUrl);

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
              if (data.is_final) {
                const lastIndex = newCaptions.length - 1;
                if (lastIndex >= 0 && !newCaptions[lastIndex].is_final) {
                  newCaptions[lastIndex] = {
                    text: data.text,
                    is_final: true,
                    confidence: data.confidence,
                    timestamp: data.timestamp
                  };
                } else {
                  newCaptions.push({
                    text: data.text,
                    is_final: true,
                    confidence: data.confidence,
                    timestamp: data.timestamp
                  });
                }
              } else {
                const lastIndex = newCaptions.length - 1;
                if (lastIndex >= 0 && !newCaptions[lastIndex].is_final) {
                  newCaptions[lastIndex] = {
                    text: data.text,
                    is_final: false,
                    confidence: data.confidence,
                    timestamp: data.timestamp
                  };
                } else {
                  newCaptions.push({
                    text: data.text,
                    is_final: false,
                    confidence: data.confidence,
                    timestamp: data.timestamp
                  });
                }
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

      wsRef.current.onerror = (err) => {
        setError('Connection error. Please check if the backend service is running.');
      };
    } catch (err) {
      setError('Failed to connect to transcription service.');
    }
  }, []);

  const startTranscription = useCallback(async () => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }
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
      const source = audioContextRef.current.createMediaStreamSource(stream);
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
      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
    } catch (err) {
      setError('Failed to start transcription.');
      throw err;
    }
  }, []);

  const stopTranscription = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const clearCaptions = useCallback(() => {
    setCaptions([]);
  }, []);

  const exportTranscript = useCallback((format) => {
    if (captions.length === 0) return;
    const finalCaptions = captions.filter(caption => caption.is_final);
    let content = '';
    let filename = `transcript_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
    switch (format) {
      case 'txt':
        content = finalCaptions.map(caption => caption.text).join('\n\n');
        filename += '.txt';
        break;
      case 'srt':
        content = finalCaptions.map((caption, index) => {
          const startTime = new Date(caption.timestamp * 1000);
          const endTime = new Date((caption.timestamp + 2) * 1000);
          const formatTime = (date) => {
            const hours = date.getUTCHours().toString().padStart(2, '0');
            const minutes = date.getUTCMinutes().toString().padStart(2, '0');
            const seconds = date.getUTCSeconds().toString().padStart(2, '0');
            const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
            return `${hours}:${minutes}:${seconds},${milliseconds}`;
          };
          return `${index + 1}\n${formatTime(startTime)} --> ${formatTime(endTime)}\n${caption.text}\n`;
        }).join('\n');
        filename += '.srt';
        break;
      case 'vtt':
        content = 'WEBVTT\n\n';
        content += finalCaptions.map((caption, index) => {
          const startTime = new Date(caption.timestamp * 1000);
          const endTime = new Date((caption.timestamp + 2) * 1000);
          const formatTime = (date) => {
            const hours = date.getUTCHours().toString().padStart(2, '0');
            const minutes = date.getUTCMinutes().toString().padStart(2, '0');
            const seconds = date.getUTCSeconds().toString().padStart(2, '0');
            const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
            return `${hours}:${minutes}:${seconds}.${milliseconds}`;
          };
          return `${index + 1}\n${formatTime(startTime)} --> ${formatTime(endTime)}\n${caption.text}`;
        }).join('\n\n');
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
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
      stopTranscription();
    };
  }, [connectWebSocket, stopTranscription]);

  return {
    captions,
    isConnected,
    error,
    startTranscription,
    stopTranscription,
    clearCaptions,
    exportTranscript
  };
}; 