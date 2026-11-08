// Padrão de tela da letra: margens, alinhamento e posição de nome da parte e rodapé.
// Cada igreja ajusta o seu; o mesmo padrão vale na visualização e no PowerPoint.
import { esc, attr } from "../core.js";
import { ratioOf, applyCaps } from "./pptx.js";

export const DEFAULT_LAYOUT = { mx: 4, mt: 10, mb: 10, align: "ctr", anchor: "ctr", spacing: 100, label: "tl", footer: "bottom", footerSize: 16, labelSize: 18 };
export const layoutOf = (l) => ({ ...DEFAULT_LAYOUT, ...(l || {}) });

// Simulador ProPresenter: ajustes de caixa (forma) e de texto, valem para a música toda ou só para um slide
export const DEFAULT_PP = {
  shape: { x: null, y: null, w: null, h: null, rot: 0, opacity: 1, fill: { on: false, color: "#000000" }, stroke: { on: false, color: "#ffffff", w: 2 } },
  tx: { font: null, bold: true, italic: false, underline: false, strike: false, caps: null, color: null, align: null, anchor: null,
    stroke: { on: false, color: "#000000", w: 2 }, shadow: { on: false, color: "#000000", op: 1, angle: 315, off: 6, blur: 6 } },
  trans: "none", over: {},
};
const merge = (a, b) => { const o = { ...a }; for (const k in b || {}) if (b[k] !== undefined) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a?.[k] && typeof a[k] === "object" ? merge(a[k], b[k]) : b[k]; return o; };
export const ppOf = (pp, idx) => { const base = merge({ shape: DEFAULT_PP.shape, tx: DEFAULT_PP.tx }, { shape: pp?.shape, tx: pp?.tx }); const o = pp?.over?.[idx]; return o ? merge(base, o) : base; };

export function letraBoxes(s, st) {
  const L = layoutOf({ ...(st.layout || {}), ...(s.layout || {}) }), big = s.size || st.size || 54;
  const P = ppOf(st.pp, s.idx), sh = P.shape, tx = P.tx;
  const geo = { x: sh.x ?? L.mx / 100, y: sh.y ?? L.mt / 100, w: sh.w ?? 1 - (2 * L.mx) / 100, h: sh.h ?? Math.max(0.1, 1 - (L.mt + L.mb) / 100) };
  const out = [{ text: s.text, size: tx.size || big, caps: tx.caps ?? !!st.caps, ...geo, align: tx.align || L.align, anchor: tx.anchor || L.anchor, line: L.spacing / 100,
    font: tx.font || undefined, color: tx.color || undefined, bold: tx.bold, italic: tx.italic, underline: tx.underline, strike: tx.strike, tstroke: tx.stroke, shadow: tx.shadow,
    rot: sh.rot, opacity: sh.opacity, fill: sh.fill, stroke: sh.stroke, main: true }];
  if (st.showLabel && s.label && L.label !== "off") out.push({ text: s.label, size: L.labelSize, x: 0.03, y: 0.03, w: 0.94, h: 0.09, align: L.label === "tr" ? "r" : "l", anchor: "t", alpha: 0.6, bold: false, caps: !!st.caps });
  if (s.footer && L.footer !== "off") out.push({ text: s.footer, size: L.footerSize, x: 0.03, y: L.footer === "top" ? 0.02 : 0.9, w: 0.94, h: 0.08, anchor: L.footer === "top" ? "t" : "b", alpha: 0.65, bold: false });
  return out;
}

// título da música (slide de abertura da música)
export const titleBoxes = (title, artist, st) => [{ text: title, size: Math.min((st.size || 54) + 10, 72), y: 0.25, h: 0.3, anchor: "b", caps: !!st.caps }, { text: artist || "", size: 32, y: 0.58, h: 0.2, anchor: "t", alpha: 0.85, bold: false }];

const rgba = (h, a = 1) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return `rgba(0,0,0,${a})`; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
// um ponto da lâmina = 1/9,6 da largura (a lâmina tem 960 pt): cqw = pt / 9,6
const cq = (v) => `${((v || 0) / 9.6).toFixed(3)}cqw`;
function boxStyle(x) {
  const sz = (x.size || 54) / 9.6, al = { l: "left", r: "right", just: "justify" }[x.align] || "center", jc = { t: "flex-start", b: "flex-end" }[x.anchor] || "center";
  const op = (x.opacity ?? 1), css = [`left:${(x.x ?? 0.04) * 100}%`, `top:${(x.y ?? 0.06) * 100}%`, `width:${(x.w ?? 0.92) * 100}%`, `height:${(x.h ?? 0.88) * 100}%`,
    `font-size:${sz}cqw`, `line-height:${1.15 * (x.line || 1)}`, `text-align:${al}`, `justify-content:${jc}`, `font-weight:${x.bold === false ? 400 : 700}`, `opacity:${(x.alpha ?? 1) * op}`];
  if (x.font) css.push(`font-family:'${attr(x.font)}',sans-serif`);
  if (x.color) css.push(`color:${attr(x.color)}`);
  if (x.italic) css.push("font-style:italic");
  const deco = [x.underline && "underline", x.strike && "line-through"].filter(Boolean); if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
  if (x.rot) css.push(`transform:rotate(${x.rot}deg)`);
  if (x.fill?.on) css.push(`background:${rgba(x.fill.color)}`);
  if (x.stroke?.on) css.push(`box-shadow:inset 0 0 0 ${cq(x.stroke.w || 2)} ${rgba(x.stroke.color, 1)}`);
  if (x.tstroke?.on) css.push(`-webkit-text-stroke:${cq(x.tstroke.w || 2)} ${attr(x.tstroke.color || "#000")};paint-order:stroke fill`);
  if (x.shadow?.on) { const r = ((x.shadow.angle || 0) * Math.PI) / 180, o = x.shadow.off || 0; css.push(`text-shadow:${cq(Math.cos(r) * o)} ${cq(-Math.sin(r) * o)} ${cq(x.shadow.blur)} ${rgba(x.shadow.color, x.shadow.op ?? 1)}`); }
  return css.join(";");
}
export function thumbOf(boxes, { bg = "#000", color = "#fff", font = "Arial", ratio = "16:9", img = "", dim = 0, big = false } = {}) {
  const [a, b] = ratioOf(ratio);
  const inner = boxes.map((x, i) => `<div class="tb" ${x.main ? 'data-main="1"' : ""} style="${boxStyle(x)}"><span>${esc(applyCaps(x.text || "", x.caps))}</span></div>`).join("");
  return `<div class="thumb st" style="aspect-ratio:${a} / ${b};background:${attr(bg)};color:${attr(color)};font-family:'${attr(font)}',sans-serif${big ? ";width:100%" : ""}">${img ? `<img src="${attr(img)}" alt="" loading="lazy">` : ""}${dim ? `<i class="dim" style="opacity:${dim}"></i>` : ""}${inner}</div>`;
}
