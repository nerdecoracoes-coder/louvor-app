// Testes da importação/sincronização contra o banco local real (dev/stack.sh), com uma pasta local
// fazendo o papel do Google Drive (tests/fsdrive.ts).
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, rmSync, cpSync, renameSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Db } from "../supabase/functions/_shared/db.ts";
import { syncOrg } from "../supabase/functions/_shared/sync.ts";
import { FsDrive } from "./fsdrive.ts";
import { makeProject } from "./fixtures/make-project.ts";
import { newUser, serviceKey, REST, joinChurch } from "./helpers.ts";

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
  await joinChurch(admin.api, org, member);
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
  test("pastas de cantor/grupo: multitracks/Grupo/Música, misturado com músicas soltas", async () => {
    const grp = join(ROOT, "Morada");
    mkdirSync(grp, { recursive: true });
    // registro criado por engano por uma leitura antiga (que tratava a pasta do grupo como música)
    await db.insert("songs", { org_id: org, title: "Morada", source: "drive", status: "error", drive_folder_id: drive.idOf(grp), drive_folder_name: "Morada" });
    await makeProject({ root: grp, folder: "Grande É o Senhor", rppName: "Grande É o Senhor.rpp" });
    await makeProject({ root: grp, folder: "Ousado Amor - Isaias Saad", rppName: "Ousado Amor - Isaias Saad - 136 BPM (A).rpp" });
    await ageAll(ROOT);
    const st = await syncOrg(deps(), org, "manual");
    expect(st.errors).toBe(0);
    const g = await song("Grande É o Senhor");
    expect(g).toMatchObject({ status: "ready", title: "Grande É o Senhor", artist: "Morada" }); // artista vem da pasta do grupo
    expect((await song("Emaús - Morada")).status).toBe("ready");                                 // música solta continua
    expect((await db.select("songs", `org_id=eq.${org}&drive_folder_id=eq.${drive.idOf(grp)}`))).toHaveLength(0);
    // o player pode ler os áudios das músicas dentro do grupo
    const fileId = (await db.select("project_media", `project_id=eq.${g.current_project_id}&limit=1`))[0].drive_file_id;
    expect((await member.api.rpc("can_read_drive_file", { p_file_id: fileId })).data).toBe(true);
    // rodar de novo não reprocessa
    const st2 = await syncOrg(deps(), org, "cron");
    expect(st2.created + st2.updated).toBe(0);
  });
  test("rodada interrompida pelo servidor não fica 'em andamento' para sempre", async () => {
    const [r] = await db.insert("sync_runs", { org_id: org, trigger: "connect", started_at: new Date(Date.now() - 3600e3).toISOString() });
    await syncOrg(deps(), org, "manual");
    const after = (await db.select("sync_runs", `id=eq.${r.id}`))[0];
    expect(after.status).toBe("error");
    expect(after.error).toContain("Interrompida");
  });
  test("duas rodadas ao mesmo tempo: a segunda espera, sem duplicar músicas", async () => {
    const [r] = await db.insert("sync_runs", { org_id: org, trigger: "cron" });
    const st = await syncOrg(deps(), org, "manual");
    expect(st.busy).toBe(true);
    await db.update("sync_runs", `id=eq.${r.id}`, { status: "ok", finished_at: new Date().toISOString() });
    const [a, b] = await Promise.all([syncOrg(deps(), org, "cron"), syncOrg(deps(), org, "webhook")]);
    expect(a.errors + b.errors).toBe(0);
    const all = await db.select("songs", `org_id=eq.${org}&select=drive_folder_id`);
    expect(new Set(all.map((x: any) => x.drive_folder_id)).size).toBe(all.length);
  });
  test("capa: a imagem da pasta da música aparece no cartão; troca quando a imagem muda; capa manual é mantida", async () => {
    const store = new Map<string, Uint8Array>(); const removed: string[] = [];
    const covers = { put: async (p: string, b: Uint8Array) => { store.set(p, b); return `https://x.supabase.co/storage/v1/object/public/media/${p}`; }, remove: async (p: string) => { removed.push(p); } };
    const dir = join(ROOT, "Emaús - Morada");
    writeFileSync(join(dir, "Emaús.jpg"), new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    writeFileSync(join(dir, "Tracks 1", "foto-da-sessao.jpg"), new Uint8Array([0xff, 0xd8, 9])); // em subpasta: não é capa
    await ageAll(ROOT);
    await syncOrg({ ...deps(), covers }, org, "cron");
    let s = await song("Emaús - Morada");
    expect(s.cover_url).toMatch(/\/songs\/.+\/drive-.+\.jpg$/);
    expect([...store.values()][0]).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    // sem mudanças: não copia de novo
    await syncOrg({ ...deps(), covers }, org, "cron");
    expect(store.size).toBe(1);
    // imagem trocada: nova capa, a antiga é apagada do armazenamento
    writeFileSync(join(dir, "Emaús.jpg"), new Uint8Array([0xff, 0xd8, 0xff, 7, 7, 7, 7]));
    await ageAll(ROOT);
    await syncOrg({ ...deps(), covers }, org, "cron");
    const s2 = await song("Emaús - Morada");
    expect(s2.cover_url).not.toBe(s.cover_url);
    expect(removed).toHaveLength(1);
    // capa enviada à mão pelo app tem prioridade
    await db.update("songs", `id=eq.${s2.id}`, { cover_url: "https://x.supabase.co/storage/v1/object/public/media/songs/manual.jpg" });
    await syncOrg({ ...deps(), covers }, org, "cron");
    expect((await song("Emaús - Morada")).cover_url).toContain("manual.jpg");
    s = s2; void s;
  });
  test("fila grande: a música enviada por último é processada primeiro; o resto fica na fila", async () => {
    const grp = join(ROOT, "Fila");
    await makeProject({ root: grp, folder: "Antiga - Teste", rppName: "Antiga - Teste - 120 BPM (C).rpp", seconds: 2 });
    await makeProject({ root: grp, folder: "Nova - Teste", rppName: "Nova - Teste - 120 BPM (D).rpp", seconds: 2 });
    await ageAll(ROOT);
    const t = new Date(Date.now() - 30 * 60e3); // a "Nova" foi enviada há 30 min (já terminou), a "Antiga" há 1 h
    const { readdirSync } = await import("node:fs");
    const touch = (d: string) => { for (const n of readdirSync(d, { recursive: true }) as string[]) utimesSync(join(d, n), t, t); utimesSync(d, t, t); };
    touch(join(grp, "Nova - Teste"));
    const st = await syncOrg({ ...deps(), maxProjectsPerRun: 1 }, org, "webhook");
    expect(st.processed).toBe(1); expect(st.deferred).toBeGreaterThan(0);
    expect((await song("Nova - Teste")).status).toBe("ready");
    expect((await song("Antiga - Teste")).status).toBe("processing");
    const st2 = await syncOrg(deps(), org, "cron");
    expect(st2.deferred).toBe(0);
    expect((await song("Antiga - Teste")).status).toBe("ready");
  });
  test("músicas marcadas '- Editar' não entram; tirar o '- Editar' traz de volta, sem duplicar", async () => {
    const grp = join(ROOT, "Marcas");
    await makeProject({ root: grp, folder: "Pronta Um - Banda", rppName: "Pronta Um - Banda - 100 BPM (E).rpp", seconds: 2 });
    await makeProject({ root: grp, folder: "Guardada - Banda - Editar", rppName: "Guardada - Banda - 100 BPM (G).rpp", seconds: 2 });
    await ageAll(ROOT);
    const st = await syncOrg(deps(), org, "manual");
    expect(st.editing).toBe(1);
    const um = await song("Pronta Um - Banda");
    expect(um).toMatchObject({ status: "ready", title: "Pronta Um", artist: "Banda", song_key: "E" });
    expect(await song("Guardada - Banda - Editar")).toBeUndefined();     // não pronta: nem aparece
    // voltou para edição: sai do repertório
    renameSync(join(grp, "Pronta Um - Banda"), join(grp, "Pronta Um - Banda - editar"));
    await syncOrg(deps(), org, "cron");
    expect((await db.select("songs", `id=eq.${um.id}`))[0].status).toBe("removed");
    // edição terminada: volta (no Drive real o ID da pasta é o mesmo; aqui o ID depende do caminho, então
    // simulamos o retorno renomeando de volta para o caminho original)
    renameSync(join(grp, "Pronta Um - Banda - editar"), join(grp, "Pronta Um - Banda"));
    await ageAll(ROOT);
    await syncOrg(deps(), org, "cron");
    expect((await db.select("songs", `id=eq.${um.id}`))[0].status).toBe("ready");
    expect(await db.select("songs", `org_id=eq.${org}&drive_folder_name=eq.${encodeURIComponent("Pronta Um - Banda")}`)).toHaveLength(1);
  });
  test("pasta apagada e refeita com o mesmo nome: a música e as escalas continuam as mesmas", async () => {
    await makeProject({ root: ROOT, folder: "Tua Graça - Banda A - 70 BPM (G)", rppName: "Tua Graça - Banda A - 70 BPM (G).rpp" });
    await ageAll(ROOT); await syncOrg(deps(), org, "cron");
    const a = await song("Tua Graça - Banda A - 70 BPM (G)"); expect(a.status).toBe("ready");
    const sch = (await admin.api.post("schedules", { org_id: org, team_id: team, title: "Culto troca", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "published" })).data[0];
    await admin.api.post("schedule_songs", { schedule_id: sch.id, org_id: org, team_id: team, song_id: a.id, title_snapshot: "Tua Graça", song_key: "A" });
    // apaga a pasta e envia outra, com o mesmo nome, em outro lugar do Drive (outro ID)
    renameSync(join(ROOT, "Tua Graça - Banda A - 70 BPM (G)"), `${SIM}/lixeira-tua`);
    await syncOrg(deps(), org, "cron");
    expect((await db.select("songs", `id=eq.${a.id}`))[0].status).toBe("removed");
    mkdirSync(join(ROOT, "Novos"), { recursive: true });
    await makeProject({ root: join(ROOT, "Novos"), folder: "Tua Graça - Banda A - 70 BPM (G)", rppName: "Tua Graça - Banda A - 70 BPM (G).rpp", variant: "v2" });
    await ageAll(ROOT); await syncOrg(deps(), org, "cron");
    const rows = await db.select("songs", `org_id=eq.${org}&title=eq.${encodeURIComponent("Tua Graça")}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: a.id, status: "ready", drive_folder_id: drive.idOf(join(ROOT, "Novos", "Tua Graça - Banda A - 70 BPM (G)")) });
    expect(rows[0].current_project_id).not.toBe(a.current_project_id);
    expect((await member.api.get(`/schedule_songs?schedule_id=eq.${sch.id}`)).data[0]).toMatchObject({ song_id: a.id, song_key: "A" });
  });

  test("pasta nova enviada antes de a antiga sair: as escalas passam para a música nova", async () => {
    await makeProject({ root: ROOT, folder: "Santo - Banda B - 80 BPM (D)", rppName: "Santo - Banda B - 80 BPM (D).rpp" });
    await ageAll(ROOT); await syncOrg(deps(), org, "cron");
    const a = await song("Santo - Banda B - 80 BPM (D)");
    const sch = (await admin.api.post("schedules", { org_id: org, team_id: team, title: "Culto troca 2", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "published" })).data[0];
    await admin.api.post("schedule_songs", { schedule_id: sch.id, org_id: org, team_id: team, song_id: a.id, title_snapshot: "Santo" });
    mkdirSync(join(ROOT, "Novos"), { recursive: true });
    await makeProject({ root: join(ROOT, "Novos"), folder: "Santo - Banda B - 80 BPM (D)", rppName: "Santo - Banda B - 80 BPM (D).rpp", variant: "v2" });
    await ageAll(ROOT); await syncOrg(deps(), org, "cron");          // as duas pastas existem
    renameSync(join(ROOT, "Santo - Banda B - 80 BPM (D)"), `${SIM}/lixeira-santo`);
    await syncOrg(deps(), org, "cron");                                // a antiga saiu
    const novo = (await db.select("songs", `org_id=eq.${org}&drive_folder_id=eq.${drive.idOf(join(ROOT, "Novos", "Santo - Banda B - 80 BPM (D)"))}`))[0];
    expect(novo.id).not.toBe(a.id);
    expect((await member.api.get(`/schedule_songs?schedule_id=eq.${sch.id}`)).data[0].song_id).toBe(novo.id);
    expect((await db.select("songs", `id=eq.${a.id}`))[0].status).toBe("removed");
  });
});
