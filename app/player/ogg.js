// Leitura de arquivos Ogg Opus (versão leve das faixas). Usado pelo player e pelo conversor.
// O player baixa só o trecho de bytes necessário (com ~0,1 s de pré-rolagem, como recomenda a RFC 7845)
// e o índice de páginas, gerado na conversão, diz onde cada instante do áudio começa no arquivo.

const OGGS = 0x5367674f; // "OggS" em little-endian

// Páginas Ogg completas dentro de `bytes` (começando em `base` no arquivo).
export function parsePages(bytes, base = 0) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages = [];
  let p = 0;
  while (p + 27 <= bytes.length) {
    if (dv.getUint32(p, true) !== OGGS) { p++; continue; } // ressincroniza
    const flags = bytes[p + 5];
    const granule = Number(dv.getBigInt64(p + 6, true));
    const nseg = bytes[p + 26];
    if (p + 27 + nseg > bytes.length) break;
    const lacing = bytes.subarray(p + 27, p + 27 + nseg);
    let size = 0; for (const l of lacing) size += l;
    const start = p + 27 + nseg;
    if (start + size > bytes.length) break;
    // pacotes: segmentos de 255 continuam o pacote; o último segmento < 255 fecha
    const packets = []; let cur = []; let off = start;
    for (const l of lacing) { cur.push(bytes.subarray(off, off + l)); off += l; if (l < 255) { packets.push(concat(cur)); cur = []; } }
    const openTail = cur.length ? concat(cur) : null; // pacote que continua na próxima página
    pages.push({ offset: base + p, length: start + size - p, granule, continued: !!(flags & 1), bos: !!(flags & 2), packets, openTail });
    p = start + size;
  }
  return pages;
}
function concat(parts) {
  if (parts.length === 1) return parts[0];
  const n = parts.reduce((s, x) => s + x.length, 0); const out = new Uint8Array(n); let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// Duração (em amostras a 48 kHz) de um pacote Opus, pelo byte TOC (RFC 6716, 3.1).
export function opusSamples(pkt) {
  if (!pkt?.length) return 0;
  const toc = pkt[0], cfg = toc >> 3;
  const fs = cfg < 12 ? [480, 960, 1920, 2880][cfg & 3] : cfg < 16 ? [480, 960][cfg & 1] : [120, 240, 480, 960][cfg & 3];
  const c = toc & 3;
  const n = c === 0 ? 1 : c < 3 ? 2 : (pkt[1] ?? 0) & 0x3f;
  return fs * n;
}

// Cabeçalho OpusHead: canais e pre-skip.
export function opusHead(pkt) {
  const s = new TextDecoder().decode(pkt.subarray(0, 8));
  if (s !== "OpusHead") throw new Error("Arquivo Opus inválido (sem OpusHead)");
  const dv = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
  return { channels: pkt[9], preskip: dv.getUint16(10, true), inputRate: dv.getUint32(12, true), mapping: pkt[18] };
}

// Índice de busca: para cada página de áudio, [granule no fim da página, posição em bytes].
export function buildIndex(bytes) {
  const pages = parsePages(bytes);
  if (pages.length < 2) throw new Error("Arquivo Opus incompleto");
  const head = opusHead(pages[0].packets[0]);
  const audio = pages.slice(2); // 1ª página: OpusHead; 2ª: OpusTags
  const audioStart = audio[0]?.offset ?? bytes.length;
  const index = audio.filter((pg) => pg.granule >= 0).map((pg) => [pg.granule, pg.offset]);
  const total = index.length ? index[index.length - 1][0] - head.preskip : 0;
  return { ...head, audioStart, bytes: bytes.length, samples: total, index };
}

// Intervalo de bytes a baixar para obter as amostras [s0, s1) (em amostras de saída, sem o pre-skip),
// com pré-rolagem de pelo menos `pre` amostras antes de s0.
export function byteRange(info, s0, s1, pre = 4800) {
  const { index, preskip, audioStart, bytes } = info;
  const g0 = s0 + preskip - pre, g1 = s1 + preskip;
  // primeira página a ler: a última cujo INÍCIO (fim da anterior) está antes de g0
  let a = 0;
  for (let i = 1; i < index.length; i++) { if (index[i - 1][0] <= g0) a = i; else break; }
  // última página: a primeira que termina em ou depois de g1 (+1 para cobrir pacotes que continuam)
  let b = index.length - 1;
  for (let i = a; i < index.length; i++) { if (index[i][0] >= g1) { b = Math.min(index.length - 1, i + 1); break; } }
  const start = a === 0 ? audioStart : index[a][1];
  const end = (b + 1 < index.length ? index[b + 1][1] : bytes) - 1;
  return { start, end };
}

// Pacotes de áudio completos de um trecho, cada um com a amostra (de saída) em que começa.
export function packetsFrom(bytes, base, info) {
  const pages = parsePages(bytes, base);
  const out = [];
  let carry = null; // pedaço de pacote que começou na página anterior
  for (const pg of pages) {
    if (pg.offset < info.audioStart) { carry = null; continue; }
    let pk = pg.packets;
    if (pg.continued) {
      if (carry && pk.length) pk = [concat([carry, pk[0]]), ...pk.slice(1)];
      else if (carry && !pk.length) { carry = pg.openTail ? concat([carry, pg.openTail]) : carry; continue; }
      else pk = pk.slice(1); // começo do pacote ficou fora do trecho baixado
    }
    carry = pg.openTail && (pg.continued || pg.packets.length) ? pg.openTail : null;
    if (pg.granule < 0 || !pk.length) continue;
    // granule = amostras até o fim do último pacote fechado nesta página; as posições são contadas de trás para frente
    let t = pg.granule;
    const pos = new Array(pk.length);
    for (let i = pk.length - 1; i >= 0; i--) { t -= opusSamples(pk[i]); pos[i] = t; }
    pk.forEach((p, i) => out.push({ pkt: p, at: pos[i] - info.preskip }));
  }
  return out;
}

// Decodifica o trecho baixado e devolve exatamente as amostras [s0, s1) de cada canal.
// `decoder` é um OpusDecoder (opus-decoder) recém-reiniciado; a pré-rolagem descartada acerta o estado dele.
export function decodeRange(decoder, bytes, base, info, s0, s1) {
  const n = Math.max(0, s1 - s0);
  const chans = Array.from({ length: info.channels > 1 ? 2 : 1 }, () => new Float32Array(n));
  const pk = packetsFrom(bytes, base, info);
  let pos = null;
  for (const { pkt, at } of pk) {
    if (pos === null) pos = at;                       // a partir daqui o decodificador anda junto com o tempo
    else if (at !== pos) pos = at;                    // salto (não deve ocorrer dentro de um trecho contínuo)
    const r = decoder.decodeFrame(pkt);
    const got = r.samplesDecoded;
    const a = Math.max(s0, pos), b = Math.min(s1, pos + got);
    if (b > a) for (let c = 0; c < chans.length; c++) {
      const src = r.channelData[Math.min(c, r.channelData.length - 1)];
      chans[c].set(src.subarray(a - pos, b - pos), a - s0);
    }
    pos += got;
    if (pos >= s1) break;
  }
  return chans;
}
