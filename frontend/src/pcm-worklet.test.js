/**
 * @jest-environment node
 *
 * Tests the AudioWorklet resampler by loading public/pcm-worklet.js with the
 * AudioWorkletGlobalScope globals shimmed in.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'public', 'pcm-worklet.js');

function loadProcessor(contextSampleRate) {
  let Registered = null;
  const sandbox = {
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: () => {} }; }
    },
    registerProcessor: (name, cls) => { Registered = cls; },
    sampleRate: contextSampleRate,
    Int16Array, Float32Array, Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  return Registered;
}

/** Feed a sine wave through the worklet; return emitted samples and the input. */
function run(inRate, { blocks = 400, blockSize = 128, freq = 440 } = {}) {
  const Processor = loadProcessor(inRate);
  const node = new Processor({ processorOptions: { targetSampleRate: 16000 } });
  const got = [];
  node.port.postMessage = (buf) => { for (const v of new Int16Array(buf)) got.push(v); };

  const input = [];
  for (let b = 0; b < blocks; b++) {
    const buf = new Float32Array(blockSize);
    for (let k = 0; k < blockSize; k++) {
      const s = Math.sin(2 * Math.PI * freq * ((b * blockSize + k) / inRate));
      buf[k] = s;
      input.push(s);
    }
    node.process([[buf]]);
  }
  return { got, input };
}

/** Linear resample of the whole stream at once — no block boundaries at all. */
function reference(input, inRate) {
  const out = [];
  for (let pos = 1; pos < input.length - 1; pos += inRate / 16000) {
    const i = Math.floor(pos);
    const frac = pos - i;
    out.push(input[i - 1] + (input[i] - input[i - 1]) * frac);
  }
  return out;
}

describe.each([[48000], [44100], [16000]])('resampling %ikHz to 16kHz', (inRate) => {
  test('emits the expected number of samples (no cumulative drift)', () => {
    const { got, input } = run(inRate);
    const expected = (input.length * 16000) / inRate;
    // Shortfall is bounded by one partly-filled chunk (at most CHUNK - 1 =
    // 2047 samples still buffered) plus the single input sample the worklet
    // skips at stream start, so 2048 is reachable exactly (e.g. at ratio 1).
    expect(expected - got.length).toBeGreaterThanOrEqual(0);
    expect(expected - got.length).toBeLessThanOrEqual(2048);
  });

  test('matches a boundary-free resampler', () => {
    // Regression guard: interpolating with the block's own last sample in
    // place of the next block's first distorts ~1% of output at 44.1kHz.
    const { got, input } = run(inRate);
    const want = reference(input, inRate);
    let maxErr = 0;
    for (let k = 0; k < Math.min(got.length, want.length); k++) {
      maxErr = Math.max(maxErr, Math.abs(got[k] / 0x7fff - want[k]));
    }
    expect(maxErr).toBeLessThan(0.001);
  });
});

test('output stays inside the int16 range and is not silent', () => {
  const { got } = run(48000);
  expect(got.length).toBeGreaterThan(0);
  expect(Math.max(...got)).toBeGreaterThan(30000);
  expect(Math.min(...got)).toBeLessThan(-30000);
  expect(Math.max(...got)).toBeLessThanOrEqual(32767);
  expect(Math.min(...got)).toBeGreaterThanOrEqual(-32768);
});

test('survives empty and missing input blocks', () => {
  const Processor = loadProcessor(48000);
  const node = new Processor({ processorOptions: { targetSampleRate: 16000 } });
  expect(node.process([[]])).toBe(true);
  expect(node.process([])).toBe(true);
  expect(node.process([[new Float32Array(0)]])).toBe(true);
});
