// Leitura do cabeçalho de arquivos WAV/RF64/BWF a partir dos primeiros bytes.
// Com isso o player consegue buscar só o trecho necessário (por intervalos de bytes) e montar o
// áudio sem decodificar o arquivo inteiro na memória.
export interface WavFormat {
  codec: "pcm" | "float";
  sampleRate: number;
  channels: number;
  bits: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
  frames: number;
  duration: number;
}

export class WavNeedMore extends Error { constructor(public need: number) { super("need more bytes"); } }

export function parseWavHeader(buf: Uint8Array, fileSize?: number): WavFormat {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.length < 12) throw new WavNeedMore(64 * 1024);
  const riff = tag(0);
  if ((riff !== "RIFF" && riff !== "RF64" && riff !== "BW64") || tag(8) !== "WAVE") throw new Error("Não é um arquivo WAV.");
  let pos = 12;
  let fmt: Partial<WavFormat> & { formatTag?: number } = {};
  let ds64Data: number | null = null;
  while (pos + 8 <= buf.length) {
    const id = tag(pos);
    let size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "ds64" && body + 24 <= buf.length) {
      // RF64: tamanho real do bloco de dados em 64 bits
      ds64Data = Number(dv.getBigUint64(body + 8, true));
    } else if (id === "fmt ") {
      if (body + 16 > buf.length) throw new WavNeedMore(body + 16 + 1024);
      let formatTag = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      const blockAlign = dv.getUint16(body + 12, true);
      const bits = dv.getUint16(body + 14, true);
      if (formatTag === 0xfffe && size >= 40 && body + 26 <= buf.length) formatTag = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { formatTag, channels, sampleRate, blockAlign, bits };
    } else if (id === "data") {
      if (!fmt.formatTag) throw new Error("WAV sem bloco de formato antes dos dados.");
      if (size === 0xffffffff && ds64Data != null) size = ds64Data;
      let dataBytes = size;
      if (fileSize && body + dataBytes > fileSize) dataBytes = fileSize - body; // arquivo truncado/gravando
      const codec = fmt.formatTag === 1 ? "pcm" : fmt.formatTag === 3 ? "float" : null;
      if (!codec) throw new Error(`Formato WAV não suportado (código ${fmt.formatTag}).`);
      if (codec === "pcm" && ![8, 16, 24, 32].includes(fmt.bits!)) throw new Error(`PCM de ${fmt.bits} bits não suportado.`);
      if (codec === "float" && ![32, 64].includes(fmt.bits!)) throw new Error(`Float de ${fmt.bits} bits não suportado.`);
      const frames = Math.floor(dataBytes / fmt.blockAlign!);
      return { codec, sampleRate: fmt.sampleRate!, channels: fmt.channels!, bits: fmt.bits!, blockAlign: fmt.blockAlign!,
        dataOffset: body, dataBytes, frames, duration: frames / fmt.sampleRate! };
    }
    pos = body + size + (size & 1);
  }
  throw new WavNeedMore(Math.max(pos + 8 + 1024, buf.length * 4));
}

export function isWavName(name: string) { return /\.(wav|wave|bwf|rf64)$/i.test(name); }
export function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ({ wav: "audio/wav", wave: "audio/wav", bwf: "audio/wav", rf64: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac",
    ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aif: "audio/aiff", aiff: "audio/aiff" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}
