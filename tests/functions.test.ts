// Testes das Edge Functions (mesmo código que roda no Supabase), com o banco local e uma pasta local no lugar do Drive.
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { handleSync, handleMedia, type Env } from "../supabase/functions/_shared/handlers.ts";
import { Db } from "../supabase/functions/_shared/db.ts";
import { FsDrive } from "./fsdrive.ts";
import { makeProject } from "./fixtures/make-project.ts";
import { newUser, serviceKey, anonKey, REST, joinChurch } from "./helpers.ts";

const SIM = `/tmp/claude-0/fn-sim-${Date.now()}`, ROOT = `${SIM}/multitracks`;
let env: Env, drive: FsDrive, org = "", admin: any, member: any, outsider: any, leader: any;
const call = (body: unknown, jwt?: string, url = "http://x/drive-sync") =>
  handleSync(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }), env);

beforeAll(async () => {
  rmSync(SIM, { recursive: true, force: true }); mkdirSync(ROOT, { recursive: true });
  await makeProject({ root: ROOT, seconds: 6 });
  drive = new FsDrive(ROOT);
  env = { rest: REST, serviceKey: await serviceKey(), anonKey: await anonKey(), cronSecret: "segredo-teste", drive: () => drive };
  [admin, member, outsider, leader] = await Promise.all(["Admin Fn", "Membro Fn", "Fora Fn", "Lider Fn"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Org Funções" })).data;
  const team = (await admin.api.post("teams", { org_id: org, name: "T" })).data[0].id;
  const midia = (await admin.api.post("teams", { org_id: org, name: "Mídia", team_type: "multimidia" })).data[0].id; // time sem repertório
  const tok = (await admin.api.rpc("create_team_invite", { p_team: team })).data;
  await joinChurch(admin.api, org, member, leader);
  await member.api.rpc("accept_invite", { p_token: tok }); await leader.api.rpc("accept_invite", { p_token: tok });
  await admin.api.rpc("add_team_members", { p_team: midia, p_users: [leader.id] });
  await admin.api.patch(`team_members?team_id=eq.${midia}&user_id=eq.${leader.id}`, { is_leader: true }); // líder só da Mídia
});

describe("drive-sync", () => {
  test("informa o e-mail da conta de serviço para compartilhar a pasta", async () => {
    const r = await call({ action: "info" }, member.api.token);
    expect((await r.json()).service_email).toContain("gserviceaccount.com");
  });
  test("sem login: 401; quem não é admin nem líder de time com repertório: 403", async () => {
    expect((await call({ action: "sync", org_id: org })).status).toBe(401);
    expect((await call({ action: "connect", org_id: org, folder: drive.idOf(ROOT) }, member.api.token)).status).toBe(403);
    expect((await call({ action: "connect", org_id: org, folder: drive.idOf(ROOT) }, leader.api.token)).status).toBe(403);
  });
  test("link inválido e pasta inexistente geram mensagens claras", async () => {
    const a = await call({ action: "connect", org_id: org, folder: "isso não é link" }, admin.api.token);
    expect(a.status).toBe(400); expect((await a.json()).error).toContain("Cole o link");
    const b = await call({ action: "connect", org_id: org, folder: "https://drive.google.com/drive/folders/naoexiste1234567" }, admin.api.token);
    expect((await b.json()).error).toContain("Compartilhe a pasta");
  });
  test("administrador conecta pelo link e a importação roda", async () => {
    const r = await call({ action: "connect", org_id: org, folder: `https://drive.google.com/drive/folders/${drive.idOf(ROOT)}?usp=sharing` }, admin.api.token);
    const j = await r.json();
    expect(r.status).toBe(200); expect(j.folder).toBe("multitracks"); expect(j.stats.created).toBe(1);
  });
  test("a mesma pasta não pode ser ligada a outra organização", async () => {
    const other = (await outsider.api.rpc("create_organization", { p_name: "Outra" })).data;
    const r = await call({ action: "connect", org_id: other, folder: drive.idOf(ROOT) }, outsider.api.token);
    expect(r.status).toBe(409);
  });
  test("agendamento exige o segredo", async () => {
    const bad = await handleSync(new Request("http://x/drive-sync?mode=cron", { method: "POST", headers: { "x-cron-secret": "errado" } }), env);
    expect(bad.status).toBe(403);
    const good = await handleSync(new Request("http://x/drive-sync?mode=cron", { method: "POST", headers: { "x-cron-secret": "segredo-teste" } }), env);
    const j = await good.json();
    expect(j.ok).toBe(true); expect(j.results[org].unchanged).toBe(1);
  });
  test("aviso do Drive com token errado é ignorado", async () => {
    const db = new Db(REST, env.serviceKey);
    await db.update("drive_integrations", `org_id=eq.${org}`, { watch_channel_id: "canal-1", watch_token: "token-certo" });
    const before = (await db.select("sync_runs", `org_id=eq.${org}`)).length;
    await handleSync(new Request("http://x/drive-sync", { method: "POST", headers: { "x-goog-channel-id": "canal-1", "x-goog-channel-token": "falso", "x-goog-resource-state": "change" } }), env);
    expect((await db.select("sync_runs", `org_id=eq.${org}`)).length).toBe(before);
    await handleSync(new Request("http://x/drive-sync", { method: "POST", headers: { "x-goog-channel-id": "canal-1", "x-goog-channel-token": "token-certo", "x-goog-resource-state": "change" } }), env);
    expect((await db.select("sync_runs", `org_id=eq.${org}`)).length).toBe(before + 1);
  });
});

describe("drive-media", () => {
  let fileId = "", size = 0;
  beforeAll(async () => {
    const db = new Db(REST, env.serviceKey);
    const s = (await db.select("songs", `org_id=eq.${org}`))[0];
    const m = (await db.select("project_media", `project_id=eq.${s.current_project_id}&name=eq.Click.wav`))[0];
    fileId = m.drive_file_id; size = m.size;
  });
  const get = (jwt: string | null, range?: string) => handleMedia(new Request(`http://x/drive-media?file=${fileId}`, { headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...(range ? { Range: range } : {}) } }), env);
  test("integrante recebe só o intervalo de bytes pedido", async () => {
    const r = await get(member.api.token, "bytes=44-1043");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes 44-1043/${size}`);
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
    expect(r.headers.get("access-control-expose-headers")).toContain("Content-Range");
  });
  test("quem não é da organização não acessa; sem login também não", async () => {
    expect((await get(outsider.api.token, "bytes=0-10")).status).toBe(403);
    expect((await get(null)).status).toBe(401);
  });
  test("arquivo do Drive que não pertence a nenhum projeto não é servido", async () => {
    const r = await handleMedia(new Request(`http://x/drive-media?file=${drive.idOf(ROOT)}`, { headers: { Authorization: `Bearer ${member.api.token}` } }), env);
    expect(r.status).toBe(403);
  });
});

describe("drive-media: vídeo do devocional (R2)", () => {
  const r2 = { endpoint: "http://r2.local", bucket: "somos", accessKeyId: "id", secretAccessKey: "segredo", region: "auto" };
  const post = (body: unknown, jwt: string, e: Env = { ...env, r2 }) => handleMedia(new Request("http://x/drive-media", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }), e);
  let team = "", devo = "";
  beforeAll(async () => {
    team = (await admin.api.post("teams", { org_id: org, name: "Louvor Devo", team_type: "louvor" })).data[0].id;
    const tok = (await admin.api.rpc("create_team_invite", { p_team: team })).data;
    await member.api.rpc("accept_invite", { p_token: tok });
    const ins = await member.api.post("team_devotionals", { team_id: team, org_id: org, title: "Teste", r2_key: `devotionals/${team}/x.mp4`, author_id: member.id });
    devo = ins.data[0].id;
  });
  test("integrante do time recebe link de envio; fora do time, não", async () => {
    const r = await post({ action: "devo_put", team_id: team, name: "Meu Vídeo.MP4" }, member.api.token);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.key).toMatch(new RegExp(`^devotionals/${team}/\\d+-meu-video.mp4$`));
    expect(j.url).toContain("X-Amz-Signature=");
    expect((await post({ action: "devo_put", team_id: team, name: "a.mp4" }, outsider.api.token)).status).toBe(403);
  });
  test("sem R2 configurado: 503 com mensagem clara", async () => {
    const r = await post({ action: "devo_put", team_id: team, name: "a.mp4" }, member.api.token, { ...env, r2: null });
    expect(r.status).toBe(503);
  });
  test("leitura só para quem enxerga o devocional", async () => {
    const ok = await post({ action: "devo_get", devotional_id: devo }, member.api.token);
    expect(ok.status).toBe(200);
    expect((await ok.json()).url).toContain(`devotionals/${team}/x.mp4`);
    expect((await post({ action: "devo_get", devotional_id: devo }, outsider.api.token)).status).toBe(404);
  });
});
