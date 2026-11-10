// Muda o tom sem mudar o andamento (vocoder de fase, STFT). Roda na mixagem final, em estéreo.
// Algoritmo clássico de deslocamento de tom por vocoder de fase (janela de 2048 amostras, sobreposição de 4×).
const N = 2048, OSAMP = 4, STEP = N / OSAMP, LAT = N - STEP, H = N / 2;

function makeFFT(n) {
  const rev = new Uint32Array(n); let bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  // re/im separados; sign = -1 direta, +1 inversa (sem normalizar)
  return (re, im, sign) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cos[k], wi = sign * sin[k];
          const a = i + j, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}
const fft = makeFFT(N);
const WIN = new Float32Array(N);
for (let i = 0; i < N; i++) WIN[i] = -0.5 * Math.cos((2 * Math.PI * i) / N) + 0.5;

class Channel {
  constructor() {
    this.inF = new Float32Array(N); this.outF = new Float32Array(N); this.acc = new Float32Array(2 * N);
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.last = new Float32Array(H + 1); this.sum = new Float32Array(H + 1);
    this.aM = new Float32Array(H + 1); this.aF = new Float32Array(H + 1); this.sM = new Float32Array(H + 1); this.sF = new Float32Array(H + 1);
    this.rover = LAT;
  }
  frame(ratio) {
    const { re, im, inF, last, sum, aM, aF, sM, sF, acc, outF } = this;
    const fpb = sampleRate / N, expct = (2 * Math.PI * STEP) / N;
    for (let k = 0; k < N; k++) { re[k] = inF[k] * WIN[k]; im[k] = 0; }
    fft(re, im, -1);
    for (let k = 0; k <= H; k++) {
      const r = re[k], i = im[k];
      const mag = 2 * Math.sqrt(r * r + i * i), ph = Math.atan2(i, r);
      let t = ph - last[k]; last[k] = ph;
      t -= k * expct;
      let q = Math.round(t / Math.PI); q += q >= 0 ? (q & 1) : -(q & 1);
      t -= Math.PI * q;
      t = (OSAMP * t) / (2 * Math.PI);
      aM[k] = mag; aF[k] = k * fpb + t * fpb;
    }
    sM.fill(0); sF.fill(0);
    for (let k = 0; k <= H; k++) { const idx = Math.round(k * ratio); if (idx <= H) { sM[idx] += aM[k]; sF[idx] = aF[k] * ratio; } }
    for (let k = 0; k <= H; k++) {
      let t = sF[k] - k * fpb; t /= fpb; t = (2 * Math.PI * t) / OSAMP; t += k * expct;
      sum[k] += t; const ph = sum[k];
      re[k] = sM[k] * Math.cos(ph); im[k] = sM[k] * Math.sin(ph);
    }
    for (let k = H + 1; k < N; k++) { re[k] = 0; im[k] = 0; }
    fft(re, im, 1);
    for (let k = 0; k < N; k++) acc[k] += (2 * WIN[k] * re[k]) / (H * OSAMP * 1.5);
    for (let k = 0; k < STEP; k++) outF[k] = acc[k];
    acc.copyWithin(0, STEP, STEP + N); acc.fill(0, N);
    inF.copyWithin(0, STEP, STEP + LAT);
  }
  run(input, output, ratio) {
    for (let s = 0; s < input.length; s++) {
      this.inF[this.rover] = input[s];
      output[s] = this.outF[this.rover - LAT];
      this.rover++;
      if (this.rover >= N) { this.rover = LAT; this.frame(ratio); }
    }
  }
}

class PitchShift extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.ratio = Math.pow(2, (opts?.processorOptions?.semitones || 0) / 12); this.ch = [new Channel(), new Channel()];
    this.port.onmessage = (e) => { if (typeof e.data?.semitones === "number") this.ratio = Math.pow(2, e.data.semitones / 12); };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    for (let c = 0; c < out.length; c++) {
      const src = inp[c] || inp[0];
      if (!src) { out[c].fill(0); continue; }
      this.ch[c % 2].run(src, out[c], this.ratio);
    }
    return true;
  }
}
registerProcessor("pitch-shift", PitchShift);
