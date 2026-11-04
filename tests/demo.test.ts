// Integrantes de teste: o administrador cria contas fictícias num time, com função e prazo; vencido o prazo, somem.
import { describe, expect, test, beforeAll } from "bun:test";
import { handleSync, type Env } from "../supabase/functions/_shared/handlers.ts";
import { Db } from "../supabase/functions/_shared/db.ts";
import { FsDrive } from "./fsdrive.ts";
import { newUser, serviceKey, anonKey, REST, AUTH, joinChurch } from "./helpers.ts";

let env: Env, db: Db, admin: any, lider: any, org = "", team = "";
const call = (body: unknown, jwt: string) => handleSync(new Request("http://x/drive-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }), env);

beforeAll(async () => {
  env = { rest: REST, serviceKey: await serviceKey(), anonKey: await anonKey(), cronSecret: "s", drive: () => new FsDrive("/tmp"), auth: AUTH };
  db = new Db(REST, env.serviceKey);
  [admin, lider] = await Promise.all([newUser("Admin D"), newUser("Lider D")]);
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Testes" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Multimídia D", team_type: "multimidia" })).data[0].id;
  await joinChurch(admin.api, org, lider);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { is_leader: true });
});

describe("integrantes de teste", () => {
  test("só o administrador cria", async () => {
    expect((await call({ action: "demo-create", org_id: org, team_id: team, count: 2, days: 3 }, lider.api.token)).status).toBe(403);
  });

  test("cria contas no time, cada uma com uma função do tipo do time, e que conseguem entrar no app", async () => {
    const r = await (await call({ action: "demo-create", org_id: org, team_id: team, count: 3, days: 3 }, admin.api.token)).json();
    expect(r.users.map((u: any) => u.name)).toEqual(["Teste · Direção", "Teste · Projeção", "Teste · Transmissão/Corte"]);
    const tm = (await lider.api.get(`/team_members?team_id=eq.${team}`)).data;
    expect(tm).toHaveLength(4);
    expect((await lider.api.get(`/team_member_roles?team_id=eq.${team}`)).data).toHaveLength(3);
    // entra com o e-mail e a senha mostrados ao administrador
    const login = await fetch(`${AUTH}/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: env.anonKey }, body: JSON.stringify({ email: r.users[0].email, password: r.users[0].password }) });
    expect(login.status).toBe(200);
    expect((await admin.api.get(`/demo_users?org_id=eq.${org}`)).data).toHaveLength(3);
    expect((await lider.api.get(`/demo_users?org_id=eq.${org}`)).data).toHaveLength(0); // lista só para o admin
    // mais contas continuam a sequência das funções
    const r2 = await (await call({ action: "demo-create", org_id: org, team_id: team, count: 1, days: 3 }, admin.api.token)).json();
    expect(r2.users[0].name).toBe("Teste · Câmera 2");
  });

  test("vencido o prazo, a verificação agendada apaga as contas e tudo o que fizeram", async () => {
    const [one] = (await db.select("demo_users", `org_id=eq.${org}&limit=1`));
    await db.update("demo_users", `user_id=eq.${one.user_id}`, { expires_at: "2020-01-01T00:00:00Z" });
    await handleSync(new Request("http://x/drive-sync?mode=cron", { method: "POST", headers: { "x-cron-secret": "s" } }), env);
    expect(await db.select("demo_users", `user_id=eq.${one.user_id}`)).toHaveLength(0);
    expect(await db.select("team_members", `user_id=eq.${one.user_id}`)).toHaveLength(0);
    expect(await db.select("profiles", `id=eq.${one.user_id}`)).toHaveLength(0);
  });

  test("apagar agora remove todas as contas de teste da igreja", async () => {
    const r = await (await call({ action: "demo-delete", org_id: org }, admin.api.token)).json();
    expect(r.deleted).toBe(3);
    expect((await lider.api.get(`/team_members?team_id=eq.${team}`)).data).toHaveLength(1);
  });
});
