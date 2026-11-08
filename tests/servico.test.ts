// Ambiente de serviço: checklist por função, horário real do check e antecedência.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, membro: any, outro: any, fora: any;
let org = "", team = "", sch = "", item = "";

beforeAll(async () => {
  [admin, lider, membro, outro, fora] = await Promise.all(["Admin S", "Lider S", "Membro S", "Outro S", "Fora S"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Servir" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, lider, membro, outro);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id, membro.id, outro.id] });
  await admin.api.patch(`team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { is_leader: true });
  sch = (await lider.api.post("schedules", { org_id: org, team_id: team, title: "Culto S", starts_at: new Date(Date.now() + 3600e3).toISOString(), status: "published" })).data[0].id;
  await lider.api.post("schedule_assignments", { schedule_id: sch, org_id: org, team_id: team, user_id: membro.id });
});

describe("serviço", () => {
  test("antecedência padrão de 60 min e só o líder muda", async () => {
    expect((await lider.api.get(`/teams?id=eq.${team}&select=service_lead_min`)).data[0].service_lead_min).toBe(60);
    expect((await lider.api.patch(`teams?id=eq.${team}`, { service_lead_min: 30 })).ok).toBe(true);
    await membro.api.patch(`teams?id=eq.${team}`, { service_lead_min: 5 });
    expect((await lider.api.get(`/teams?id=eq.${team}&select=service_lead_min`)).data[0].service_lead_min).toBe(30);
  });

  test("o líder monta o checklist; o membro lê mas não edita", async () => {
    const r = await lider.api.post("role_checklist_items", { org_id: org, team_id: team, label: "Chegar ao local", offset_min: -30, position: 1 });
    expect(r.status).toBe(201);
    item = r.data[0].id;
    expect((await membro.api.post("role_checklist_items", { org_id: org, team_id: team, label: "X" })).ok).toBe(false);
    expect((await membro.api.get(`/role_checklist_items?team_id=eq.${team}`)).data).toHaveLength(1);
    expect((await fora.api.get(`/role_checklist_items?team_id=eq.${team}`)).data).toHaveLength(0);
  });

  test("quem está escalado marca com a hora do servidor; os outros não", async () => {
    const row = { schedule_id: sch, item_id: item, user_id: membro.id, org_id: org, team_id: team, target_at: new Date(Date.now() + 1800e3).toISOString() };
    const r = await membro.api.post("service_checks", row);
    expect(r.status).toBe(201);
    expect(Math.abs(new Date(r.data[0].checked_at).getTime() - Date.now())).toBeLessThan(60e3);
    expect((await outro.api.post("service_checks", { ...row, user_id: outro.id })).ok).toBe(false); // não escalado
    expect((await membro.api.post("service_checks", { ...row, user_id: lider.id })).ok).toBe(false); // em nome de outro
    expect((await outro.api.get(`/service_checks?schedule_id=eq.${sch}`)).data).toHaveLength(0);
    expect((await lider.api.get(`/service_checks?schedule_id=eq.${sch}`)).data).toHaveLength(1);
  });

  test("desmarcar apaga só o próprio check", async () => {
    await outro.api.del(`service_checks?schedule_id=eq.${sch}`);
    expect((await lider.api.get(`/service_checks?schedule_id=eq.${sch}`)).data).toHaveLength(1);
    await membro.api.del(`service_checks?schedule_id=eq.${sch}&item_id=eq.${item}`);
    expect((await lider.api.get(`/service_checks?schedule_id=eq.${sch}`)).data).toHaveLength(0);
  });
});
