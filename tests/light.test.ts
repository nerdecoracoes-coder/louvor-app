// Versão leve: fila no servidor, conversão (ffmpeg → Opus), registro e links temporários para o player.
// O decodificador do navegador (libopus em WebAssembly) é conferido amostra a amostra contra a referência do ffmpeg.
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { handleSync, handleMedia, type Env } from "../supabase/functions/_shared/handlers.ts";
import { Db } from "../supabase/functions/_shared/db.ts";
import { syncOrg } from "../supabase/functions/_shared/sync.ts";
import { run } from "../tools/light/convert.ts";
import * as ogg from "../app/player/ogg.js";
import { FsDrive } from "./fsdrive.ts";
import { makeProject } from "./fixtures/make-project.ts";
import { newUser, serviceKey, anonKey, REST, joinChurch } from "./helpers.ts";

const SIM = `/tmp/claude-0/light-sim-${Date.now()}`, ROOT = `${SIM}/multitracks`, BUCKET = `${SIM}/r2`;
let env: Env, drive: FsDrive, db: Db, org = "", admin: any, member: any, outsider: any, projectId = "", nMedia = 0;
const store = new Map<string, Uint8Array>();
const cron = (q: string, init: RequestInit = {}) => handleSync(new Request(`http://x/drive-sync?${q}`, { ...init, headers: { "x-cron-secret": "segredo", "Content-Type": "application/json" } }), env);
const manifest = (jwt: string, project_id: string) => handleMedia(new Request("http://x/drive-media", { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ project_id }) }), env);

beforeAll(async () => {
  rmSync(SIM, { recursive: true, force: true }); mkdirSync(ROOT, { recursive: true }); mkdirSync(BUCKET, { recursive: true });
  await makeProject({ root: ROOT, seconds: 6 });
  drive = new FsDrive(ROOT);
  env = { rest: REST, serviceKey: await serviceKey(), anonKey: await anonKey(), cronSecret: "segredo", drive: () => drive,
    r2: { endpoint: "https://conta.r2.cloudflarestorage.com", bucket: "somos", accessKeyId: "id", secretAccessKey: "segredo-r2", region: "auto" } };
  db = new Db(REST, env.serviceKey);
  [admin, member, outsider] = await Promise.all(["Admin L", "Membro L", "Fora L"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Leve" })).data;
  const team = (await admin.api.post("teams", { org_id: org, name: "Louvor L" })).data[0].id;
  await joinChurch(admin.api, org, member);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [member.id] });
  await db.insert("drive_integrations", { org_id: org, folder_id: drive.idOf(ROOT), folder_name: "multitracks" });
  await syncOrg({ db, drive }, org, "manual");
  projectId = (await db.select("songs", `org_id=eq.${org}`))[0].current_project_id;
  nMedia = (await db.select("project_media", `project_id=eq.${projectId}`)).length;
});

