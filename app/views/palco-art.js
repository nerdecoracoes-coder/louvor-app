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

const SH = `<ellipse cx="50" cy="93" rx="40" ry="5" fill="rgba(0,0,0,.45)"/>`;
const defs = (id, a, b) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;

const ART = {
  drums: () => `${defs("gd", "#f0902f", "#b3500d")}${SH}
    <path d="M20 30v38M82 34v36M50 22v22" stroke="#8a8f98" stroke-width="1.6"/>
    <ellipse cx="20" cy="29" rx="15" ry="3.6" fill="#e6b940"/><ellipse cx="82" cy="33" rx="14" ry="3.4" fill="#e6b940"/>
    <rect x="30" y="40" width="18" height="13" rx="3.5" fill="url(#gd)"/><ellipse cx="39" cy="40" rx="9" ry="2.6" fill="#f3efe6"/>
    <rect x="52" y="40" width="18" height="13" rx="3.5" fill="url(#gd)"/><ellipse cx="61" cy="40" rx="9" ry="2.6" fill="#f3efe6"/>
    <circle cx="50" cy="71" r="21" fill="url(#gd)"/><circle cx="50" cy="71" r="16.5" fill="#121216"/><circle cx="50" cy="71" r="4.5" fill="#d9731c"/>
    <path d="M18 74h22" stroke="#8a8f98" stroke-width="1.4"/><ellipse cx="22" cy="72" rx="11" ry="4.6" fill="#e9e6df"/><rect x="11" y="72" width="22" height="7" rx="2" fill="url(#gd)"/>
    <path d="M86 52v22" stroke="#8a8f98" stroke-width="1.4"/><ellipse cx="86" cy="50" rx="9" ry="2.6" fill="#d9a82f"/>`,
  keys: () => `${SH}
    <path d="M22 64l-8 26M78 64l8 26M22 64l56 26M78 64l-56 26" stroke="#6b707a" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="6" y="34" width="88" height="30" rx="4" fill="#1a1a1f" stroke="#2c2c34"/>
    <rect x="10" y="48" width="80" height="14" rx="1.5" fill="#f1efe9"/>
    ${Array.from({ length: 15 }, (_, i) => `<path d="M${10 + i * 5.33} 48v14" stroke="#c9c6bd" stroke-width=".5"/>`).join("")}
    ${[1, 2, 4, 5, 6, 8, 9, 11, 12, 13].map((k) => `<rect x="${10 + k * 5.33 - 1.7}" y="48" width="3.4" height="8.5" fill="#15151a"/>`).join("")}
    <circle cx="18" cy="41" r="2" fill="#e0603a"/><circle cx="26" cy="41" r="2" fill="#5aa0ff"/><rect x="60" y="39" width="28" height="4" rx="2" fill="#2f2f38"/>`,
  eguitar: () => `${defs("ge", "#f3b04a", "#6b1d0a")}${SH}
    <path d="M30 92l20-22M70 92L52 70" stroke="#6b707a" stroke-width="2.4" stroke-linecap="round"/>
    <g transform="rotate(18 50 52)">
      <rect x="47" y="6" width="6" height="46" rx="1.5" fill="#5b3b22"/><rect x="45.5" y="2" width="9" height="11" rx="2.5" fill="#2a2018"/>
      <path d="M50 44c-14-3-24 6-22 18 1 6-4 8-3 14 2 8 12 12 25 12s23-4 25-12c1-6-4-8-3-14 2-12-8-21-22-18z" fill="url(#ge)" stroke="#2a0c04" stroke-width="1"/>
      <rect x="40" y="58" width="20" height="4" rx="1.5" fill="#1a1a1f"/><rect x="40" y="68" width="20" height="4" rx="1.5" fill="#1a1a1f"/>
      <circle cx="62" cy="80" r="2" fill="#d8d8d8"/><circle cx="38" cy="80" r="2" fill="#d8d8d8"/>
    </g>`,
  bass: () => `${defs("gb", "#f6c744", "#b8860b")}${SH}
    <rect x="62" y="48" width="32" height="42" rx="3" fill="#17171c" stroke="#2c2c34"/><circle cx="78" cy="68" r="11" fill="#0b0b0e" stroke="#3a3a44"/><circle cx="78" cy="68" r="4" fill="#26262e"/><rect x="66" y="52" width="24" height="4" rx="1" fill="#2c2c34"/>
    <path d="M18 92l16-20M46 92L34 72" stroke="#6b707a" stroke-width="2.2" stroke-linecap="round"/>
    <g transform="rotate(12 32 52)">
      <rect x="29.5" y="4" width="5" height="48" rx="1.4" fill="#4a2f1a"/><rect x="28" y="1" width="8" height="10" rx="2" fill="#2a2018"/>
      <path d="M32 46c-11-2-19 6-17 16 1 5-3 7-2 12 2 7 10 10 19 10s17-3 19-10c1-5-3-7-2-12 2-10-6-18-17-16z" fill="url(#gb)" stroke="#6b4a06" stroke-width="1"/>
      <rect x="23" y="60" width="18" height="4" rx="1.5" fill="#1a1a1f"/><rect x="23" y="69" width="18" height="4" rx="1.5" fill="#1a1a1f"/>
    </g>`,
  acoustic: () => `${defs("ga", "#e6b469", "#9a6126")}${SH}
    <path d="M32 92l18-20M68 92L52 72" stroke="#6b707a" stroke-width="2.4" stroke-linecap="round"/>
    <g transform="rotate(-10 50 52)">
      <rect x="47.5" y="4" width="5" height="44" rx="1.4" fill="#4a2f1a"/><rect x="46" y="0" width="8" height="10" rx="2" fill="#3a2616"/>
      <path d="M50 42c-10-1-17 5-16 12 1 4-2 6-5 9-4 5-3 12 3 16 6 4 12 5 18 5s12-1 18-5c6-4 7-11 3-16-3-3-6-5-5-9 1-7-6-13-16-12z" fill="url(#ga)" stroke="#5a3513" stroke-width="1"/>
      <circle cx="50" cy="66" r="6.5" fill="#241509"/><rect x="40" y="80" width="20" height="3" rx="1.2" fill="#3b2412"/>
    </g>`,
  mic: () => `${SH}
    <ellipse cx="50" cy="90" rx="17" ry="4.6" fill="#15151a" stroke="#34343c"/>
    <path d="M50 88V34" stroke="#8a8f98" stroke-width="2.6" stroke-linecap="round"/><path d="M50 34l-9-14" stroke="#8a8f98" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="34" y="8" width="10" height="17" rx="5" transform="rotate(-32 39 16)" fill="#2b2b33" stroke="#4a4a54"/><path d="M33 12l8 12" stroke="#6b6b76" stroke-width="1" transform="rotate(0)"/>
    <circle cx="50" cy="52" r="2.4" fill="#5b5f69"/>`,
};

// o desenho do instrumento (SVG) ou, para funções desconhecidas, um disco com o ícone da função
export function instrumentArt(name) {
  const k = instrumentKind(name);
  if (k === "other") return `<span class="art-other">${icon(roleIcon(name))}</span>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${ART[k]()}</svg>`;
}
