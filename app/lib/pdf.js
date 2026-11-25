// PDF mínimo (sem dependências): A4, Helvetica (WinAnsi), títulos, parágrafos, tabelas e barras. Serve aos relatórios.
const W = 595.28, H = 841.89, M = 40;
const CP = { "–": 0x96, "—": 0x97, "•": 0x95, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "…": 0x85, "€": 0x80 };
function enc(s) {
  let o = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    const b = CP[ch] ?? (c < 256 ? c : 63);
    o += b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b < 32 ? " " : String.fromCharCode(b);
  }
  return o;
}
// larguras médias de Helvetica por faixa (1000 = 1 em); suficiente para quebrar linhas sem estourar a margem
const cw = (ch) => (ch === " " ? 278 : /[ilI.,;:'|!]/.test(ch) ? 250 : /[fjrt()\-]/.test(ch) ? 330 : /[mwMW]/.test(ch) ? 830 : /[A-Z0-9%]/.test(ch) ? 640 : 530);
const tw = (s, size) => (String(s).split("").reduce((a, c) => a + cw(c), 0) * size) / 1000;
function wrap(text, size, width) {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + w : w;
      if (tw(t, size) <= width || !line) line = t; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
function clip(s, size, width) { s = String(s ?? ""); if (tw(s, size) <= width) return s; while (s.length > 1 && tw(s + "…", size) > width) s = s.slice(0, -1); return s + "…"; }

// blocks: {h}, {h2}, {p}, {small}, {table:{head:[], rows:[[]], widths?:[]}}, {bars:[{label,n,pct}]}, {gap}
export function buildPdf({ title, footer = "", blocks }) {
  const pages = []; let ops = [], y = H - M;
  const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = H - M; };
  const need = (h) => { if (y - h < M + 24) newPage(); };
  const text = (s, x, size, bold) => ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${enc(s)}) Tj ET`);
  const rect = (x, yy, w, h, g) => ops.push(`${g} g ${x.toFixed(1)} ${yy.toFixed(1)} ${Math.max(w, 0).toFixed(1)} ${h.toFixed(1)} re f 0 g`);
  const para = (s, size, bold, lead = 1.35) => { for (const l of wrap(s, size, W - 2 * M)) { need(size * lead); y -= size * lead; text(l, M, size, bold); } };
  for (const b of blocks) {
    if (b.h) { need(40); y -= 6; para(b.h, 17, true); y -= 2; }
    else if (b.h2) { need(30); y -= 10; para(b.h2, 12, true); y -= 2; }
    else if (b.p) { para(b.p, 10); y -= 2; }
    else if (b.small) { para(b.small, 8.5); y -= 2; }
    else if (b.gap) y -= b.gap;
    else if (b.bars) {
      const max = Math.max(1, ...b.bars.map((x) => x.n));
      for (const r of b.bars) { need(16); y -= 13; text(clip(r.label, 9, 170), M, 9); rect(M + 180, y - 2, (r.n / max) * 230, 9, 0.35); text(`${r.n}${r.pct != null ? `  (${String(r.pct).replace(".", ",")}%)` : ""}`, M + 190 + (r.n / max) * 230, 9); }
      y -= 4;
    } else if (b.table) {
      const { head, rows } = b.table, n = head.length, avail = W - 2 * M, ws = b.table.widths || head.map(() => avail / n);
      const row = (cells, bold) => { need(15); y -= 12; let x = M; cells.forEach((c, i) => { text(clip(c, 8.5, ws[i] - 6), x, 8.5, bold); x += ws[i]; }); ops.push(`${M} ${(y - 3).toFixed(1)} m ${W - M} ${(y - 3).toFixed(1)} l 0.8 G 0.4 w S 0 G`); };
      row(head, true); for (const r of rows) { if (y - 15 < M + 24) { newPage(); row(head, true); } row(r.map((v) => v ?? ""), false); }
      y -= 6;
    }
  }
  newPage();
  // montagem
  const objs = []; const add = (s) => (objs.push(s), objs.length);
  add("<< /Type /Catalog /Pages 2 0 R >>"); add(""); add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  pages.forEach((p, i) => {
    const foot = `BT /F1 8 Tf ${M} 22 Td (${enc(clip(footer, 8, W - 2 * M - 70))}) Tj ET BT /F1 8 Tf ${W - M - 50} 22 Td (${enc(`Página ${i + 1} de ${pages.length}`)}) Tj ET`;
    const body = p.join("\n") + "\n" + foot;
    const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  add(`<< /Title (${enc(title)}) /Producer (SOMOS) >>`);
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xr = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xr}\n%%EOF`;
  const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255;
  return u;
}
