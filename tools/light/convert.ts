// Conversor da versão leve das faixas (roda no GitHub Actions, com Bun e ffmpeg).
// 1. pede ao servidor (drive-sync?mode=light-queue) a lista de áudios ainda sem versão leve;
// 2. baixa cada WAV do Google Drive (somente leitura, com a conta de serviço; o original não é alterado);
// 3. comprime em Opus (Ogg) com o ffmpeg e monta o índice de páginas para o player buscar só o trecho necessário;
// 4. envia ao Cloudflare R2 e informa o resultado ao servidor (drive-sync?mode=light-done).
// Variáveis: SUPABASE_URL, CRON_SECRET, GOOGLE_SERVICE_ACCOUNT, R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//            (opcionais) LIGHT_MINUTES (tempo máximo da rodada, padrão 40), LIGHT_PARALLEL (padrão 3)
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { GoogleDrive, type DriveClient } from "../../supabase/functions/_shared/drive.ts";
import { put, r2FromEnv, type R2Config } from "../../supabase/functions/_shared/r2.ts";
import { buildIndex } from "../../app/player/ogg.js";

export interface QueueItem { org_id: string; drive_file_id: string; src: string; name: string; size: number | null; format: any; song_title?: string }
export interface Deps {
  queue: (limit: number) => Promise<QueueItem[]>;
  done: (items: unknown[]) => Promise<void>;
  drive: DriveClient;
  upload: (key: string, bytes: Uint8Array) => Promise<void>;
}

// Qualidade: transparente para ensaio. Mono quando o original é mono (click, guia, vozes...).
export const bitrateFor = (channels: number) => (channels <= 1 ? "64k" : "112k");

export async function convertOne(d: Deps, it: QueueItem, work: string) {
  const dir = mkdtempSync(join(work, "f-"));
  try {
    const src = join(dir, "in"), out = join(dir, "out.opus");
    const r = await d.drive.media(it.drive_file_id, null);
    await Bun.write(src, r);
    const ch = Math.min(2, Number(it.format?.channels) || 2);
    // -ac limita a 2 canais; resample para 48 kHz (taxa nativa do Opus) feito pelo próprio ffmpeg
    await $`ffmpeg -nostdin -loglevel error -y -i ${src} -map 0:a:0 -ac ${ch} -c:a libopus -b:a ${bitrateFor(ch)} -vbr on -application audio -frame_duration 20 ${out}`;
    const bytes = new Uint8Array(readFileSync(out));
    const info = buildIndex(bytes);
    const key = `audio/${it.org_id}/${it.drive_file_id}/${it.src}.opus`;
    await d.upload(key, bytes);
    return { org_id: it.org_id, drive_file_id: it.drive_file_id, src: it.src, key, bytes: bytes.length,
      info: { codec: "opus", channels: info.channels, preskip: info.preskip, samples: info.samples, sampleRate: 48000, audioStart: info.audioStart, bytes: info.bytes, index: info.index },
      original: statSync(src).size };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function run(d: Deps, { minutes = 40, parallel = 6, log = console.log } = {}) {
  const until = Date.now() + minutes * 60_000;
  const work = mkdtempSync(join(tmpdir(), "somos-light-"));
  let ok = 0, fail = 0, inBytes = 0, outBytes = 0;
  try {
    while (Date.now() < until) {
      const items = await d.queue(parallel * 6);
      if (!items.length) break;
      let i = 0;
      const worker = async () => {
        while (i < items.length && Date.now() < until) {
          const it = items[i++];
          try {
            const r = await convertOne(d, it, work);
            await d.done([r]); ok++; inBytes += r.original; outBytes += r.bytes;
            log(`ok  ${it.song_title ?? ""} / ${it.name}: ${(r.original / 1e6).toFixed(1)} MB -> ${(r.bytes / 1e6).toFixed(2)} MB`);
          } catch (e) {
            fail++; const msg = String((e as Error).message ?? e);
            log(`err ${it.song_title ?? ""} / ${it.name}: ${msg}`);
            await d.done([{ org_id: it.org_id, drive_file_id: it.drive_file_id, src: it.src, error: msg }]).catch(() => {});
          }
        }
      };
      await Promise.all(Array.from({ length: parallel }, worker));
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  log(`\n${ok} faixa(s) convertida(s), ${fail} com erro. ${(inBytes / 1e6).toFixed(0)} MB -> ${(outBytes / 1e6).toFixed(0)} MB`);
  return { ok, fail, inBytes, outBytes };
}

if (import.meta.main) {
  const env = (k: string) => process.env[k];
  const r2 = r2FromEnv(env);
  const base = env("SUPABASE_URL");
  if (!r2 || !base || !env("CRON_SECRET") || !env("GOOGLE_SERVICE_ACCOUNT")) {
    console.log("Versão leve ainda não configurada (faltam secrets do R2, SUPABASE_URL, CRON_SECRET ou GOOGLE_SERVICE_ACCOUNT). Nada a fazer.");
    process.exit(0);
  }
  const fn = `${base.replace(/\/$/, "")}/functions/v1/drive-sync`;
  const h = { "x-cron-secret": env("CRON_SECRET")!, "Content-Type": "application/json" };
  const deps: Deps = {
    queue: async (limit) => { const r = await fetch(`${fn}?mode=light-queue&limit=${limit}`, { headers: h }); if (!r.ok) throw new Error(`fila: ${r.status} ${await r.text()}`); return (await r.json()).items; },
    done: async (items) => { const r = await fetch(`${fn}?mode=light-done`, { method: "POST", headers: h, body: JSON.stringify({ items }) }); if (!r.ok) throw new Error(`resultado: ${r.status}`); },
    drive: new GoogleDrive(env("GOOGLE_SERVICE_ACCOUNT")!),
    upload: (key, bytes) => put(r2 as R2Config, key, bytes, "audio/ogg"),
  };
  await run(deps, { minutes: Number(env("LIGHT_MINUTES") ?? 40), parallel: Number(env("LIGHT_PARALLEL") ?? 3) });
}
