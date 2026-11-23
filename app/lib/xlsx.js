// Leitura e escrita mínimas de planilhas .xlsx (e leitura de .csv), sem dependências.
// Um .xlsx é um zip de arquivos XML: aqui só se lê a primeira aba e se escreve uma planilha simples (texto).
const te = new TextEncoder(), td = new TextDecoder("utf-8");

// ------------------------------------------------------------------ zip (leitura)
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Arquivo inválido: não é uma planilha .xlsx.");
  const total = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Arquivo .xlsx corrompido.");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(off + 26, true), lxlen = dv.getUint16(off + 28, true), start = off + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    files[name] = { method, raw };
    p += 46 + nlen + xlen + clen;
  }
  const read = async (name) => { const f = files[name]; if (!f) return null; return f.method === 0 ? f.raw : f.method === 8 ? inflateRaw(f.raw) : (() => { throw new Error("Compressão não suportada."); })(); };
  return { names: Object.keys(files), read };
}

// ------------------------------------------------------------------ zip (escrita, sem compressão)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) { // { nome: string | Uint8Array }
  const parts = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nb = te.encode(name), data = typeof content === "string" ? te.encode(content) : content, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let o = 0;
  for (const x of all) { out.set(x, o); o += x.length; }
  return out;
}

// ------------------------------------------------------------------ planilha
const xe = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

// rows: matriz de textos; sheets: [{ name, rows }] — devolve um Uint8Array .xlsx
export function buildXlsx(sheets) {
  const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="${Math.max(1, ...rows.map((r) => r.length))}" width="24" customWidth="1"/></cols><sheetData>${
    rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => (v === "" || v == null ? "" : `<c r="${colName(j)}${i + 1}" t="inlineStr"${i === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xe(v)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows); });
  return zip(files);
}

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const textOf = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

// primeira aba -> matriz de textos
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const shared = [];
  const ss = await z.read("xl/sharedStrings.xml");
  if (ss) for (const m of td.decode(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  let target = "xl/worksheets/sheet1.xml";
  const wb = await z.read("xl/workbook.xml"), rels = await z.read("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(td.decode(wb))?.[1];
    const rel = rid && [...td.decode(rels).matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((x) => new RegExp(`Id="${rid}"`).test(x));
    const t = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    if (t) target = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
  }
  const sx = await z.read(target);
  if (!sx) throw new Error("A planilha não tem nenhuma aba com dados.");
  const rows = [];
  for (const rm of td.decode(sx).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = []; let seq = 0;
    for (const cm of (rm[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || "", ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1], type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : seq; seq = idx + 1;
      let v = "";
      if (type === "s") v = shared[+(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? -1)] ?? "";
      else if (type === "inlineStr") v = textOf(body);
      else v = unxml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      r[idx] = v.trim();
    }
    for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = "";
    rows.push(r);
  }
  return rows;
}

// .csv simples (aceita ; ou , e aspas)
export function readCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "", sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur.trim()); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur.trim()); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}

export async function readSpreadsheet(file) {
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  if (u8[0] === 0x50 && u8[1] === 0x4b) return readXlsx(u8);
  if (/\.xls$/i.test(file.name || "")) throw new Error("Esse é o formato antigo (.xls). Salve a planilha como .xlsx ou .csv e tente de novo.");
  return readCsv(td.decode(u8));
}
