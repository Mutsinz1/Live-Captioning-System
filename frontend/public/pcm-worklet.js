/**
 * AudioWorklet processor that converts the microphone's native-rate float
 * audio into 16kHz 16-bit PCM for the transcription backend.
 *
 * Runs off the main thread (unlike the deprecated ScriptProcessorNode) and
 * resamples with linear interpolation, so it works correctly on devices and
 * browsers (notably Safari) that ignore a requested 16kHz AudioContext rate.
 */
class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target =
      (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    // `sampleRate` is a global in AudioWorkletGlobalScope: the context's real rate
    this.ratio = sampleRate / target;
    this.pos = 0; // fractional read position carried across blocks
    this.out = [];
    this.CHUNK = 2048; // int16 samples per message (~128ms at 16kHz)
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    const n = channel.length;
    let pos = this.pos;

    while (pos < n) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = channel[i];
      const s1 = i + 1 < n ? channel[i + 1] : channel[n - 1];
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

    this.pos = pos - n;
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorkletProcessor);
