// Aviso ao escalar quem já está escalado em outro time no mesmo evento.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, liderA: any, liderB: any, pessoa: any, org = "", louvor = "", media = "", ev = "";
const quando = new Date(Date.now() + 5 * 86400e3).toISOString();

beforeAll(async () => {
  [admin, liderA, liderB, pessoa] = await Promise.all(["Admin E", "Lider A", "Lider B", "Pessoa E"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Conflito" })).data;
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  media = (await admin.api.post("teams", { org_id: org, name: "Multimídia", team_type: "multimidia" })).data[0].id;
  await joinChurch(admin.api, org, liderA, liderB, pessoa);
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [liderA.id, pessoa.id] });
  await admin.api.rpc("add_team_members", { p_team: media, p_users: [liderB.id, pessoa.id] });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${liderA.id}`, { is_leader: true });
  await admin.api.patch(`team_members?team_id=eq.${media}&user_id=eq.${liderB.id}`, { is_leader: true });
  ev = (await admin.api.post("church_events", { org_id: org, title: "Culto", starts_at: quando, created_by: admin.id })).data[0].id;
  const s = (await liderB.api.post("schedules", { org_id: org, team_id: media, title: "Culto", starts_at: quando, church_event_id: ev, created_by: liderB.id })).data[0].id;
  await liderB.api.post("schedule_assignments", { schedule_id: s, org_id: org, team_id: media, user_id: pessoa.id, role_name: "Projeção" });
});

describe("escalado em outro time", () => {
  test("o líder do Louvor vê time e função de quem já está na Multimídia no mesmo evento", async () => {
    const r = (await liderA.api.rpc("scheduled_elsewhere", { p_team: louvor, p_starts: quando, p_church_event: ev, p_exclude: null, p_users: [pessoa.id, liderA.id] })).data;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ user_id: pessoa.id, team_name: "Multimídia", role_name: "Projeção" });
  });
  test("vale também pelo mesmo horário, sem evento da agenda", async () => {
    const r = (await liderA.api.rpc("scheduled_elsewhere", { p_team: louvor, p_starts: quando, p_church_event: null, p_exclude: null, p_users: [pessoa.id] })).data;
    expect(r).toHaveLength(1);
    const outro = (await liderA.api.rpc("scheduled_elsewhere", { p_team: louvor, p_starts: new Date(Date.now() + 9 * 86400e3).toISOString(), p_church_event: null, p_exclude: null, p_users: [pessoa.id] })).data;
    expect(outro).toHaveLength(0);
  });
  test("quem não lidera o time não consulta", async () => {
    expect((await pessoa.api.rpc("scheduled_elsewhere", { p_team: louvor, p_starts: quando, p_church_event: ev, p_exclude: null, p_users: [pessoa.id] })).ok).toBe(false);
  });
});
