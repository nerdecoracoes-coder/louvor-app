// Compressão de vídeo no próprio aparelho: reproduz o vídeo escolhido, redesenha em tamanho menor (720p) e regrava
// com taxa de bits calculada para caber no limite. Leva quase o tempo do vídeo, porque a gravação é ao vivo.
export const LIMIT = 45 * 1024 * 1024;          // alvo de tamanho final (o limite do servidor é 50 MB)
export const SKIP_UNDER = 20 * 1024 * 1024;     // abaixo disso envia o original, sem comprimir
const AUDIO_BPS = 96_000;

const MIMES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
export const mimeFor = () => (typeof MediaRecorder === "undefined" ? null : MIMES.find((m) => MediaRecorder.isTypeSupported?.(m)) || null);
export const canCompress = () => !!mimeFor() && !!HTMLCanvasElement.prototype.captureStream;
export const extOf = (mime) => (/mp4/.test(mime) ? "mp4" : "webm");

// taxa de vídeo (bits/s) que cabe em `limit` bytes para essa duração; null se nem a mínima cabe
export function bitrateFor(seconds, limit = LIMIT) {
  const total = (limit * 8) / Math.max(1, seconds) - AUDIO_BPS;
  if (total < 250_000) return null;
  return Math.min(2_200_000, Math.round(total * 0.95));
}
export const maxSeconds = (limit = LIMIT) => Math.floor((limit * 8) / (250_000 + AUDIO_BPS));

const load = (url) => new Promise((res, rej) => {
  const v = document.createElement("video");
  v.preload = "auto"; v.playsInline = true; v.setAttribute("playsinline", ""); v.src = url;
  v.onloadedmetadata = () => res(v);
  v.onerror = () => {
    const c = v.error?.code;
    rej(new Error(c === 4 ? "O navegador não consegue ler este formato de vídeo (provavelmente 4K ou HEVC). Grave em HD com o formato mais compatível ou cole um link. [erro 4]" : `Não consegui abrir este vídeo. Tente outro arquivo. [erro ${c ?? "?"}]`));
  };
});
const seek = (v, t) => new Promise((res) => { const f = () => { v.removeEventListener("seeked", f); res(); }; v.addEventListener("seeked", f); v.currentTime = t; });

// Miniatura (JPEG pequeno em texto) tirada de um quadro do vídeo.
function frameThumb(v, w = 360) {
  const h = Math.round((w * v.videoHeight) / v.videoWidth), c = document.createElement("canvas");
  c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.62);
}

// Devolve { blob, mime, ext, thumb, seconds, compressed }. onProgress(0..1, texto). cancel: { stop: false } (marque stop = true).
export async function compress(file, onProgress = () => {}, cancel = { stop: false }) {
  const url = URL.createObjectURL(file);
  let lock = null, ctx = null;
  try {
    const v = await load(url);
    const seconds = v.duration;
    if (!isFinite(seconds) || seconds <= 0) throw new Error("Não consegui ler a duração deste vídeo.");
    await seek(v, Math.min(1, seconds / 2));
    const thumb = frameThumb(v);
    // vídeo já leve: envia o original
    if (file.size <= SKIP_UNDER) return { blob: file, mime: file.type || "video/mp4", ext: (file.name.split(".").pop() || "mp4").toLowerCase(), thumb, seconds, compressed: false };
    const mime = mimeFor();
    if (!mime || !HTMLCanvasElement.prototype.captureStream) throw new Error("Este navegador não consegue comprimir vídeo. Use o Chrome ou cole um link.");
    const vbps = bitrateFor(seconds);
    if (!vbps) throw new Error(`Este vídeo é longo demais (${Math.round(seconds / 60)} min). O máximo é cerca de ${Math.floor(maxSeconds() / 60)} min. Corte o vídeo ou cole um link.`);
    // tamanho: lado menor em 720
    const sw = v.videoWidth, sh = v.videoHeight, k = Math.min(1, 720 / Math.min(sw, sh));
    const W = Math.round((sw * k) / 2) * 2, H = Math.round((sh * k) / 2) * 2;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const stream = cv.captureStream(30);
    // áudio do próprio vídeo, sem sair no alto-falante
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(v), dest = ctx.createMediaStreamDestination();
    ctx.resume?.(); src.connect(dest); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: AUDIO_BPS });
    const chunks = []; rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const done = new Promise((res) => { rec.onstop = res; });
    try { lock = await navigator.wakeLock?.request("screen"); } catch { /* sem bloqueio de tela */ }
    await seek(v, 0);
    rec.start(1000);
    await v.play();
    await new Promise((res, rej) => {
      const draw = () => {
        if (cancel.stop) return res();
        g.drawImage(v, 0, 0, W, H);
        onProgress(Math.min(1, v.currentTime / seconds), `Preparando o vídeo… ${Math.round((v.currentTime / seconds) * 100)}%`);
        if (v.ended) return res();
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
      };
      v.onended = res; v.onerror = () => rej(new Error("O vídeo parou de tocar. Tente de novo."));
      draw();
    });
    v.pause();
    if (rec.state !== "inactive") rec.stop();
    await done;
    if (cancel.stop) throw Object.assign(new Error("cancelado"), { cancelled: true });
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    if (blob.size > 50 * 1024 * 1024) throw new Error("Mesmo comprimido, o vídeo passou de 50 MB. Corte o vídeo ou cole um link.");
    return { blob, mime: mime.split(";")[0], ext: extOf(mime), thumb, seconds, compressed: true };
  } finally {
    try { await lock?.release(); } catch { /* ok */ }
    try { await ctx?.close(); } catch { /* ok */ }
    URL.revokeObjectURL(url);
  }
}

// Só a miniatura (sem comprimir). Se o navegador não abrir o vídeo (4K/HEVC), devolve null: o envio continua sem miniatura.
export async function thumbnail(file, ms = 8000) {
  const url = URL.createObjectURL(file);
  try {
    return await Promise.race([
      (async () => { const v = await load(url); await seek(v, Math.min(1, (v.duration || 2) / 2)); return frameThumb(v); })(),
      new Promise((res) => setTimeout(() => res(null), ms)),
    ]);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
