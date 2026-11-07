// Coordenador de agenda: escolhido pelo administrador; mexe só na agenda e nos avisos gerais; os líderes dos ministérios marcados são avisados.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey } from "./helpers";

let admin: any, coord: any, lider: any, membro: any;
let org = "", louvor = "", infantil = "", ev = "";

beforeAll(async () => {
  [admin, coord, lider, membro] = await Promise.all(["Admin C", "Coord C", "Lider C", "Membro C"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Agenda" })).data;
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  infantil = (await admin.api.post("teams", { org_id: org, name: "Infantil", team_type: "infantil" })).data[0].id;
  await joinChurch(admin.api, org, coord, lider, membro);
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: true });
});

const when = (days: number) => new Date(Date.now() + days * 86400e3).toISOString();
const mk = (api: any, extra: any = {}) => api.post("church_events", { org_id: org, title: "Culto dos jovens", kind: "culto", starts_at: when(10), created_by: api.userId, ...extra });

describe("coordenador de agenda", () => {
  test("sem ser coordenador, ninguém além do administrador mexe na agenda (nem o líder)", async () => {
    expect((await mk(lider.api)).ok).toBe(false);
    expect((await mk(membro.api)).ok).toBe(false);
    expect((await mk(admin.api)).status).toBe(201);
  });

  test("só o administrador escolhe o coordenador", async () => {
    expect((await coord.api.patch(`org_members?org_id=eq.${org}&user_id=eq.${coord.id}`, { agenda_coordinator: true })).data).toHaveLength(0);
    expect((await lider.api.patch(`org_members?org_id=eq.${org}&user_id=eq.${lider.id}`, { agenda_coordinator: true })).data).toHaveLength(0);
    const r = await admin.api.patch(`org_members?org_id=eq.${org}&user_id=eq.${coord.id}`, { agenda_coordinator: true });
    expect(r.data[0].agenda_coordinator).toBe(true);
  });

  test("o coordenador cria, edita e apaga eventos e avisos gerais", async () => {
    const c = await mk(coord.api); expect(c.status).toBe(201); ev = c.data[0].id;
    expect((await coord.api.patch(`church_events?id=eq.${ev}`, { title: "Culto de jovens" })).data[0].title).toBe("Culto de jovens");
    const a = await coord.api.post("announcements", { org_id: org, title: "Aviso geral", body: "x", created_by: coord.id });
    expect(a.status).toBe(201);
    const outro = await mk(admin.api, { title: "Outro" });
    expect((await coord.api.patch(`church_events?id=eq.${outro.data[0].id}`, { title: "Editado" })).data[0].title).toBe("Editado"); // evento de outra pessoa
    expect((await coord.api.del(`church_events?id=eq.${outro.data[0].id}`)).data).toHaveLength(1);
    expect((await coord.api.del(`announcements?id=eq.${a.data[0].id}`)).data).toHaveLength(1);
  });

  test("o coordenador não mexe em escalas, times nem membros", async () => {
    expect((await coord.api.post("schedules", { org_id: org, team_id: louvor, title: "X", starts_at: when(3), created_by: coord.id })).ok).toBe(false);
    expect((await coord.api.post("teams", { org_id: org, name: "Novo" })).ok).toBe(false);
    expect((await coord.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: false })).data ?? []).toHaveLength(0);
    expect((await coord.api.del(`org_members?org_id=eq.${org}&user_id=eq.${membro.id}`)).data ?? []).toHaveLength(0);
  });

  test("marcar o ministério avisa o líder; sem líder, avisa o administrador", async () => {
    expect((await membro.api.post("church_event_teams", { event_id: ev, team_id: louvor, org_id: org })).ok).toBe(false);
    expect((await coord.api.post("church_event_teams", { event_id: ev, team_id: louvor, org_id: org })).status).toBe(201);
    expect((await coord.api.post("church_event_teams", { event_id: ev, team_id: infantil, org_id: org })).status).toBe(201);
    const l = (await lider.api.get("/notifications?kind=eq.escala_pendente")).data;
    expect(l).toHaveLength(1);
    expect(l[0].title).toContain("CRIE A ESCALA");
    expect(l[0].link).toBe(`#/escala/nova/${louvor}?evento=${ev}`);
    expect((await admin.api.get("/notifications?kind=eq.escala_pendente")).data).toHaveLength(1); // Infantil sem líder
    expect((await membro.api.get("/notifications?kind=eq.escala_pendente")).data).toHaveLength(0);
  });

  test("lista de pendências do líder some quando a escala é criada", async () => {
    expect((await lider.api.rpc("my_pending_scales")).data.map((p: any) => p.team_id)).toEqual([louvor]);
    const s = await lider.api.post("schedules", { org_id: org, team_id: louvor, title: "Culto", starts_at: when(10), church_event_id: ev, created_by: lider.id });
    expect(s.status).toBe(201);
    expect((await lider.api.rpc("my_pending_scales")).data).toHaveLength(0);
  });

  test("lembrete diário: só de 7 dias antes em diante, uma vez por dia, só quem ainda não criou a escala", async () => {
    const svc = await serviceKey();
    const call = () => fetch((process.env.REST_URL ?? "http://127.0.0.1:3000") + "/rpc/remind_pending_scales", { method: "POST", headers: { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
    expect(await call()).toBe(0); // faltam 10 dias
    await admin.api.patch(`church_events?id=eq.${ev}`, { starts_at: when(5) });
    expect(await call()).toBe(1);  // Infantil (admin); o Louvor já tem escala
    expect(await call()).toBe(0);  // mesmo dia: não repete
    expect((await admin.api.get("/notifications?kind=eq.escala_lembrete")).data).toHaveLength(1);
    expect((await admin.api.get("/notifications?kind=eq.escala_lembrete")).data[0].title).toContain("FALTA A ESCALA");
    expect((await lider.api.get("/notifications?kind=eq.escala_lembrete")).data).toHaveLength(0);
  });
});
