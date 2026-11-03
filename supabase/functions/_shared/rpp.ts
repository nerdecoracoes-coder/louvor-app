// Interpretador de projetos REAPER (.RPP).
// O .RPP é texto: blocos começam com "<NOME args" e terminam com ">"; as demais linhas são "CHAVE valores".
// O arquivo NÃO contém os áudios: as faixas apontam para arquivos externos (linha FILE dentro de <SOURCE>).
// Este módulo:
//   1) lê a árvore completa (nada é descartado; a árvore fica preservada em "raw");
//   2) extrai o que o player usa (andamento, compasso, faixas, itens, volume, pan, mute, solo, pastas,
//      marcadores e regiões);
//   3) registra como aviso tudo que existe no projeto mas não é reproduzido pelo player (efeitos,
//      automações, envios, mudanças de andamento, takes múltiplos, playrate etc.).

export interface RppNode { name: string; args: string[]; lines: string[][]; children: RppNode[] }

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === " " || line[i] === "\t")) i++;
    if (i >= n) break;
    const q = line[i];
    if (q === '"' || q === "'" || q === "`") {
      const end = line.indexOf(q, i + 1);
      if (end === -1) { out.push(line.slice(i + 1)); break; }
      out.push(line.slice(i + 1, end));
      i = end + 1;
    } else {
      let j = i;
      while (j < n && line[j] !== " " && line[j] !== "\t") j++;
      out.push(line.slice(i, j));
      i = j;
    }
  }
  return out;
}

export function parseTree(text: string): RppNode {
  const root: RppNode = { name: "__root__", args: [], lines: [], children: [] };
  const stack: RppNode[] = [root];
  const rows = text.replace(/^﻿/, "").split(/\r?\n/);
  for (const rawLine of rows) {
    const line = rawLine.trim();
    if (!line) continue;
    const top = stack[stack.length - 1];
    if (line === ">") { if (stack.length > 1) stack.pop(); continue; }
    if (line.startsWith("<")) {
      const toks = tokenize(line.slice(1));
      const node: RppNode = { name: (toks[0] ?? "").toUpperCase(), args: toks.slice(1), lines: [], children: [] };
      top.children.push(node);
      stack.push(node);
      continue;
    }
    top.lines.push(tokenize(line));
  }
  if (stack.length !== 1) throw new RppError("Projeto .RPP incompleto ou corrompido (blocos não fechados).");
  const proj = root.children.find((c) => c.name === "REAPER_PROJECT");
  if (!proj) throw new RppError("O arquivo não é um projeto REAPER (bloco REAPER_PROJECT não encontrado).");
  return proj;
}

export class RppError extends Error {}

