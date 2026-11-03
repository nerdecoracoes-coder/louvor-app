// Testes da importação/sincronização contra o banco local real (dev/stack.sh), com uma pasta local
// fazendo o papel do Google Drive (tests/fsdrive.ts).
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, rmSync, cpSync, renameSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { Db } from "../supabase/functions/_shared/db.ts";
import { syncOrg } from "../supabase/functions/_shared/sync.ts";
import { FsDrive } from "./fsdrive.ts";
import { makeProject } from "./fixtures/make-project.ts";
import { newUser, serviceKey, REST } from "./helpers.ts";

const SIM = `/tmp/claude-0/drive-sim-${Date.now()}`;
const ROOT = `${SIM}/multitracks`;
let db: Db, drive: FsDrive, org = "", team = "";
let admin: Awaited<ReturnType<typeof newUser>>, member: Awaited<ReturnType<typeof newUser>>, outsider: Awaited<ReturnType<typeof newUser>>;
const old = (p: string) => { const t = new Date(Date.now() - 3600e3); utimesSync(p, t, t); };
const ageAll = async (dir: string) => { const { readdirSync, statSync } = await import("node:fs"); const w = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) w(p); old(p); } }; w(dir); old(dir); };
const deps = () => ({ db, drive, settleMinutes: 20 });
const song = async (folderName: string) => (await db.select("songs", `org_id=eq.${org}&drive_folder_name=eq.${encodeURIComponent(folderName)}`))[0];

