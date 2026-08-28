/**
 * AudioWorklet processor that converts the microphone's native-rate float
 * audio into 16kHz 16-bit PCM for the transcription backend.
 *
 * Runs off the main thread (unlike the deprecated ScriptProcessorNode) and
 * resamples with linear interpolation, so it works correctly on devices and
 * browsers (notably Safari) that ignore a requested 16kHz AudioContext rate.
 *
 * Interpolation reads across the block boundary by carrying the previous
 * block's final sample: positions are expressed against a virtual buffer
 * [prevLast, ...channel], so both neighbours of every output sample are real
 * input. Substituting the block's own last sample instead (the obvious
 * shortcut) distorts ~1% of output at non-integer ratios such as 44.1kHz.
 */
class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target =
      (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    // `sampleRate` is a global in AudioWorkletGlobalScope: the context's real rate
    this.ratio = sampleRate / target;
    this.prev = 0; // last sample of the previous block (virtual index 0)
    this.pos = 1; // fractional read position carried across blocks
    this.out = [];
    this.CHUNK = 2048; // int16 samples per message (~128ms at 16kHz)
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    const n = channel.length;
    let pos = this.pos;

    // Virtual buffer V: V[0] = this.prev, V[k] = channel[k - 1] for k = 1..n.
    // Interpolating at pos < n only ever needs V[i] and V[i + 1], both real.
    while (pos < n) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = i === 0 ? this.prev : channel[i - 1];
      const s1 = channel[i];
      const sample = s0 + (s1 - s0) * frac;

      const clamped = Math.max(-1, Math.min(1, sample));
      this.out.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);

      if (this.out.length >= this.CHUNK) {
        const arr = new Int16Array(this.out);
        this.port.postMessage(arr.buffer, [arr.buffer]);
        this.out = [];
      }

      pos += this.ratio;
    }

    // Virtual index n of this block is index 0 of the next one.
    this.pos = pos - n;
    this.prev = channel[n - 1];
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorkletProcessor);