const num = (v: string | undefined, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const line = (n: RppNode, key: string) => n.lines.find((l) => l[0] === key);
const child = (n: RppNode, name: string) => n.children.find((c) => c.name === name);

export interface RppItem {
  position: number; length: number; offset: number;
  volume: number; muted: boolean;
  fadeIn: number; fadeOut: number; playrate: number;
  sourceType: string; fileRef: string | null; name: string | null;
  notes: string | null; takeCount: number; warnings: string[];
}
export interface RppTrack {
  idx: number; guid: string | null; name: string;
  volume: number; pan: number; muted: boolean; soloed: boolean; phaseInvert: boolean;
  color: number | null; isFolder: boolean; folderDepth: number; parentIdx: number | null;
  sendsToParent: boolean; items: RppItem[]; fx: string[]; warnings: string[];
  kind: "audio" | "folder" | "lyrics" | "midi" | "empty";
}
export interface RppMarker { idx: number; name: string; position: number; end: number | null; isRegion: boolean; color: number | null }
export interface RppProject {
  version: string | null; tempo: number | null; timeSigNum: number | null; timeSigDen: number | null;
  sampleRate: number | null; master: { volume: number; pan: number; muted: boolean };
  tracks: RppTrack[]; markers: RppMarker[]; length: number;
  warnings: string[]; lyrics: LyricsRaw | null; raw: RppNode;
}
export interface LyricsRaw { trackIdx: number; trackName: string; items: Array<Record<string, unknown>>; note: string }

const LYRICS_NAME = /^\s*(letra|letras|lyric|lyrics|lirica|lírica)\b/i;
const AUDIO_SOURCES = new Set(["WAVE", "MP3", "FLAC", "VORBIS", "OPUS", "WAVPACK", "AIFF", "OGG"]);

function readNotes(n: RppNode | undefined): string | null {
  if (!n) return null;
  // <NOTES ... > com linhas começando por "|"
  const text = n.lines.map((l) => l.join(" ").replace(/^\|/, "")).join("\n").trim();
  return text || null;
}

function parseSource(src: RppNode, warnings: string[]): { type: string; file: string | null; extraOffset: number } {
  const type = (src.args[0] ?? "").toUpperCase();
  if (type === "SECTION") {
    const inner = child(src, "SOURCE");
    const start = num(line(src, "STARTPOS")?.[1]);
    if (line(src, "MODE")) warnings.push("Item com seção invertida/especial (MODE): reproduzido sem esse efeito.");
    if (!inner) return { type: "SECTION", file: null, extraOffset: start };
    const r = parseSource(inner, warnings);
    return { ...r, extraOffset: r.extraOffset + start };
  }
  const f = line(src, "FILE");
  return { type, file: f ? f[1] ?? null : null, extraOffset: 0 };
}

function parseItem(it: RppNode): RppItem {
  const warnings: string[] = [];
  const position = num(line(it, "POSITION")?.[1]);
  const length = num(line(it, "LENGTH")?.[1]);
  let offset = num(line(it, "SOFFS")?.[1]);
  const vp = line(it, "VOLPAN");
  const volume = vp ? num(vp[1], 1) : 1;
  if (vp && ((vp[2] && Math.abs(num(vp[2])) > 1e-6) || (vp[3] && Math.abs(num(vp[3], 1) - 1) > 1e-6))) {
    warnings.push("Pan/volume de take do item não aplicados (apenas o volume do item é reproduzido).");
  }
  const muted = num(line(it, "MUTE")?.[1]) === 1;
  const fadeIn = num(line(it, "FADEIN")?.[2]);
  const fadeOut = num(line(it, "FADEOUT")?.[2]);
  const pr = line(it, "PLAYRATE");
  const playrate = pr ? num(pr[1], 1) : 1;
  if (Math.abs(playrate - 1) > 1e-6) warnings.push(`Item com velocidade alterada (PLAYRATE ${playrate}): reproduzido na velocidade original.`);
  const nameLine = line(it, "NAME");

  // Takes: as fontes aparecem em ordem; "TAKE" separa os takes e "TAKE SEL" marca o ativo.
  const sources = it.children.filter((c) => c.name === "SOURCE");
  let activeTake = 0, takeIdx = 0;
  for (const l of it.lines) if (l[0] === "TAKE") { takeIdx++; if (l[1] === "SEL") activeTake = takeIdx; }
  const takeCount = Math.max(sources.length, 1);
  if (sources.length > 1) warnings.push(`Item com ${sources.length} takes: usando o take ativo.`);
  const src = sources[Math.min(activeTake, sources.length - 1)];
  let sourceType = "EMPTY", fileRef: string | null = null;
  if (src) {
    const s = parseSource(src, warnings);
    sourceType = s.type; fileRef = s.file; offset += s.extraOffset;
  }
  return { position, length, offset, volume, muted, fadeIn, fadeOut, playrate, sourceType, fileRef,
    name: nameLine?.[1] ?? null, notes: readNotes(child(it, "NOTES")), takeCount, warnings };
}

function envelopeActive(env: RppNode | undefined): boolean {
  if (!env) return false;
  const act = line(env, "ACT");
  if (act && act[1] === "0") return false;
  const pts = env.lines.filter((l) => l[0] === "PT");
  if (pts.length < 2) return false;
  const v = pts.map((p) => num(p[2]));
  return v.some((x) => Math.abs(x - v[0]) > 1e-6);
}

function fxNames(chain: RppNode | undefined): string[] {
  if (!chain) return [];
  const out: string[] = [];
  // a linha BYPASS antecede cada plugin; "BYPASS 1" = desativado
  const bypass: number[] = chain.lines.filter((l) => l[0] === "BYPASS").map((l) => num(l[1]));
  let i = 0;
  for (const c of chain.children) {
    if (["VST", "VST3", "JS", "AU", "CLAP", "DX", "LV2", "VIDEO_EFFECT"].includes(c.name)) {
      if (bypass[i] !== 1) out.push(String(c.args[0] ?? c.name).replace(/^(VST3?i?|JS|AU|CLAPi?):\s*/i, ""));
      i++;
    }
  }
  return out;
}

export function parseRpp(text: string): RppProject {
  const proj = parseTree(text);
  const warnings: string[] = [];
  const tempoL = line(proj, "TEMPO");
  const tempo = tempoL ? num(tempoL[1]) || null : null;
  const timeSigNum = tempoL?.[2] ? num(tempoL[2]) || null : null;
  const timeSigDen = tempoL?.[3] ? num(tempoL[3]) || null : null;
  const srL = line(proj, "SAMPLERATE");
  const sampleRate = srL ? num(srL[1]) || null : null;

  const tempoEnv = child(proj, "TEMPOENVEX");
  if (tempoEnv && tempoEnv.lines.filter((l) => l[0] === "PT").length > 1) {
    warnings.push("O projeto tem mudanças de andamento/compasso. O áudio e os marcadores ficam corretos; a grade de compassos usa o andamento inicial.");
  }

  const mv = line(proj, "MASTER_VOLUME");
  const mms = line(proj, "MASTERMUTESOLO");
  const master = { volume: mv ? num(mv[1], 1) : 1, pan: mv ? num(mv[2], 0) : 0, muted: mms ? (num(mms[1]) & 1) === 1 : false };
  const masterFx = fxNames(child(proj, "MASTERFXLIST"));
  if (masterFx.length) warnings.push(`Efeitos no master não são reproduzidos: ${masterFx.join(", ")}.`);

  // Marcadores e regiões. Regiões aparecem como duas linhas MARKER com o mesmo índice (início e fim).
  const markers: RppMarker[] = [];
  const openRegions = new Map<number, RppMarker>();
  for (const l of proj.lines) {
    if (l[0] !== "MARKER") continue;
    const idx = num(l[1]); const pos = num(l[2]); const name = l[3] ?? ""; const flags = num(l[4]); const color = l[5] ? num(l[5]) || null : null;
    const isRegion = (flags & 1) === 1;
    if (isRegion) {
      const open = openRegions.get(idx);
      if (open && name === "") { open.end = pos; openRegions.delete(idx); continue; }
      const m = { idx, name, position: pos, end: null, isRegion: true, color };
      openRegions.set(idx, m); markers.push(m);
    } else markers.push({ idx, name, position: pos, end: null, isRegion: false, color });
  }
  markers.sort((a, b) => a.position - b.position || a.idx - b.idx);

  // Faixas e pastas
  const tracks: RppTrack[] = [];
  let depth = 0;
  const folderStack: number[] = [];
  proj.children.filter((c) => c.name === "TRACK").forEach((t, idx) => {
    const tw: string[] = [];
    const name = (line(t, "NAME")?.[1] ?? "").trim() || `Faixa ${idx + 1}`;
    const vp = line(t, "VOLPAN");
    const ms = line(t, "MUTESOLO");
    const isbus = line(t, "ISBUS");
    const delta = isbus ? num(isbus[2]) : 0;
    const isFolder = delta === 1;
    const items = t.children.filter((c) => c.name === "ITEM").map(parseItem);
    const fx = fxNames(child(t, "FXCHAIN"));
    if (fx.length) tw.push(`Efeitos não reproduzidos: ${fx.join(", ")}.`);
    for (const e of ["VOLENV2", "VOLENV", "VOLENV3"]) if (envelopeActive(child(t, e))) { tw.push("Automação de volume não reproduzida (é usado o volume fixo da faixa)."); break; }
    if (envelopeActive(child(t, "PANENV2")) || envelopeActive(child(t, "PANENV"))) tw.push("Automação de pan não reproduzida.");
    if (envelopeActive(child(t, "MUTEENV"))) tw.push("Automação de mute não reproduzida.");
    const recv = t.lines.filter((l) => l[0] === "AUXRECV");
    if (recv.length) tw.push(`Esta faixa recebe ${recv.length} envio(s) de outras faixas; envios não são reproduzidos.`);
    const mainSend = line(t, "MAINSEND");
    const sendsToParent = !mainSend || mainSend[1] !== "0";
    if (!sendsToParent) tw.push("Envio para o master/pasta desligado no projeto: a faixa fica sem som, como no REAPER.");
    const peak = line(t, "PEAKCOL");
    const color = peak ? num(peak[1]) : null;

    const audioItems = items.filter((i) => AUDIO_SOURCES.has(i.sourceType) && i.fileRef);
    const midiItems = items.filter((i) => i.sourceType === "MIDI");
    let kind: RppTrack["kind"];
    if (LYRICS_NAME.test(name)) kind = "lyrics";
    else if (audioItems.length) kind = "audio";
    else if (isFolder) kind = "folder";
    else if (midiItems.length) { kind = "midi"; tw.push("Faixa MIDI: não há áudio para reproduzir sem os instrumentos virtuais."); }
    else kind = "empty";
    if (kind === "audio" && audioItems.length < items.length && !isFolder) {
      const other = items.filter((i) => !audioItems.includes(i)).map((i) => i.sourceType).join(", ");
      if (other) tw.push(`Itens sem áudio reproduzível ignorados (${other}).`);
    }

    const parentIdx = folderStack.length ? folderStack[folderStack.length - 1] : null;
    tracks.push({
      idx, guid: t.args[0] ?? null, name,
      volume: vp ? num(vp[1], 1) : 1, pan: vp ? num(vp[2], 0) : 0,
      muted: ms ? num(ms[1]) === 1 : false, soloed: ms ? num(ms[2]) > 0 : false,
      phaseInvert: num(line(t, "IPHASE")?.[1]) === 1,
      color: color && color !== 0 ? color : null,
      isFolder, folderDepth: depth, parentIdx, sendsToParent,
      items: kind === "audio" ? audioItems : items, fx, warnings: tw, kind,
    });
    if (isFolder) { folderStack.push(idx); depth++; }
    else if (delta < 0) { for (let k = 0; k < -delta && folderStack.length; k++) folderStack.pop(); depth = Math.max(0, depth + delta); }
  });

  // Letra: track específica. O formato exato ainda será validado com um projeto real,
  // então guardamos os dados brutos sem interpretá-los como letra.
  let lyrics: LyricsRaw | null = null;
  const lt = tracks.find((t) => t.kind === "lyrics");
  if (lt) {
    const node = proj.children.filter((c) => c.name === "TRACK")[lt.idx];
    lyrics = {
      trackIdx: lt.idx, trackName: lt.name,
      note: "Track de letra encontrada. Os dados foram guardados sem interpretação até a validação do formato com um projeto real.",
      items: node.children.filter((c) => c.name === "ITEM").map((it) => ({
        position: num(line(it, "POSITION")?.[1]), length: num(line(it, "LENGTH")?.[1]),
        name: line(it, "NAME")?.[1] ?? null, notes: readNotes(child(it, "NOTES")),
        source: child(it, "SOURCE")?.args?.[0] ?? null,
        sourceLines: (child(it, "SOURCE")?.lines ?? []).slice(0, 2000).map((l) => l.join(" ")),
      })),
    };
  }

  const length = Math.max(0, ...tracks.flatMap((t) => t.items.map((i) => i.position + i.length)), ...markers.map((m) => m.end ?? m.position));
  if (tracks.filter((t) => t.kind === "audio").length === 0) warnings.push("Nenhuma faixa com áudio encontrada no projeto.");
  if (markers.length === 0) warnings.push("O projeto não tem marcadores nem regiões.");

  return { version: proj.args[1] ?? null, tempo, timeSigNum, timeSigDen, sampleRate, master, tracks, markers, length, warnings, lyrics, raw: proj };
}

// Remove blocos binários volumosos (estado de plugins) antes de guardar a árvore no banco.
export function compactTree(n: RppNode, maxLines = 400): RppNode {
  const heavy = ["VST", "VST3", "JS", "AU", "CLAP", "DX", "LV2"].includes(n.name);
  return {
    name: n.name, args: n.args,
    lines: heavy ? [["__omitido__", String(n.lines.length)]] : n.lines.slice(0, maxLines),
    children: n.children.map((c) => compactTree(c, maxLines)),
  };
}
