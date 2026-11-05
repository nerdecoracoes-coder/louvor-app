import { byteRange, decodeRange } from "./ogg.js";
// Motor de áudio multitrack (Web Audio API), independente do REAPER.
//
// Sincronismo: todas as faixas são agendadas no MESMO relógio (AudioContext.currentTime), com posição
// exata em amostras. Nada é tocado como <audio> separado.
// Memória: os WAVs não são baixados nem decodificados inteiros. O motor busca só trechos de alguns segundos
// (pedidos por intervalo de bytes), converte o PCM direto em AudioBuffer e descarta o que já passou.
// Os trechos baixados ficam no cache do navegador (Cache Storage), então a segunda reprodução é instantânea.
// Áudios compactados (MP3/FLAC/OGG) são decodificados inteiros (o navegador não permite pedaços exatos).
// Versão leve: quando a faixa já foi convertida para Opus (Cloudflare R2), o motor baixa só o trecho de bytes de cada
// pedaço (índice de páginas Ogg), decodifica com o libopus (WebAssembly) e descarta a pré-rolagem, com precisão de amostra.

const CHUNK = 4;            // segundos por trecho
const AHEAD = 14;           // segundos mantidos carregados à frente
const BEHIND = 3;
const LOOKAHEAD = 1.2;      // agendamento antecipado
const PEAK_RATE = 50;       // pontos de forma de onda por segundo
const CACHE_NAME = "louvor-audio-v1";
const OPUS_RATE = 48000;

// decodificador Opus (libopus em WebAssembly, MIT — ./opus-decoder.min.js), carregado só quando necessário
let opusLib = null;
function loadOpus() {
  opusLib ??= new Promise((res, rej) => {
    if (globalThis["opus-decoder"]) return res(globalThis["opus-decoder"]);
    const sc = document.createElement("script");
    sc.src = new URL("./opus-decoder.min.js", import.meta.url).href;
    sc.onload = () => res(globalThis["opus-decoder"]); sc.onerror = () => { opusLib = null; rej(new Error("Não foi possível carregar o decodificador de áudio.")); };
    document.head.appendChild(sc);
  });
  return opusLib;
}

export const warmOpus = () => loadOpus().catch(() => {});

// Baixa (ou lê do cache) um intervalo de bytes da versão leve. Usado pelo motor e pelo pré-aquecimento.
export async function lightFetch(L, start, end) {
  const key = `https://somos.cache/light/${L.key}?r=${start}-${end}`;
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(L.url, { headers: { Range: `bytes=${start}-${end}` } }).catch(() => null);
    if (r && (r.status === 206 || r.ok)) break;
    if (r && r.status === 403) break; // link expirado: o pedaço volta a ser lido do WAV
    await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
  }
  if (!r || !(r.ok || r.status === 206)) throw Object.assign(new Error(`Falha ao carregar áudio leve (${r?.status ?? "sem conexão"})`), { light: true });
  let buf = new Uint8Array(await r.arrayBuffer());
  if (r.status === 200 && buf.length > end - start + 1) buf = buf.subarray(start, end + 1); // servidor ignorou o Range
  try { if (cache) await cache.put(key, new Response(buf)); } catch { /* cota cheia */ }
  return buf;
}
export { byteRange };

