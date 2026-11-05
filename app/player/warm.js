// Pré-aquecimento do player: o que dá para fazer ANTES de tocar em "abrir música".
//  - manifest(): lista das versões leves (links do R2) de um projeto, guardada por algumas horas e sem pedir duas vezes ao mesmo tempo;
//  - warmSong(): baixa os primeiros segundos de cada faixa para o cache do navegador, então o player abre quase instantâneo;
//  - warmUpcoming(): faz isso com as músicas das próximas escalas do time (em segundo plano, sem atrapalhar o uso do app).
import { sb, state } from "../core.js";
import { lightFetch, byteRange, warmOpus } from "./engine.js";

const TTL = 5 * 60e3;                // curto: a conversão avança a cada 15 min e o cache não pode esconder faixas novas
const WARM_SECONDS = 8;               // primeiros segundos de cada faixa
const OPUS_RATE = 48000;
const mem = new Map();                // project_id -> { at, p }

export function manifest(projectId, { maxAge = TTL } = {}) {
  const hit = mem.get(projectId);
  if (hit && Date.now() - hit.at < maxAge) return hit.p;
  const p = sb.functions.invoke("drive-media", { project_id: projectId }).then((r) => r.data?.files || {}).catch(() => { mem.delete(projectId); return {}; });
  mem.set(projectId, { at: Date.now(), p });
  return p;
}

export const isCached = (projectId) => mem.has(projectId) && Date.now() - mem.get(projectId).at < TTL;

const warmed = new Set();
export async function warmSong(songId) {
  if (warmed.has(songId)) return;
  warmed.add(songId);
  try {
    const song = await sb.from("songs").select("current_project_id,status").eq("id", songId).maybeSingle();
    const pid = song.data?.current_project_id;
    if (!pid || song.data.status !== "ready") return;
    const files = await manifest(pid);
    const ids = Object.keys(files);
    const q = ids.map((id) => files[id]).filter((L) => L?.index?.length && L.url);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(4, q.length) }, async () => {
      while (i < q.length) {
        const L = q[i++];
        const { start, end } = byteRange(L, 0, Math.min(L.samples, WARM_SECONDS * OPUS_RATE));
        await lightFetch(L, start, end).catch(() => {});
      }
    }));
  } catch { warmed.delete(songId); }
}

// músicas das próximas escalas do time (até 8), uma por vez
export async function warmUpcoming() {
  try {
    if (!state.space || !state.user || navigator.onLine === false) return;
    if (navigator.connection?.saveData) return;
    const sch = await sb.from("schedules").select("id").eq("team_id", state.space.id).eq("status", "published").gte("starts_at", new Date().toISOString()).order("starts_at").limit(3);
    const ids = (sch.data || []).map((s) => s.id);
    if (!ids.length) return;
    const ss = await sb.from("schedule_songs").select("song_id,position").in("schedule_id", ids).order("position");
    const songs = [...new Set((ss.data || []).map((r) => r.song_id).filter(Boolean))].slice(0, 8);
    if (!songs.length) return;
    warmOpus();
    for (const id of songs) await warmSong(id);
  } catch { /* sem pré-aquecimento, o player continua funcionando */ }
}
