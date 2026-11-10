// Tons musicais: "C", "C#", "Db", "Am", "F#m", "Bb"… → semitons entre dois tons.
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11, "B#": 0 };
export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// { root: 0-11, minor: bool } ou null se não der para entender
export function parseKey(s) {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)\s*(m|min|menor|-)?\s*$/.exec(String(s || "").replace("♯", "#").replace("♭", "b"));
  if (!m) return null;
  const name = m[1].toUpperCase() + (m[2] || "");
  if (!(name in PC)) return null;
  return { root: PC[name], minor: !!m[3] };
}
// menor caminho em semitons de `from` até `to`, entre -6 e +5 (0 se não entender algum dos dois)
export function semitonesBetween(from, to) {
  const a = parseKey(from), b = parseKey(to);
  if (!a || !b) return 0;
  let d = (b.root - a.root) % 12; if (d < 0) d += 12;
  return d > 5 ? d - 12 : d;
}
// nome do tom depois de subir/descer `st` semitons (usa sustenidos)
export function transposeKey(key, st) {
  const k = parseKey(key); if (!k) return key || "";
  return SHARP_NAMES[(((k.root + st) % 12) + 12) % 12] + (k.minor ? "m" : "");
}
export const normKey = (s) => { const k = parseKey(s); return k ? SHARP_NAMES[k.root] + (k.minor ? "m" : "") : (String(s || "").trim() || null); };
