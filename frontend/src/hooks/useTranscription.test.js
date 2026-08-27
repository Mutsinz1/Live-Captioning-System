/**
 * Behavioural tests for useTranscription: socket lifecycle, per-client
 * language, caption accumulation, and subtitle export timing.
 */
import { renderHook, act } from '@testing-library/react';
import { useTranscription } from './useTranscription';

let sockets;
let blobs;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
  }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  open() { this.readyState = 1; act(() => { if (this.onopen) this.onopen(); }); }
}
MockWebSocket.OPEN = 1;

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = {};
    this.audioWorklet = { addModule: async () => {} };
  }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createAnalyser() {
    return { fftSize: 0, frequencyBinCount: 8, getByteFrequencyData() {}, connect() {}, disconnect() {} };
  }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  resume() { return Promise.resolve(); }
  close() {}
}

beforeEach(() => {
  sockets = [];
  blobs = [];
  global.WebSocket = MockWebSocket;
  global.AudioContext = FakeAudioContext;
  window.AudioContext = FakeAudioContext;
  global.AudioWorkletNode = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
    connect() {} disconnect() {}
  };
  navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
  global.Blob = function (parts) { blobs.push(parts.join('')); };
  global.URL.createObjectURL = () => 'blob:mock';
  global.URL.revokeObjectURL = () => {};
});

const audioSocket = () => sockets.find(s => s.url.endsWith('/ws/audio'));
const controlSocket = () => sockets.find(s => s.url.endsWith('/ws/control'));

function caption(ws, text, isFinal, timestamp) {
  act(() => {
    ws.onmessage({ data: JSON.stringify({
      type: 'transcription', text, is_final: isFinal, confidence: 0.9, timestamp,
    })});
  });
}

test('opens one audio and one control socket on mount', () => {
  renderHook(() => useTranscription());
  expect(sockets).toHaveLength(2);
  expect(audioSocket()).toBeDefined();
  expect(controlSocket()).toBeDefined();
});

test('partials replace in place and finals accumulate', () => {
  const { result } = renderHook(() => useTranscription());
  const ws = audioSocket();
  caption(ws, 'hello wor', false, 100);
  caption(ws, 'hello world', false, 101);
  expect(result.current.captions).toHaveLength(1);
  caption(ws, 'Hello world.', true, 102);
  expect(result.current.captions).toHaveLength(1);
  caption(ws, 'next', false, 103);
  expect(result.current.captions).toHaveLength(2);
});

test('language changes go to the audio socket, never the control socket', () => {
  const { result } = renderHook(() => useTranscription());
  const ws = audioSocket();
  ws.open();
  act(() => { result.current.changeLanguage('es'); });
  expect(ws.sent.map(JSON.parse)).toContainEqual({ type: 'change_language', language: 'es' });
  // the control channel sets the server-wide default; using it here would
  // switch every other connected user's language too
  expect(controlSocket().sent).toHaveLength(0);
});

test('a language chosen while disconnected is replayed on connect', () => {
  const { result } = renderHook(() => useTranscription());
  const ws = audioSocket();
  act(() => { result.current.changeLanguage('fr'); });
  expect(ws.sent).toHaveLength(0);
  ws.open();
  expect(ws.sent.map(JSON.parse)).toEqual([{ type: 'change_language', language: 'fr' }]);
});

test('SRT cue times are relative to the recording start', () => {
  const { result } = renderHook(() => useTranscription());
  const ws = audioSocket();
  const base = 1_700_000_000;
  let clock = base * 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  caption(ws, 'first', true, base);
  clock += 3000;
  caption(ws, 'second', true, base + 3);
  act(() => { result.current.exportTranscript('srt'); });
  expect(blobs[0]).toContain('00:00:00,000 --> 00:00:03,000');
  Date.now.mockRestore();
});

test('SRT timing survives a client/server clock skew', async () => {
  const { result } = renderHook(() => useTranscription());
  const ws = audioSocket();
  ws.readyState = 1;
  const base = 1_700_000_000;
  let clock = base * 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);

  await act(async () => { await result.current.startTranscription(); });
  // backend stamps its own clock, running 30s ahead of the browser
  caption(ws, 'first', true, base + 30);
  clock += 3000;
  caption(ws, 'second', true, base + 33);
  act(() => { result.current.exportTranscript('srt'); });

  expect(blobs[0]).toContain('00:00:00,000 --> 00:00:03,000');
  Date.now.mockRestore();
});

test('does not reconnect after unmount', () => {
  jest.useFakeTimers();
  const { unmount } = renderHook(() => useTranscription());
  const before = sockets.length;
  unmount();
  act(() => { jest.advanceTimersByTime(60000); });
  expect(sockets).toHaveLength(before);
  jest.useRealTimers();
});

test('still reconnects while mounted', () => {
  jest.useFakeTimers();
  renderHook(() => useTranscription());
  act(() => { audioSocket().onclose(); });
  act(() => { jest.advanceTimersByTime(60000); });
  expect(sockets.filter(s => s.url.endsWith('/ws/audio'))).toHaveLength(2);
  jest.useRealTimers();
});

test('stopping asks the backend to finalise the trailing utterance', async () => {
  const { result } = renderHook(() => useTranscription());
  const ws = audioSocket();
  ws.readyState = 1;
  await act(async () => { await result.current.startTranscription(); });
  ws.sent.length = 0;

  act(() => { result.current.stopTranscription(); });

  // Vosk only finalises on silence, so without this the last sentence stays
  // a partial and never reaches the export (which keeps finals only).
  expect(ws.sent.map(JSON.parse)).toContainEqual({ type: 'stop_recording' });
});

test('stopping while disconnected does not throw', () => {
  const { result } = renderHook(() => useTranscription());
  expect(() => act(() => { result.current.stopTranscription(); })).not.toThrow();
});
