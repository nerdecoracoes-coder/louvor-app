// Gerador de QR Code (modo byte, correção M, versões 1–10): sem dependências, funciona offline.
// Uso: qrSvg("https://...") devolve um <svg> pronto; qrMatrix(texto) devolve a matriz de módulos.
const EC_M = { // versão: [codewords de correção por bloco, [blocos, dados por bloco], ...]
  1: [10, [1, 16]], 2: [16, [1, 28]], 3: [26, [1, 44]], 4: [18, [2, 32]], 5: [24, [2, 43]], 6: [16, [4, 27]],
  7: [18, [4, 31]], 8: [22, [2, 38], [2, 39]], 9: [22, [3, 36], [2, 37]], 10: [26, [4, 43], [1, 44]] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

// ---- Reed-Solomon sobre GF(256)
const EXP = new Array(512), LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); } g = next; } return g; }
function rsEc(data, n) {
  const g = rsGen(n), res = new Array(n).fill(0);
  for (const d of data) { const f = d ^ res[0]; res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= gmul(g[i + 1], f); }
  return res;
}
const bch = (v, poly, bits) => { let r = v << bits; const hi = (n) => 31 - Math.clz32(n); while (r && hi(r) >= hi(poly)) r ^= poly << (hi(r) - hi(poly)); return r; };

function dataCapacity(v) { const e = EC_M[v]; let n = 0; for (let i = 1; i < e.length; i++) n += e[i][0] * e[i][1]; return n; }

function encodeData(bytes, v) {
  const cap = dataCapacity(v), bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = []; for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
  // blocos + correção, intercalados
  const e = EC_M[v], blocks = [];
  let pos = 0;
  for (let i = 1; i < e.length; i++) for (let k = 0; k < e[i][0]; k++) { const d = out.slice(pos, pos + e[i][1]); pos += e[i][1]; blocks.push({ d, ec: rsEc(d, e[0]) }); }
  const final = [], maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) final.push(b.d[i]);
  for (let i = 0; i < e[0]; i++) for (const b of blocks) final.push(b.ec[i]);
  return final;
}

const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

function build(codewords, v, mask) {
  const n = 17 + 4 * v, m = Array.from({ length: n }, () => new Array(n).fill(null)), fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < n && c < n) { m[r][c] = val; fn[r][c] = true; } };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)); set(r0 + r, c0 + c, on); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(n - 8, 8, true); // módulo escuro fixo
  // áreas reservadas do formato e da versão
  const reserve = (r, c) => { if (!fn[r][c]) set(r, c, false); };   // não apaga o padrão de tempo
  for (let i = 0; i < 9; i++) { reserve(8, i); reserve(i, 8); }
  for (let i = 0; i < 8; i++) { reserve(8, n - 1 - i); reserve(n - 1 - i, 8); }
  set(n - 8, 8, true);
  if (v >= 7) { const info = (v << 12) | bch(v, 0x1f25, 12); for (let i = 0; i < 18; i++) { const bit = !!((info >> i) & 1), a = Math.floor(i / 3), b = (i % 3) + n - 11; set(a, b, bit); set(b, a, bit); } }
  // dados em zigue-zague
  const bits = []; for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let bi = 0, up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const cc of [c, c - 1]) {
        if (fn[r][cc]) continue;
        let bit = bi < bits.length ? bits[bi++] === 1 : false;
        if (MASKS[mask](r, cc)) bit = !bit;
        m[r][cc] = bit;
      }
    }
    up = !up;
  }
  // informação de formato (nível M = 00)
  const fmt = (((0 << 3) | mask) << 10 | bch((0 << 3) | mask, 0x537, 10)) ^ 0x5412;
  const f = (i) => !!((fmt >> i) & 1);
  for (let i = 0; i <= 5; i++) m[i][8] = f(i);
  m[7][8] = f(6); m[8][8] = f(7); m[8][7] = f(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = f(i);
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = f(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = f(i);
  m[n - 8][8] = true;
  return m;
}

function penalty(m) {
  const n = m.length; let p = 0;
  for (let r = 0; r < n; r++) for (const line of [m[r], m.map((x) => x[r])]) {
    let run = 1; for (let i = 1; i < n; i++) { if (line[i] === line[i - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
    for (let i = 0; i + 10 < n; i++) {
      const s = line.slice(i, i + 11).map((x) => (x ? 1 : 0)).join("");
      if (s === "10111010000" || s === "00001011101") p += 40;
    }
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
  let dark = 0; for (const row of m) for (const x of row) if (x) dark++;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1; while (v <= 10 && bytes.length + (v < 10 ? 2 : 3) > dataCapacity(v)) v++;
  if (v > 10) throw new Error("texto longo demais para o QR");
  const cw = encodeData(bytes, v);
  let best = null, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) { const m = build(cw, v, mask); const p = penalty(m); if (p < bestP) { bestP = p; best = m; } }
  return best;
}

export function qrSvg(text, { size = 220, margin = 4, fg = "#000", bg = "#fff" } = {}) {
  const m = qrMatrix(text), n = m.length, t = n + margin * 2;
  let d = ""; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${t}" height="${t}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