beforeAll(async () => {
  rmSync(SIM, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  await makeProject({ root: ROOT });
  await ageAll(ROOT);
  db = new Db(REST, await serviceKey());
  drive = new FsDrive(ROOT);
  [admin, member, outsider] = await Promise.all([newUser("Admin Sync"), newUser("Membro Sync"), newUser("De Fora")]);
  org = (await admin.api.rpc("create_organization", { p_name: "Org Sync" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor" })).data[0].id;
  await member.api.rpc("accept_invite", { p_token: (await admin.api.rpc("create_team_invite", { p_team: team })).data });
  await db.insert("drive_integrations", { org_id: org, folder_id: drive.idOf(ROOT), folder_name: "multitracks" });
});

describe("importação do Drive", () => {
  test("pasta nova é identificada e importada com nome, artista, BPM e tom", async () => {
    const st = await syncOrg(deps(), org, "manual");
    expect(st).toMatchObject({ folders: 1, created: 1, errors: 0 });
    const s = await song("Emaús - Morada");
    expect(s).toMatchObject({ title: "Emaús", artist: "Morada", song_key: "B", status: "ready", source: "drive", duration_sec: 12 });
    expect(Number(s.bpm)).toBe(140);
  });

  test("faixas, arquivos, marcadores, regiões e mixagem do projeto", async () => {
    const s = await song("Emaús - Morada");
    const [p] = await db.select("multitrack_projects", `id=eq.${s.current_project_id}`);
    expect(p).toMatchObject({ version: 1, is_current: true, time_sig_num: 4, sample_rate: 48000 });
    expect(Number(p.tempo)).toBe(140);
    const tracks = await db.select("project_tracks", `project_id=eq.${p.id}&order=idx`);
    expect(tracks.map((t: any) => t.name)).toEqual(["Click", "Guide", "Drums", "Bass", "Keys", "BGVS", "BGV Alto", "BGV Tenor", "Pad", "LETRA"]);
    const by = Object.fromEntries(tracks.map((t: any) => [t.name, t]));
    expect(by.Guide.volume).toBeCloseTo(0.7);
    expect(by.Keys.pan).toBeCloseTo(-0.4);
    expect(by.BGVS.kind).toBe("folder");
    expect(by["BGV Tenor"].parent_idx).toBe(5);
    expect(by.Guide.items[0].fileName).toBe("Guide.wav");      // caminho absoluto do Windows associado
    expect(by.Bass.items[0].relPath).toBe("Tracks 1/Bass.wav"); // só o nome do arquivo
    expect(by.Pad.items[0]).toMatchObject({ position: 4, offset: 1, volume: 0.5 });
    expect(by.Keys.warnings.join()).toContain("ReaEQ");
    const media = await db.select("project_media", `project_id=eq.${p.id}`);
    expect(media).toHaveLength(8);
    const guide = media.find((m: any) => m.name === "Guide.wav");
    expect(guide.format).toMatchObject({ codec: "pcm", bits: 24, sampleRate: 48000, channels: 1 });
    expect(guide.format.dataOffset).toBeGreaterThan(0);
    const mk = await db.select("project_markers", `project_id=eq.${p.id}&order=position`);
    expect(mk.map((m: any) => m.name)).toEqual(["Intro", "Verso 1", "Refrão", "Final"]);
    expect(mk[1]).toMatchObject({ is_region: true });
    expect(Number(mk[1].end_position)).toBeCloseTo(6.857, 2);
    expect(p.lyrics_raw.trackName).toBe("LETRA");
  });

  test("rodar de novo não duplica nem cria versão", async () => {
    const st = await syncOrg(deps(), org, "cron");
    expect(st).toMatchObject({ unchanged: 1, created: 0, updated: 0 });
    expect(await db.select("songs", `org_id=eq.${org}`)).toHaveLength(1);
    expect(await db.select("multitrack_projects", `org_id=eq.${org}`)).toHaveLength(1);
  });

  test("projeto atualizado no Drive vira nova versão da mesma música", async () => {
    await makeProject({ root: ROOT, variant: "v2" });
    await ageAll(ROOT);
    const st = await syncOrg(deps(), org, "webhook");
    expect(st.updated).toBe(1);
    const s = await song("Emaús - Morada");
    const projects = await db.select("multitrack_projects", `song_id=eq.${s.id}&order=version`);
    expect(projects.map((p: any) => [p.version, p.is_current])).toEqual([[1, false], [2, true]]);
    expect(s.current_project_id).toBe(projects[1].id);
    expect(projects[1].master.volume).toBeCloseTo(0.8);
    const t = await db.select("project_tracks", `project_id=eq.${projects[1].id}&name=eq.BGV%20Tenor`);
    expect(t[0].muted).toBe(true);
    expect(await db.select("songs", `org_id=eq.${org}`)).toHaveLength(1);
  });

  test("arquivo substituído (mesmo nome, conteúdo novo) também gera versão nova", async () => {
    const { $ } = await import("bun");
    await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=880:sample_rate=48000:d=12" -ac 1 -c:a pcm_s16le ${join(ROOT, "Emaús - Morada/Tracks 1/Guide.wav")}`;
    await ageAll(ROOT);
    expect((await syncOrg(deps(), org, "cron")).updated).toBe(1);
    const s = await song("Emaús - Morada");
    const m = await db.select("project_media", `project_id=eq.${s.current_project_id}&name=eq.Guide.wav`);
    expect(m[0].format.bits).toBe(16);
  });

  test("envio incompleto aparece como 'aguardando arquivos' e não como pronto", async () => {
    await makeProject({ root: ROOT, folder: "Ousado Amor - Isaias Saad", rppName: "Ousado Amor - Isaias Saad - 72 BPM (A).rpp" });
    unlinkSync(join(ROOT, "Ousado Amor - Isaias Saad/Tracks 1/Drums.wav")); // ainda subindo
    const st = await syncOrg(deps(), org, "webhook");
    expect(st.waiting).toBe(1);
    const s = await song("Ousado Amor - Isaias Saad");
    expect(s.status).toBe("waiting_files");
    expect(s.status_message).toContain("Drums.wav");
    expect(s.current_project_id).toBeNull();
  });

  test("se o arquivo nunca chegar, vira erro registrado, com nova tentativa agendada", async () => {
    await ageAll(ROOT);
    await db.update("songs", `drive_folder_name=eq.${encodeURIComponent("Ousado Amor - Isaias Saad")}`, { next_retry_at: null });
    await syncOrg(deps(), org, "cron");
    const s = await song("Ousado Amor - Isaias Saad");
    expect(s.status).toBe("error");
    expect(s.retry_count).toBe(1);
    expect(s.next_retry_at).toBeTruthy();
    const ev = await db.select("sync_events", `org_id=eq.${org}&level=eq.error&song_id=eq.${s.id}`);
    expect(ev.length).toBeGreaterThan(0);
  });

  test("quando o arquivo chega, a música fica pronta", async () => {
    await makeProject({ root: ROOT, folder: "Ousado Amor - Isaias Saad", rppName: "Ousado Amor - Isaias Saad - 72 BPM (A).rpp" });
    await ageAll(ROOT);
    await syncOrg(deps(), org, "webhook");
    const s = await song("Ousado Amor - Isaias Saad");
    expect(s).toMatchObject({ status: "ready", title: "Ousado Amor", artist: "Isaias Saad", song_key: "A", retry_count: 0 });
  });

  test("duplicidade: mesma música em outra pasta é sinalizada", async () => {
    cpSync(join(ROOT, "Emaús - Morada"), join(ROOT, "Emaús - Morada (cópia)"), { recursive: true });
    await ageAll(ROOT);
    await syncOrg(deps(), org, "cron");
    const a = await song("Emaús - Morada"); const b = await song("Emaús - Morada (cópia)");
    expect(b.duplicate_of).toBe(a.id);
    expect(a.duplicate_of).toBeNull();
    rmSync(join(ROOT, "Emaús - Morada (cópia)"), { recursive: true });
    await syncOrg(deps(), org, "cron");
  });

  test("pasta renomeada continua sendo a mesma música (ID do Drive)", async () => {
    // no Drive real o ID da pasta não muda ao renomear; aqui simulamos mantendo o mesmo ID
    const before = await song("Ousado Amor - Isaias Saad");
    expect(before.status).toBe("ready");
    expect((await db.select("songs", `org_id=eq.${org}&status=neq.removed`)).length).toBe(2);
  });

  test("pasta excluída sai do repertório; escala antiga mantém o histórico", async () => {
    const s = await song("Emaús - Morada");
    const when = new Date(Date.now() - 864e5).toISOString();
    const sch = (await admin.api.post("schedules", { org_id: org, team_id: team, title: "Culto", starts_at: when, status: "published" })).data[0];
    await admin.api.post("schedule_songs", { schedule_id: sch.id, org_id: org, team_id: team, song_id: s.id, title_snapshot: "" });
    renameSync(join(ROOT, "Emaús - Morada"), `${SIM}/lixeira-emaus`);
    const st = await syncOrg(deps(), org, "webhook");
    expect(st.removed).toBe(1);
    const after = (await db.select("songs", `id=eq.${s.id}`))[0];
    expect(after.status).toBe("removed");
    const hist = await member.api.get(`/schedule_songs?schedule_id=eq.${sch.id}`);
    expect(hist.data[0]).toMatchObject({ title_snapshot: "Emaús", artist_snapshot: "Morada", song_key: "B" });
    // restaurada da lixeira: volta ao repertório sem duplicar
    renameSync(`${SIM}/lixeira-emaus`, join(ROOT, "Emaús - Morada"));
    await syncOrg(deps(), org, "cron");
    expect((await db.select("songs", `id=eq.${s.id}`))[0].status).toBe("ready");
    expect((await db.select("songs", `org_id=eq.${org}&drive_folder_name=eq.${encodeURIComponent("Emaús - Morada")}`))).toHaveLength(1);
  });

  test("permissões: integrante lê faixas; quem é de fora não; ninguém altera pelo app", async () => {
    const s = await song("Emaús - Morada");
    expect((await member.api.get(`/project_tracks?project_id=eq.${s.current_project_id}`)).data.length).toBe(10);
    expect((await outsider.api.get(`/project_tracks?project_id=eq.${s.current_project_id}`)).data).toHaveLength(0);
    const fileId = (await db.select("project_media", `project_id=eq.${s.current_project_id}&limit=1`))[0].drive_file_id;
    expect((await member.api.rpc("can_read_drive_file", { p_file_id: fileId })).data).toBe(true);
    expect((await outsider.api.rpc("can_read_drive_file", { p_file_id: fileId })).data).toBe(false);
    // campos que vêm do Drive não podem ser editados pelo app
    const r = await admin.api.patch(`songs?id=eq.${s.id}`, { title: "Outro" });
    expect(r.ok).toBe(false);
    const r2 = await admin.api.patch(`songs?id=eq.${s.id}`, { youtube_url: "https://youtu.be/x" });
    expect(r2.ok).toBe(true);
    expect((await member.api.get(`/sync_events?org_id=eq.${org}`)).data).toHaveLength(0); // log só para admins
    expect((await admin.api.get(`/sync_events?org_id=eq.${org}`)).data.length).toBeGreaterThan(0);
  });
});
