// Convenção de nomes: "Nome da música - Nome do artista - BPM (Tom)"
// Ex.: "Emaús - Morada - 140 BPM (B)"  ->  { title: "Emaús", artist: "Morada", bpm: 140, key: "B" }
// Regras para evitar interpretações erradas:
//  - o separador é " - " (hífen com espaços); hífens dentro de palavras ("Pós-Moderno") são preservados;
//  - o último bloco precisa ser "<número> BPM (<tom>)"; o bloco anterior é o artista; o resto é o título
//    (assim "Te Louvarei - Ao Vivo - Morada - 140 BPM (B)" vira título "Te Louvarei - Ao Vivo");
//  - o tom só é aceito se for um tom musical válido (C, C#, Db, Am, F#m, Bb...); caso contrário fica
//    registrado como aviso e o valor original é mantido para revisão.

export interface ParsedName {
  title: string;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  matched: boolean;          // seguiu a convenção completa
  warnings: string[];
}

const KEY_RE = /^([A-Ga-g])\s*(#|♯|b|♭)?\s*(m|min|menor|-)?$/;

export function normalizeKey(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, "");
  const m = s.match(KEY_RE);
  if (!m) return null;
  const note = m[1].toUpperCase();
  const acc = m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : (m[2] ?? "");
  const minor = m[3] ? "m" : "";
  return note + acc + minor;
}

function clean(s: string) {
  return s.normalize("NFC").replace(/[ \s]+/g, " ").trim();
}

export function stripProjectExt(name: string) {
  return name.replace(/\.(rpp|rpp-bak)$/i, "");
}

export function parseProjectName(input: string): ParsedName {
  const name = clean(stripProjectExt(input));
  const warnings: string[] = [];
  // aceita " - ", " – " e " — " como separadores (com espaços dos dois lados)
  const parts = name.split(/\s+[-–—]\s+/).map(clean).filter(Boolean);
  const tail = parts[parts.length - 1] ?? "";
  const bpmKey = tail.match(/^(\d{2,3}(?:[.,]\d{1,2})?)\s*bpm\s*(?:\(\s*([^)]+?)\s*\)|\[\s*([^\]]+?)\s*\])?$/i);

  if (parts.length >= 3 && bpmKey) {
    const bpm = Number(bpmKey[1].replace(",", "."));
    const rawKey = bpmKey[2] ?? bpmKey[3] ?? null;
    let key: string | null = null;
    if (rawKey) {
      key = normalizeKey(rawKey);
      if (!key) { key = rawKey; warnings.push(`Tom "${rawKey}" não reconhecido como tom musical; mantido como está.`); }
    } else warnings.push("Tom não informado no nome do projeto.");
    if (!(bpm >= 20 && bpm <= 400)) warnings.push(`BPM ${bpm} fora do intervalo esperado.`);
    return {
      title: parts.slice(0, -2).join(" - "),
      artist: parts[parts.length - 2],
      bpm: bpm >= 20 && bpm <= 400 ? bpm : null,
      key, matched: !!rawKey && warnings.length === 0, warnings,
    };
  }

  // "Título - Artista" (sem BPM/tom), como no nome da pasta do exemplo
  if (parts.length >= 2 && !bpmKey) {
    warnings.push("Nome fora do padrão completo (faltam BPM e tom).");
    return { title: parts.slice(0, -1).join(" - "), artist: parts[parts.length - 1], bpm: null, key: null, matched: false, warnings };
  }
  if (parts.length === 2 && bpmKey) {
    // "Título - 140 BPM (B)" sem artista
    const rawKey = bpmKey[2] ?? bpmKey[3] ?? null;
    warnings.push("Artista não informado no nome do projeto.");
    return { title: parts[0], artist: null, bpm: Number(bpmKey[1].replace(",", ".")), key: rawKey ? normalizeKey(rawKey) ?? rawKey : null, matched: false, warnings };
  }
  warnings.push("Nome fora do padrão \"Música - Artista - BPM (Tom)\".");
  return { title: name, artist: null, bpm: null, key: null, matched: false, warnings };
}

// Escolhe a melhor fonte de metadados: nome do .rpp (completo) > nome da pasta.
export function bestName(rppName: string | null, folderName: string): ParsedName & { from: "rpp" | "folder" } {
  const a = rppName ? parseProjectName(rppName) : null;
  const b = parseProjectName(folderName);
  if (a?.matched) return { ...a, from: "rpp" };
  if (b.matched) return { ...b, from: "folder" };
  if (a && (a.bpm || a.key)) return { ...a, artist: a.artist ?? b.artist, from: "rpp" };
  return { ...b, bpm: b.bpm ?? a?.bpm ?? null, key: b.key ?? a?.key ?? null, from: "folder" };
}