export class Engine extends EventTarget {
  constructor({ project, tracks, markers, media, mediaUrl, token, anonKey, mix }) {
    super();
    this.project = project; this.markers = markers || [];
    this.mediaUrl = mediaUrl; this.token = token; this.anonKey = anonKey;
    this.media = new Map((media || []).map((m) => [m.drive_file_id, { ...m,
      // com versão leve, toda faixa é lida em pedaços (mesmo que o original seja MP3/FLAC)
      format: m.light ? { ...(m.format || {}), codec: "light", duration: m.light.samples / OPUS_RATE } : m.format,
      wavFormat: m.light && m.format?.codec !== "decode" && m.format?.dataOffset != null ? m.format : null,
      chunks: new Map(), full: null, peaks: null, loading: new Map() }]));
    this.decoders = new Map(); this.decQ = Promise.resolve();
    this.length = Number(project.length_sec) || 0;
    this.tracks = tracks.map((t) => ({
      ...t, orig: { volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed },
      items: (t.items || []).filter((i) => t.kind === "audio" && i.fileId && this.media.has(i.fileId) && !i.muted),
    }));
    this.masterOrig = { volume: project.master?.volume ?? 1, muted: !!project.master?.muted };
    this.master = { ...this.masterOrig, user: 1 };
    this.applyMix(mix);
    this.playing = false; this.pos = 0; this.t0 = 0; this.p0 = 0;
    this.loop = null; this.repeat = false;
    this.sources = new Set(); this.scheduled = new Set();
    this.timer = null; this.buffering = false; this.destroyed = false;
    this.bytesLoaded = 0;
  }