describe("versão leve", () => {
  test("fila: só com o segredo; lista os áudios da versão atual", async () => {
    expect((await handleSync(new Request("http://x/drive-sync?mode=light-queue"), env)).status).toBe(403);
    const items = (await (await cron("mode=light-queue&limit=500")).json()).items.filter((x: any) => x.org_id === org);
    expect(items.length).toBe(nMedia); expect(nMedia).toBeGreaterThan(5);
  });

  test("conversão: Opus muito menor que o WAV, índice de páginas e registro no banco; a fila esvazia", async () => {
    const deps = {
      queue: async (limit: number) => (await (await cron(`mode=light-queue&limit=${limit}`)).json()).items.filter((x: any) => x.org_id === org),
      done: async (items: unknown[]) => { await cron("mode=light-done", { method: "POST", body: JSON.stringify({ items }) }); },
      drive, upload: async (key: string, bytes: Uint8Array) => { store.set(key, bytes); },
    };
    const r = await run(deps, { minutes: 2, parallel: 3, log: () => {} });
    expect(r.ok).toBe(nMedia); expect(r.fail).toBe(0);
    expect(r.outBytes * 5).toBeLessThan(r.inBytes);
    const rows = await db.select("light_audio", `org_id=eq.${org}`);
    expect(rows).toHaveLength(nMedia);
    const guide = rows.find((x: any) => store.get(x.key) && x.key.includes(drive.idOf(join(ROOT, "Emaús - Morada", "Tracks 1", "Guide.wav"))));
    expect(guide.info).toMatchObject({ codec: "opus", channels: 1, sampleRate: 48000, samples: 6 * 48000 });
    expect((await (await cron("mode=light-queue&limit=500")).json()).items.filter((x: any) => x.org_id === org)).toHaveLength(0);
  });

  test("player: integrante recebe links temporários do R2; quem é de fora não", async () => {
    const r = await (await manifest(member.api.token, projectId)).json();
    const files = Object.values(r.files) as any[];
    expect(files).toHaveLength(nMedia);
    expect(files[0].url).toMatch(/^https:\/\/conta\.r2\.cloudflarestorage\.com\/somos\/audio\/.+X-Amz-Signature=[0-9a-f]{64}$/);
    expect(files[0].index.length).toBeGreaterThan(2);
    expect(Object.keys((await (await manifest(outsider.api.token, projectId)).json()).files ?? {})).toHaveLength(0);
  });

  test("falha na conversão fica registrada e volta para a fila depois", async () => {
    const [it] = await db.select("project_media", `project_id=eq.${projectId}&limit=1`);
    await db.delete("light_audio", `drive_file_id=eq.${it.drive_file_id}`);
    await cron("mode=light-done", { method: "POST", body: JSON.stringify({ items: [{ org_id: org, drive_file_id: it.drive_file_id, src: it.md5 ?? `s${it.size}`, error: "ffmpeg: arquivo inválido" }] }) });
    const row = (await db.select("light_audio", `drive_file_id=eq.${it.drive_file_id}`))[0];
    expect(row).toMatchObject({ key: null, error: "ffmpeg: arquivo inválido", attempts: 1 });
    expect((await (await cron("mode=light-queue&limit=500")).json()).items.some((x: any) => x.drive_file_id === it.drive_file_id)).toBe(false); // espera 2 h
  });

  test("decodificação por trechos (como no player) bate com a decodificação contínua, amostra a amostra", async () => {
    new Function("exports", "module", "define", readFileSync("app/player/opus-decoder.min.js", "utf8"))(undefined, undefined, undefined);
    const { OpusDecoder } = (globalThis as any)["opus-decoder"];
    const worst: Record<string, number> = {};
    for (const [key, file] of store) {
      const info = ogg.buildIndex(file);
      const nch = info.channels > 1 ? 2 : 1;
      const dec = new OpusDecoder(nch > 1 ? { channels: 2, streamCount: 1, coupledStreamCount: 1, channelMappingTable: [0, 1], preSkip: 0 } : { channels: 1, streamCount: 1, coupledStreamCount: 0, channelMappingTable: [0], preSkip: 0 });
      await dec.ready;
      // referência: o arquivo inteiro decodificado de uma vez, do começo ao fim
      const full = ogg.decodeRange(dec, file, 0, info, 0, info.samples);
      // e a duração confere com o original (o ffmpeg informa o mesmo número de amostras)
      writeFileSync(`${SIM}/a.opus`, file);
      await $`ffmpeg -loglevel error -y -i ${SIM}/a.opus -f f32le -ar 48000 ${SIM}/a.f32`;
      expect(readFileSync(`${SIM}/a.f32`).length / 4 / nch).toBe(info.samples);
      let maxd = 0;
      for (const sec of [0, 1.7, 4]) {
        const s0 = Math.round(sec * 48000), s1 = Math.min(info.samples, s0 + 4 * 48000);
        if (s1 <= s0) continue;
        const { start, end } = ogg.byteRange(info, s0, s1);
        await dec.reset();
        const ch = ogg.decodeRange(dec, file.subarray(start, end + 1), start, info, s0, s1);
        for (let c = 0; c < nch; c++) for (let i = 0; i < s1 - s0; i++) maxd = Math.max(maxd, Math.abs(ch[c][i] - full[c][s0 + i]));
        expect(end - start + 1).toBeLessThan(file.length); // baixa só o trecho
      }
      dec.free?.();
      worst[key.split("/").pop()!] = maxd;
    }
    for (const v of Object.values(worst)) expect(v).toBeLessThan(0.0005);
  });
});
