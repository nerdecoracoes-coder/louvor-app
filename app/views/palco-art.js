// Desenhos dos instrumentos do palco (SVG próprio do app, vistos de frente em leve perspectiva).
// O tipo vem do nome da função; o que não se reconhece vira um ícone genérico.
import { icon, roleIcon } from "../core.js";

export function instrumentKind(name = "") {
  const n = name.toLowerCase();
  if (/bateria|perc|cajon/.test(n)) return "drums";
  if (/teclado|piano|synth|keys|órgão|orgao/.test(n)) return "keys";
  if (/baixo/.test(n)) return "bass";
  if (/guitarra/.test(n)) return "eguitar";
  if (/viol|cavaq|ukul|banjo/.test(n)) return "acoustic";
  if (/vocal|voz|ministro|soprano|contralto|tenor|back|cantor|louvor/.test(n)) return "mic";
  return "other";
}

const SH = `<ellipse cx="50" cy="94" rx="42" ry="4.6" fill="rgba(0,0,0,.55)"/><ellipse cx="50" cy="94" rx="26" ry="2.6" fill="rgba(0,0,0,.5)"/>`;
const CH = `<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6d727c"/><stop offset=".35" stop-color="#f1f4f8"/><stop offset=".6" stop-color="#9aa0aa"/><stop offset="1" stop-color="#555a63"/></linearGradient>`;
const GOLD = `<radialGradient id="gold" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff0a6"/><stop offset=".45" stop-color="#e4b73a"/><stop offset="1" stop-color="#8a6212"/></radialGradient>`;
const ORG = `<linearGradient id="org" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f3d07"/><stop offset=".3" stop-color="#ff9a3c"/><stop offset=".65" stop-color="#d86b12"/><stop offset="1" stop-color="#76300a"/></linearGradient>`;
const cym = (cx, cy, rx) => `<ellipse cx="${cx}" cy="${cy + 1.2}" rx="${rx}" ry="${rx * .24}" fill="rgba(0,0,0,.35)"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * .24}" fill="url(#gold)" stroke="#7a560f" stroke-width=".5"/><ellipse cx="${cx}" cy="${cy}" rx="${rx * .62}" ry="${rx * .13}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".5"/><ellipse cx="${cx}" cy="${cy}" rx="${rx * .14}" ry="${rx * .04}" fill="#5c4108"/>`;
const tom = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.6" fill="url(#org)"/><ellipse cx="${x + w / 2}" cy="${y + h}" rx="${w / 2}" ry="2.2" fill="#7a3a0a"/><rect x="${x}" y="${y + 1.5}" width="${w}" height="1.6" fill="url(#chrome)" opacity=".85"/><rect x="${x}" y="${y + h - 3}" width="${w}" height="1.6" fill="url(#chrome)" opacity=".85"/><ellipse cx="${x + w / 2}" cy="${y}" rx="${w / 2}" ry="2.6" fill="#f4efe4" stroke="url(#chrome)" stroke-width="1"/>`;

const ART = {
  drums: () => `<defs>${CH}${GOLD}${ORG}<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(200,225,245,.22)"/><stop offset=".5" stop-color="rgba(200,225,245,.05)"/><stop offset="1" stop-color="rgba(200,225,245,.16)"/></linearGradient><radialGradient id="bd" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#2a2a30"/><stop offset="1" stop-color="#08080a"/></radialGradient></defs>
    <path d="M3 93L10 76H90L97 93Z" fill="#0d0d10" stroke="#34343c" stroke-width=".8"/><path d="M10 76H90" stroke="#4a4a54" stroke-width="1.2"/>
    <path d="M12 12H88L91 66H9Z" fill="url(#glass)" stroke="rgba(205,228,247,.55)" stroke-width=".8"/><path d="M37 12L36 66M63 12L64 66" stroke="rgba(205,228,247,.35)" stroke-width=".6"/><path d="M16 14L30 64" stroke="rgba(255,255,255,.18)" stroke-width="3"/>
    <path d="M20 32V66M82 36V68M50 22V44" stroke="url(#chrome)" stroke-width="1.6"/>
    ${cym(20, 31, 15)}${cym(82, 35, 14)}
    ${tom(30, 42, 18, 13)}${tom(52, 42, 18, 13)}
    <circle cx="50" cy="73" r="22" fill="url(#org)"/><circle cx="50" cy="73" r="22" fill="none" stroke="url(#chrome)" stroke-width="2"/><circle cx="50" cy="73" r="17.5" fill="url(#bd)" stroke="#c9ced8" stroke-width=".9"/><circle cx="50" cy="73" r="5.5" fill="none" stroke="#d98a2e" stroke-width="1"/><circle cx="50" cy="73" r="1.6" fill="#d98a2e"/>
    <ellipse cx="22" cy="75" rx="12" ry="4.8" fill="#f1ece0" stroke="url(#chrome)" stroke-width="1"/><rect x="10" y="75" width="24" height="7" rx="2.2" fill="url(#org)"/><rect x="10" y="76.5" width="24" height="1.4" fill="url(#chrome)"/>
    <path d="M87 56V78" stroke="url(#chrome)" stroke-width="1.4"/><ellipse cx="87" cy="54" rx="9.5" ry="2.4" fill="url(#gold)"/><ellipse cx="87" cy="57.5" rx="9.5" ry="2.4" fill="url(#gold)" opacity=".85"/>`,
  keys: () => `<defs>${CH}<linearGradient id="kb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c33"/><stop offset="1" stop-color="#101014"/></linearGradient><linearGradient id="kw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfccc2"/></linearGradient></defs>${SH}
    <path d="M20 66L10 92M80 66L90 92M18 70L82 90M82 70L18 90" stroke="url(#chrome)" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="5" y="30" width="90" height="38" rx="5" fill="url(#kb)" stroke="#3a3a44"/><rect x="8" y="33" width="84" height="9" rx="2" fill="#0a0a0d"/>
    <rect x="12" y="35" width="20" height="5" rx="1" fill="#143a52"/><circle cx="42" cy="37.5" r="2" fill="#e0603a"/><circle cx="49" cy="37.5" r="2" fill="#5aa0ff"/><circle cx="56" cy="37.5" r="2" fill="#9ad05a"/><rect x="66" y="35" width="22" height="5" rx="2.5" fill="#2a2a33"/>
    <rect x="8" y="46" width="84" height="19" rx="1.8" fill="url(#kw)"/>
    ${Array.from({ length: 16 }, (_, i) => `<path d="M${8 + i * 5.25} 46v19" stroke="#b9b6ac" stroke-width=".45"/>`).join("")}
    ${[1, 2, 4, 5, 6, 8, 9, 11, 12, 13].map((k) => `<rect x="${8 + k * 5.25 - 1.8}" y="46" width="3.6" height="11.5" rx=".6" fill="#111115"/><rect x="${8 + k * 5.25 - 1.3}" y="46" width="1" height="9" fill="rgba(255,255,255,.18)"/>`).join("")}`,
  eguitar: () => `<defs>${CH}<linearGradient id="ge" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#ffd37a"/><stop offset=".45" stop-color="#e0792a"/><stop offset="1" stop-color="#5a1306"/></linearGradient><linearGradient id="nk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a2414"/><stop offset=".5" stop-color="#7a5232"/><stop offset="1" stop-color="#3a2414"/></linearGradient></defs>${SH}
    <path d="M28 93L48 74M72 93L54 74" stroke="url(#chrome)" stroke-width="2.4" stroke-linecap="round"/>
    <g transform="rotate(16 50 54)">
      <rect x="46.8" y="5" width="6.4" height="48" rx="1.6" fill="url(#nk)"/>${Array.from({ length: 8 }, (_, i) => `<path d="M46.8 ${12 + i * 5}h6.4" stroke="#c8ccd2" stroke-width=".5"/>`).join("")}
      <path d="M45 3h10l1 9H44z" fill="#241a12" stroke="#4a3626" stroke-width=".6"/><circle cx="47.5" cy="6" r="1" fill="url(#chrome)"/><circle cx="52.5" cy="6" r="1" fill="url(#chrome)"/><circle cx="47.5" cy="9.5" r="1" fill="url(#chrome)"/><circle cx="52.5" cy="9.5" r="1" fill="url(#chrome)"/>
      <path d="M50 42c-14-4-25 6-23 19 1 6-4 8-3 14 2 9 12 13 26 13s24-4 26-13c1-6-4-8-3-14 2-13-9-23-23-19z" fill="url(#ge)" stroke="#2a0a03" stroke-width="1.1"/>
      <path d="M50 42c-14-4-25 6-23 19 1 6-4 8-3 14" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M40 58c8-3 12-3 20 0v10c-8 3-12 3-20 0z" fill="#17171c" opacity=".92"/><rect x="38" y="59" width="24" height="3.4" rx="1.4" fill="url(#chrome)"/><rect x="38" y="68" width="24" height="3.4" rx="1.4" fill="url(#chrome)"/>
      <path d="M42 80l16 0" stroke="url(#chrome)" stroke-width="2"/><circle cx="62" cy="79" r="2" fill="#d9dde3"/><circle cx="38" cy="79" r="2" fill="#d9dde3"/>
      <path d="M50 12V74" stroke="rgba(230,235,245,.45)" stroke-width=".35"/>
    </g>`,
  bass: () => `<defs>${CH}<linearGradient id="gb" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".5" stop-color="#e8a317"/><stop offset="1" stop-color="#7a4a06"/></linearGradient><linearGradient id="nk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a2414"/><stop offset=".5" stop-color="#7a5232"/><stop offset="1" stop-color="#3a2414"/></linearGradient><linearGradient id="amp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a31"/><stop offset="1" stop-color="#0d0d10"/></linearGradient></defs>${SH}
    <rect x="62" y="44" width="34" height="46" rx="3.5" fill="url(#amp)" stroke="#44444e"/><rect x="62" y="44" width="34" height="5" rx="2" fill="#1c1c22"/><rect x="66" y="45.6" width="14" height="2" rx=".8" fill="url(#chrome)"/><circle cx="79" cy="70" r="12.5" fill="#09090b" stroke="#55555f" stroke-width="1.2"/><circle cx="79" cy="70" r="8" fill="#17171c"/><circle cx="79" cy="70" r="2.6" fill="#33333b"/>
    <path d="M16 93l16-19M46 93L34 74" stroke="url(#chrome)" stroke-width="2.2" stroke-linecap="round"/>
    <g transform="rotate(10 32 54)">
      <rect x="29.3" y="3" width="5.4" height="50" rx="1.4" fill="url(#nk)"/>${Array.from({ length: 9 }, (_, i) => `<path d="M29.3 ${9 + i * 5}h5.4" stroke="#c8ccd2" stroke-width=".5"/>`).join("")}
      <path d="M28 0h8l.8 8h-9.6z" fill="#241a12" stroke="#4a3626" stroke-width=".5"/>
      <path d="M32 46c-12-3-20 6-18 17 1 5-3 7-2 12 2 8 11 11 20 11s18-3 20-11c1-5-3-7-2-12 2-11-6-20-18-17z" fill="url(#gb)" stroke="#5a3704" stroke-width="1"/>
      <path d="M32 46c-12-3-20 6-18 17" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="22" y="60" width="20" height="4" rx="1.5" fill="#17171c"/><rect x="22" y="69" width="20" height="4" rx="1.5" fill="#17171c"/><rect x="24" y="80" width="16" height="2.4" rx="1" fill="url(#chrome)"/>
    </g>`,
  acoustic: () => `<defs>${CH}<linearGradient id="ga" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#f4cf8a"/><stop offset=".5" stop-color="#d89a4a"/><stop offset="1" stop-color="#7c4617"/></linearGradient><linearGradient id="nk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a2414"/><stop offset=".5" stop-color="#7a5232"/><stop offset="1" stop-color="#3a2414"/></linearGradient></defs>${SH}
    <path d="M30 93L48 75M70 93L54 75" stroke="url(#chrome)" stroke-width="2.4" stroke-linecap="round"/>
    <g transform="rotate(-9 50 54)">
      <rect x="47.3" y="3" width="5.4" height="46" rx="1.4" fill="url(#nk)"/>${Array.from({ length: 8 }, (_, i) => `<path d="M47.3 ${10 + i * 5}h5.4" stroke="#c8ccd2" stroke-width=".5"/>`).join("")}
      <path d="M45.5 0h9l.8 10h-10.6z" fill="#3a2616" stroke="#5a3d26" stroke-width=".5"/>
      <path d="M50 40c-11-1-18 5-17 13 1 4-2 6-5 9-5 6-4 14 3 18 6 4 13 5 19 5s13-1 19-5c7-4 8-12 3-18-3-3-6-5-5-9 1-8-6-14-17-13z" fill="url(#ga)" stroke="#5a3513" stroke-width="1.1"/>
      <path d="M50 40c-11-1-18 5-17 13 1 4-2 6-5 9" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="50" cy="63" r="7.4" fill="#1d1107" stroke="#6b4420" stroke-width="1.4"/><circle cx="50" cy="63" r="9.6" fill="none" stroke="#3a2412" stroke-width=".8"/>
      <rect x="40" y="79" width="20" height="3.4" rx="1.4" fill="#3b2412"/><circle cx="43" cy="80.5" r=".7" fill="#e8e0d0"/><circle cx="50" cy="80.5" r=".7" fill="#e8e0d0"/><circle cx="57" cy="80.5" r=".7" fill="#e8e0d0"/>
      <path d="M50 8V80" stroke="rgba(235,235,225,.5)" stroke-width=".3"/>
    </g>`,
  mic: () => `<defs>${CH}<radialGradient id="mh" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#6a6e78"/><stop offset=".55" stop-color="#2a2c33"/><stop offset="1" stop-color="#101114"/></radialGradient></defs>${SH}
    <ellipse cx="50" cy="91" rx="18" ry="5" fill="#0e0e11" stroke="#3c3c45"/><ellipse cx="50" cy="89.6" rx="14" ry="3.4" fill="url(#chrome)" opacity=".5"/>
    <rect x="48.4" y="34" width="3.2" height="56" rx="1.4" fill="url(#chrome)"/><rect x="46.8" y="62" width="6.4" height="5" rx="1.4" fill="#2b2d33" stroke="#555963" stroke-width=".6"/>
    <path d="M50 35l-11-14" stroke="url(#chrome)" stroke-width="2.4" stroke-linecap="round"/>
    <g transform="rotate(-34 39 17)"><rect x="33" y="3" width="12" height="20" rx="6" fill="url(#mh)" stroke="#6d717b" stroke-width=".8"/><path d="M34 9h10M34 12.5h10M34 16h10" stroke="rgba(255,255,255,.18)" stroke-width=".6"/><rect x="34.5" y="21" width="9" height="4" rx="1.4" fill="#17181c" stroke="#555963" stroke-width=".5"/></g>`,
};

// o desenho do instrumento (SVG) ou, para funções desconhecidas, um disco com o ícone da função
export function instrumentArt(name) {
  const k = instrumentKind(name);
  if (k === "other") return `<span class="art-other">${icon(roleIcon(name))}</span>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${ART[k]()}</svg>`;
}