  // ------------------------------------------------------------- grafo de áudio
  async init() {
    const srs = [...this.media.values()].map((m) => m.format?.sampleRate).filter(Boolean);
    const allLight = this.media.size > 0 && [...this.media.values()].every((m) => m.light);
    const sr = allLight ? OPUS_RATE : this.project.sample_rate || srs[0] || 48000;
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ctx = new AC({ sampleRate: sr, latencyHint: "playback" }); } catch { this.ctx = new AC({ latencyHint: "playback" }); }
    this.masterGain = this.ctx.createGain();
    this.masterAn = this.ctx.createAnalyser(); this.masterAn.fftSize = 512;
    this.masterGain.connect(this.masterAn); this.masterAn.connect(this.ctx.destination);
    for (const t of this.tracks) {
      t.input = this.ctx.createGain();       // soma dos itens (e das faixas filhas, se for pasta)
      t.gain = this.ctx.createGain();
      t.panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      t.an = this.ctx.createAnalyser(); t.an.fftSize = 256;
      t.input.connect(t.gain);
      (t.panner ? (t.gain.connect(t.panner), t.panner) : t.gain).connect(t.an);
    }
    for (const t of this.tracks) {
      if (!t.sends_to_parent) continue;      // como no REAPER: envio para o master/pasta desligado = sem som
      const parent = t.parent_idx != null ? this.tracks.find((x) => x.idx === t.parent_idx) : null;
      t.an.connect(parent ? parent.input : this.masterGain);
    }
    this.updateGains(true);
    this.dispatch("ready");
    return this;
  }

  dispatch(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ------------------------------------------------------------- mixagem
  applyMix(mix) {
    for (const t of this.tracks) {
      const u = mix?.tracks?.[t.guid || t.idx];
      Object.assign(t, { volume: t.orig.volume, pan: t.orig.pan, muted: t.orig.muted, soloed: t.orig.soloed }, u || {});
    }
    this.master.user = mix?.master?.user ?? 1;
    if (mix?.master?.muted !== undefined) this.master.muted = mix.master.muted;
  }
  mixState() {
    const tracks = {};
    for (const t of this.tracks) {
      const d = {};
      for (const k of ["volume", "pan", "muted", "soloed"]) if (t[k] !== t.orig[k]) d[k] = t[k];
      if (Object.keys(d).length) tracks[t.guid || t.idx] = d;
    }
    return { tracks, master: { user: this.master.user, muted: this.master.muted } };
  }
  isCustom() { const m = this.mixState(); return Object.keys(m.tracks).length > 0 || m.master.user !== 1 || m.master.muted !== this.masterOrig.muted; }
  resetMix() { this.applyMix(null); this.master.muted = this.masterOrig.muted; this.updateGains(); }

  childrenOf(idx) { return this.tracks.filter((t) => t.parent_idx === idx); }
  ancestors(t) { const out = []; let p = t.parent_idx; while (p != null) { const a = this.tracks.find((x) => x.idx === p); if (!a) break; out.push(a); p = a.parent_idx; } return out; }
  descendants(t) { const out = []; const st = [t.idx]; while (st.length) { const i = st.pop(); for (const c of this.childrenOf(i)) { out.push(c); st.push(c.idx); } } return out; }
  audible(t) {
    if (t.muted) return false;
    if (this.ancestors(t).some((a) => a.muted)) return false;
    const anySolo = this.tracks.some((x) => x.soloed);
    if (!anySolo) return true;
    return t.soloed || this.ancestors(t).some((a) => a.soloed) || this.descendants(t).some((d) => d.soloed);
  }
  updateGains(instant = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const set = (param, v) => instant ? param.setValueAtTime(v, now) : param.setTargetAtTime(v, now, 0.015);
    for (const t of this.tracks) {
      // o próprio mute da pasta já está no audible() dos filhos; na pasta, mute/solo afeta o próprio ganho
      const own = t.muted ? 0 : 1;
      const soloOk = !this.tracks.some((x) => x.soloed) || t.soloed || this.ancestors(t).some((a) => a.soloed) || this.descendants(t).some((d) => d.soloed);
      set(t.gain.gain, t.volume * own * (soloOk ? 1 : 0) * (t.phase_invert ? -1 : 1));
      if (t.panner) set(t.panner.pan, Math.max(-1, Math.min(1, t.pan)));
    }
    set(this.masterGain.gain, this.master.muted ? 0 : this.master.volume * this.master.user);
    this.dispatch("mix");
  }
  setTrack(t, patch) { Object.assign(t, patch); this.updateGains(); }
  setMaster(v) { this.master.user = v; this.updateGains(); }

  // ------------------------------------------------------------- carregamento de áudio
  async fetchRange(m, start, end) {
    const url = this.mediaUrl(m.drive_file_id);
    const key = `${url}&range=${start}-${end}&md5=${m.md5 || m.size}`;
    let cache = null;
    try { cache = await caches.open(CACHE_NAME); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
    const headers = { Authorization: `Bearer ${await this.token()}`, apikey: this.anonKey };
    if (end != null) headers.Range = `bytes=${start}-${end}`;
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch(url, { headers }).catch(() => null);
      if (r && (r.ok || r.status === 206)) break;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
    if (!r || !(r.ok || r.status === 206)) throw new Error(`Falha ao carregar áudio (${r?.status ?? "sem conexão"})`);
    const buf = new Uint8Array(await r.arrayBuffer());
    this.bytesLoaded += buf.length;
    try { if (cache) await cache.put(key, new Response(buf)); } catch { /* cota cheia: segue sem cache */ }
    return buf;
  }

  pcmToChannels(bytes, f) {
    const frames = Math.floor(bytes.length / f.blockAlign);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, frames * f.blockAlign);
    const ch = Array.from({ length: f.channels }, () => new Float32Array(frames));
    const bps = f.bits / 8;
    for (let i = 0, o = 0; i < frames; i++) {
      for (let c = 0; c < f.channels; c++, o += bps) {
        let v;
        if (f.codec === "float") v = f.bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
        else if (f.bits === 16) v = dv.getInt16(o, true) / 32768;
        else if (f.bits === 24) { let x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16); if (x & 0x800000) x |= ~0xffffff; v = x / 8388608; }
        else if (f.bits === 32) v = dv.getInt32(o, true) / 2147483648;
        else v = (dv.getUint8(o) - 128) / 128;
        ch[c][i] = v;
      }
    }
    return ch;
  }

  addPeaks(m, startSec, chans, sr) {
    const total = Math.ceil((m.format?.duration || this.length) * PEAK_RATE) + 1;
    if (!m.peaks) { m.peaks = new Float32Array(total * 2).fill(NaN); }
    const per = sr / PEAK_RATE;
    const n = chans[0].length;
    for (let s = 0; s < n; s += per) {
      let mn = 1, mx = -1;
      const e = Math.min(n, s + per);
      for (const c of chans) for (let i = Math.floor(s); i < e; i += 4) { const v = c[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const k = Math.floor(startSec * PEAK_RATE + s / per);
      if (k < total) { m.peaks[k * 2] = mn; m.peaks[k * 2 + 1] = mx; }
    }
    this.dispatch("peaks", { fileId: m.drive_file_id });
  }

  // pedaço c (CHUNK segundos) da versão leve: só os bytes necessários, decodificados com pré-rolagem
  async lightChunk(m, c) {
    const L = m.light;
    const s0 = Math.round(c * CHUNK * OPUS_RATE);
    if (s0 >= L.samples) return null;
    const s1 = Math.min(L.samples, Math.round((c + 1) * CHUNK * OPUS_RATE));
    const { start, end } = byteRange(L, s0, s1);
    const bytes = await this.fetchLight(m, start, end);
    const lib = await loadOpus();
    const nch = L.channels > 1 ? 2 : 1;
    // um decodificador por número de canais; os pedaços passam por ele um de cada vez (reset entre eles)
    const run = this.decQ.then(async () => {
      let d = this.decoders.get(nch);
      if (!d) { d = new lib.OpusDecoder(nch > 1 ? { channels: 2, streamCount: 1, coupledStreamCount: 1, channelMappingTable: [0, 1], preSkip: 0 } : { channels: 1, streamCount: 1, coupledStreamCount: 0, channelMappingTable: [0], preSkip: 0 }); this.decoders.set(nch, d); await d.ready; }
      else await d.reset();
      return decodeRange(d, bytes, start, L, s0, s1);
    });
    this.decQ = run.catch(() => {});
    return run;
  }
  async fetchLight(m, start, end) {
    const buf = await lightFetch(m.light, start, end);
    this.bytesLoaded += buf.length;
    return buf;
  }

  async loadChunk(fileId, c, { keep = true } = {}) {
    const m = this.media.get(fileId);
    if (m.light) {
      if (m.chunks.has(c)) { const x = m.chunks.get(c); x.used = performance.now(); return x.buf; }
      if (m.loading.has(c)) return m.loading.get(c);
      const p = (async () => {
        let chans;
        try { chans = await this.lightChunk(m, c); }
        catch (e) {
          // sem a versão leve (link expirado, rede), volta para o WAV do Drive daqui em diante
          if (!m.wavFormat) throw e;
          m.light = null; m.format = m.wavFormat; m.loading.delete(c);
          return this.loadChunk(fileId, c, { keep });
        }
        if (!chans || !chans[0].length) return null;
        this.addPeaks(m, c * CHUNK, chans, OPUS_RATE);
        if (!keep || this.destroyed) return null;
        const buf = this.ctx.createBuffer(chans.length, chans[0].length, OPUS_RATE);
        chans.forEach((d, i) => buf.copyToChannel(d, i));
        m.chunks.set(c, { buf, used: performance.now() });
        return buf;
      })();
      m.loading.set(c, p);
      try { return await p; } finally { m.loading.delete(c); }
    }
    const f = m.format || {};
    if (f.codec === "decode") { await this.loadFull(m); return m.full; }
    if (m.chunks.has(c)) { const x = m.chunks.get(c); x.used = performance.now(); return x.buf; }
    if (m.loading.has(c)) return m.loading.get(c);
    const p = (async () => {
      const startFrame = Math.floor(c * CHUNK * f.sampleRate);
      if (startFrame >= f.frames) return null;
      const endFrame = Math.min(f.frames, Math.floor((c + 1) * CHUNK * f.sampleRate));
      const start = f.dataOffset + startFrame * f.blockAlign;
      const end = f.dataOffset + endFrame * f.blockAlign - 1;
      const bytes = await this.fetchRange(m, start, end);
      const chans = this.pcmToChannels(bytes, f);
      if (!chans[0].length) return null;
      this.addPeaks(m, c * CHUNK, chans, f.sampleRate);
      if (!keep || this.destroyed) return null;
      const buf = this.ctx.createBuffer(f.channels, chans[0].length, f.sampleRate);
      chans.forEach((d, i) => buf.copyToChannel(d, i));
      m.chunks.set(c, { buf, used: performance.now() });
      return buf;
    })();
    m.loading.set(c, p);
    try { return await p; } finally { m.loading.delete(c); }
  }

  async loadFull(m) {
    if (m.full) return m.full;
    if (m.fullP) return m.fullP;
    m.fullP = (async () => {
      const bytes = await this.fetchRange(m, 0, null);
      const buf = await this.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      m.full = buf;
      m.format = { ...(m.format || {}), codec: "decode", sampleRate: buf.sampleRate, duration: buf.duration };
      const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      this.addPeaks(m, 0, chans, buf.sampleRate);
      return buf;
    })();
    return m.fullP;
  }

  // trechos de arquivo necessários para tocar a janela [a, b] do projeto
  needed(a, b) {
    const out = [];
    for (const t of this.tracks) for (const it of t.items) {
      const s = Math.max(a, it.position), e = Math.min(b, it.position + it.length);
      if (e <= s) continue;
      const fs = s - it.position + it.offset, fe = e - it.position + it.offset;
      for (let c = Math.floor(Math.max(0, fs) / CHUNK); c * CHUNK < fe; c++) out.push([it.fileId, c]);
    }
    const seen = new Set();
    return out.filter(([f, c]) => { const k = f + ":" + c; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  isLoaded(fileId, c) { const m = this.media.get(fileId); return m.format?.codec === "decode" ? !!m.full : m.chunks.has(c); }

  evict() {
    const p = this.position();
    const keepFrom = Math.floor(Math.max(0, p - BEHIND) / CHUNK) - 1, keepTo = Math.ceil((p + AHEAD) / CHUNK) + 1;
    const keepLoop = this.loop ? [Math.floor(this.loop[0] / CHUNK) - 1, Math.ceil((this.loop[0] + AHEAD) / CHUNK)] : null;
    for (const t of this.tracks) for (const it of t.items) {
      const m = this.media.get(it.fileId);
      const base = (it.position - it.offset) / CHUNK;
      for (const c of m.chunks.keys()) {
        const pc = c + base;
        if ((pc < keepFrom || pc > keepTo) && !(keepLoop && pc >= keepLoop[0] && pc <= keepLoop[1])) m.chunks.delete(c);
      }
    }
  }

  async preload(a, b, onProgress) {
    const need = this.needed(a, b).filter(([f, c]) => !this.isLoaded(f, c));
    let done = 0;
    const q = [...need];
    const worker = async () => { while (q.length) { const [f, c] = q.shift(); await this.loadChunk(f, c); done++; onProgress?.(done / need.length); } };
    await Promise.all(Array.from({ length: Math.min(12, q.length) }, worker));
  }

  // baixa a música toda em segundo plano (vai para o cache do navegador e completa as formas de onda)
  async background() {
    const total = Math.ceil(this.length / CHUNK);
    for (let c = 0; c <= total && !this.destroyed; c++) {
      const list = this.needed(c * CHUNK, (c + 1) * CHUNK).filter(([f, k]) => !this.isLoaded(f, k));
      for (const [f, k] of list) {
        if (this.destroyed) return;
        while (this.buffering && !this.destroyed) await new Promise((r) => setTimeout(r, 150));   // a prioridade é tocar
        const m = this.media.get(f);
        const pk = m.peaks?.[Math.floor(k * CHUNK * PEAK_RATE) * 2];
        if (m.format?.codec === "decode") { await this.loadFull(m).catch(() => {}); continue; }
        if (pk === undefined || Number.isNaN(pk)) await this.loadChunk(f, k, { keep: false }).catch(() => {});
      }
      this.dispatch("background", { progress: Math.min(1, (c + 1) / (total + 1)) });
    }
  }

  // ------------------------------------------------------------- transporte
  position() { return this.playing ? Math.min(this.length, this.p0 + (this.ctx.currentTime - this.t0)) : this.pos; }

  async play() {
    if (this.playing || this.destroyed) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.pos >= this.length - 0.05) this.pos = this.loop ? this.loop[0] : 0;
    this.buffering = true; this.dispatch("state");
    const tPlay = performance.now();
    // começa assim que o primeiro trecho de cada faixa chega; o resto vem enquanto toca
    try { await this.preload(this.pos, this.pos + 1, (p) => this.dispatch("loading", { progress: p })); }
    catch (e) { this.buffering = false; this.dispatch("state"); this.dispatch("error", { message: e.message }); return; }
    if (this.destroyed) return;
    this.buffering = false;
    if (this.timings) this.timings.play = Math.round(performance.now() - tPlay);
    this.t0 = this.ctx.currentTime + 0.08; this.p0 = this.pos;
    this.playing = true; this.scheduled.clear();
    this.scheduleItemEnvelopes();
    this.tick();
    this.timer = setInterval(() => this.tick(), 40);
    this.dispatch("state");
  }

  pause() {
    if (!this.playing) return;
    this.pos = this.position();
    this.halt();
    this.dispatch("state");
  }
  halt() {
    this.playing = false;
    clearInterval(this.timer); this.timer = null;
    for (const s of this.sources) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} }
    this.sources.clear(); this.scheduled.clear();
    for (const t of this.tracks) for (const it of t.items) if (it.env) { try { it.env.disconnect(); } catch {} it.env = null; }
  }
  stop() { this.halt(); this.pos = 0; this.dispatch("state"); this.dispatch("seek"); }
  async seek(t) {
    t = Math.max(0, Math.min(this.length, t));
    const was = this.playing;
    if (was) this.halt();
    this.pos = t;
    this.dispatch("seek");
    if (was) await this.play(); else this.dispatch("state");
  }
  setLoop(region) { this.loop = region; this.dispatch("state"); }

  // nó de ganho por item (volume do item + fade in/out), recriado a cada início
  scheduleItemEnvelopes() {
    for (const t of this.tracks) for (const it of t.items) {
      const g = this.ctx.createGain();
      g.connect(t.input);
      const v = it.volume ?? 1;
      const at = (pt) => this.t0 + (pt - this.p0);
      const p = g.gain;
      const fi = Math.min(it.fadeIn || 0, it.length), fo = Math.min(it.fadeOut || 0, it.length);
      const start = it.position, end = it.position + it.length;
      const valueAt = (x) => {
        let k = 1;
        if (fi > 0 && x < start + fi) k = Math.max(0, (x - start) / fi);
        if (fo > 0 && x > end - fo) k = Math.min(k, Math.max(0, (end - x) / fo));
        return v * k;
      };
      p.setValueAtTime(valueAt(Math.max(this.p0, start)), this.ctx.currentTime);
      if (fi > 0 && start + fi > this.p0) { p.setValueAtTime(valueAt(Math.max(this.p0, start)), at(Math.max(this.p0, start))); p.linearRampToValueAtTime(v, at(start + fi)); }
      if (fo > 0 && end > this.p0) { p.setValueAtTime(valueAt(Math.max(this.p0, end - fo)), at(Math.max(this.p0, end - fo))); p.linearRampToValueAtTime(0, at(end)); }
      it.env = g;
    }
  }

  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const pos = this.position();
    // repetição (região selecionada ou música inteira)
    const loopEnd = this.loop ? this.loop[1] : this.repeat ? this.length : null;
    if (loopEnd != null && pos >= loopEnd - 0.02) { this.seek(this.loop ? this.loop[0] : 0); return; }
    if (pos >= this.length) { this.halt(); this.pos = this.length; this.dispatch("state"); this.dispatch("ended"); return; }
    const horizon = Math.min(this.length, pos + LOOKAHEAD, loopEnd ?? Infinity);
    let missing = null;
    for (const t of this.tracks) for (const it of t.items) {
      const m = this.media.get(it.fileId);
      const s = Math.max(pos, it.position), e = Math.min(horizon, it.position + it.length);
      if (e <= s) continue;
      const decode = m.format?.codec === "decode";
      const fs = s - it.position + it.offset;
      const fe = e - it.position + it.offset;
      const c0 = decode ? 0 : Math.floor(Math.max(0, fs) / CHUNK), c1 = decode ? 0 : Math.floor(Math.max(0, fe - 1e-9) / CHUNK);
      for (let c = c0; c <= c1; c++) {
        const key = `${t.idx}:${t.items.indexOf(it)}:${c}`;
        if (this.scheduled.has(key)) continue;
        const buf = decode ? m.full : m.chunks.get(c)?.buf;
        if (!buf) { missing ??= { fileId: it.fileId, c, at: decode ? 0 : Math.max(0, c * CHUNK - it.offset + it.position) }; continue; }
        // trecho do arquivo coberto por este buffer
        const bufStartF = decode ? 0 : c * CHUNK;
        const bufEndF = bufStartF + buf.duration;
        const itemStartF = it.offset, itemEndF = it.offset + it.length;
        const segStartF = Math.max(bufStartF, itemStartF, this.p0 - it.position + it.offset);
        const segEndF = Math.min(bufEndF, itemEndF);
        if (segEndF <= segStartF) { this.scheduled.add(key); continue; }
        const projStart = it.position + (segStartF - it.offset);
        let when = this.t0 + (projStart - this.p0);
        let offset = segStartF - bufStartF;
        let dur = segEndF - segStartF;
        if (when < now) { const late = now - when; offset += late; dur -= late; when = now; }
        if (dur <= 0) { this.scheduled.add(key); continue; }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(it.env || t.input);
        src.start(when, offset, dur);
        src.onended = () => { this.sources.delete(src); try { src.disconnect(); } catch {} };
        this.sources.add(src);
        this.scheduled.add(key);
        if (m.chunks.get(c)) m.chunks.get(c).used = performance.now();
      }
    }
    if (missing && missing.at - pos < 0.25) { this.stall(); return; }
    // carregamento antecipado e limpeza de memória
    const ahead = this.needed(pos, Math.min(this.length, pos + AHEAD)).filter(([f, c]) => !this.isLoaded(f, c) && !this.media.get(f).loading.has(c));
    for (const [f, c] of ahead.slice(0, 10)) this.loadChunk(f, c).catch((e) => this.dispatch("error", { message: e.message }));
    if (Math.random() < 0.05) this.evict();
  }

  // conexão lenta: pausa todas as faixas juntas, espera carregar e continua do mesmo ponto
  async stall() {
    const at = this.position();
    this.halt();
    this.pos = at;
    this.dispatch("state");
    await this.play();
  }

  levels() {
    const read = (an) => { const a = new Float32Array(an.fftSize); an.getFloatTimeDomainData(a); let m = 0; for (const v of a) { const x = Math.abs(v); if (x > m) m = x; } return m; };
    return { master: read(this.masterAn), tracks: this.tracks.map((t) => read(t.an)) };
  }

  peaksFor(fileId) { return this.media.get(fileId)?.peaks || null; }
  static get PEAK_RATE() { return PEAK_RATE; }

  destroy() {
    this.destroyed = true;
    this.halt();
    for (const m of this.media.values()) { m.chunks.clear(); m.full = null; }
    try { this.ctx?.close(); } catch {}
  }
}

export const dbToGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const gainToDb = (g) => (g <= 0.001 ? -Infinity : 20 * Math.log10(g));
