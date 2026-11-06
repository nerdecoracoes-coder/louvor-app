// Padrão de tela da letra: margens, alinhamento e posição de nome da parte e rodapé.
// Cada igreja ajusta o seu; o mesmo padrão vale na visualização e no PowerPoint.
import { esc, attr } from "../core.js";
import { ratioOf } from "./pptx.js";

export const DEFAULT_LAYOUT = { mx: 4, mt: 10, mb: 10, align: "ctr", anchor: "ctr", spacing: 100, label: "tl", footer: "bottom", footerSize: 16, labelSize: 18 };
export const layoutOf = (l) => ({ ...DEFAULT_LAYOUT, ...(l || {}) });

export function letraBoxes(s, st) {
  const L = layoutOf(st.layout), cap = !!st.caps, big = s.size || st.size || 54;
  const out = [{ text: s.text, size: big, caps: cap, x: L.mx / 100, y: L.mt / 100, w: 1 - (2 * L.mx) / 100, h: Math.max(0.1, 1 - (L.mt + L.mb) / 100), align: L.align, anchor: L.anchor, line: L.spacing / 100 }];
  if (st.showLabel && s.label && L.label !== "off") out.push({ text: s.label, size: L.labelSize, x: 0.03, y: 0.03, w: 0.94, h: 0.09, align: L.label === "tr" ? "r" : "l", anchor: "t", alpha: 0.6, bold: false, caps: cap });
  if (s.footer && L.footer !== "off") out.push({ text: s.footer, size: L.footerSize, x: 0.03, y: L.footer === "top" ? 0.02 : 0.9, w: 0.94, h: 0.08, anchor: L.footer === "top" ? "t" : "b", alpha: 0.65, bold: false, caps: false });
  return out;
}

// título da música (slide de abertura da música)
export const titleBoxes = (title, artist, st) => [{ text: title, size: Math.min((st.size || 54) + 10, 72), y: 0.25, h: 0.3, anchor: "b", caps: !!st.caps }, { text: artist || "", size: 32, y: 0.58, h: 0.2, anchor: "t", alpha: 0.85, bold: false }];

export function thumbOf(boxes, { bg = "#000", color = "#fff", font = "Arial", ratio = "16:9", img = "", dim = 0, big = false } = {}) {
  const [a, b] = ratioOf(ratio);
  const inner = boxes.map((x) => {
    const sz = (x.size || 54) / 9.6, al = { l: "left", r: "right" }[x.align] || "center", jc = { t: "flex-start", b: "flex-end" }[x.anchor] || "center";
    return `<div class="tb" style="left:${(x.x ?? 0.04) * 100}%;top:${(x.y ?? 0.06) * 100}%;width:${(x.w ?? 0.92) * 100}%;height:${(x.h ?? 0.88) * 100}%;font-size:${sz}cqw;line-height:${1.15 * (x.line || 1)};text-align:${al};justify-content:${jc};font-weight:${x.bold === false ? 400 : 700};opacity:${x.alpha ?? 1}"><span>${esc(x.caps ? String(x.text || "").toUpperCase() : x.text || "")}</span></div>`;
  }).join("");
  return `<div class="thumb st" style="aspect-ratio:${a} / ${b};background:${attr(bg)};color:${attr(color)};font-family:'${attr(font)}',sans-serif${big ? ";width:100%" : ""}">${img ? `<img src="${attr(img)}" alt="" loading="lazy">` : ""}${dim ? `<i class="dim" style="opacity:${dim}"></i>` : ""}${inner}</div>`;
}
