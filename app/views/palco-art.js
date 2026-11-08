// Instrumentos do palco: imagens (recortes com fundo transparente) e o tamanho de cada um no mapa.
// O tipo vem do nome da função; o que não se reconhece vira um disco com o ícone da função.
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

// largura de cada instrumento, em % da largura do palco (antes do efeito de perspectiva)
export const ART_W = { drums: 46, keys: 28, eguitar: 24, bass: 25, acoustic: 18, mic: 10, other: 15 };
export const artWidth = (name) => ART_W[instrumentKind(name)];
export const ART_FILES = ["drums", "keys", "eguitar", "bass", "acoustic", "mic"].map((k) => `app/assets/palco/${k}.webp`);

export function instrumentArt(name) {
  const k = instrumentKind(name);
  if (k === "other") return `<span class="art-other">${icon(roleIcon(name))}</span>`;
  return `<img src="app/assets/palco/${k}.webp" alt="" draggable="false" decoding="async">`;
}
