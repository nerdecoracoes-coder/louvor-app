// Associa cada referência FILE do .RPP ao arquivo correspondente dentro da pasta da música no Drive.
// O REAPER pode gravar o caminho como relativo ("Tracks 1/Click.wav", "Click.wav") ou absoluto do
// computador onde o projeto foi salvo ("C:\Users\...\Emaús - Morada\Tracks 1\Click.wav").
export interface FolderFile { id: string; name: string; relPath: string; md5?: string | null; size?: number | null; modifiedTime?: string | null; mimeType?: string | null }
export interface Resolution { ref: string; file: FolderFile | null; how: "relative" | "suffix" | "name" | "name-ambiguous" | "missing"; candidates?: string[] }

const norm = (s: string) => s.normalize("NFC").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").trim();
const lower = (s: string) => norm(s).toLowerCase();
const segs = (s: string) => lower(s).split("/").filter((x) => x && x !== ".");

export function resolveRef(ref: string, files: FolderFile[], rppDir = ""): Resolution {
  const r = norm(ref);
  const isAbs = /^[a-zA-Z]:\//.test(r) || r.startsWith("/");
  const refSegs = segs(r);
  const base = refSegs[refSegs.length - 1] ?? "";

  if (!isAbs) {
    const want = lower((rppDir ? rppDir + "/" : "") + r).split("/").reduce<string[]>((acc, p) => {
      if (p === "..") acc.pop(); else if (p && p !== ".") acc.push(p);
      return acc;
    }, []).join("/");
    const hit = files.find((f) => lower(f.relPath) === want);
    if (hit) return { ref, file: hit, how: "relative" };
  }
  // maior sufixo de caminho em comum (ex.: ".../Tracks 1/Click.wav" -> "Tracks 1/Click.wav")
  let best: FolderFile | null = null, bestLen = 0, tie = false;
  for (const f of files) {
    const fs = segs(f.relPath);
    let k = 0;
    while (k < fs.length && k < refSegs.length && fs[fs.length - 1 - k] === refSegs[refSegs.length - 1 - k]) k++;
    if (k > bestLen) { best = f; bestLen = k; tie = false; } else if (k === bestLen && k > 0) tie = true;
  }
  if (best && bestLen >= 2 && !tie) return { ref, file: best, how: "suffix" };
  const byName = files.filter((f) => segs(f.relPath).pop() === base);
  if (byName.length === 1) return { ref, file: byName[0], how: "name" };
  if (byName.length > 1) {
    const sorted = [...byName].sort((a, b) => a.relPath.localeCompare(b.relPath));
    return { ref, file: best && bestLen >= 2 ? best : sorted[0], how: "name-ambiguous", candidates: sorted.map((f) => f.relPath) };
  }
  return { ref, file: null, how: "missing" };
}
