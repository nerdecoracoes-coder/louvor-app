// Página Time: equipes dentro do time e classificações do repertório (permissões).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, membro: any, outro: any, fora: any;
let org = "", time = "", outroTime = "", grupo = "";

beforeAll(async () => {
  [admin, lider, membro, outro, fora] = await Promise.all(["Admin T", "Lider T", "Membro T", "Outro T", "Fora T"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Time" })).data;
  time = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  outroTime = (await admin.api.post("teams", { org_id: org, name: "Mídia", team_type: "multimidia" })).data[0].id;
  await joinChurch(admin.api, org, lider, membro, outro);
  await admin.api.rpc("add_team_members", { p_team: time, p_users: [lider.id, membro.id] });
  await admin.api.rpc("add_team_members", { p_team: outroTime, p_users: [outro.id] });
  await admin.api.patch(`team_members?team_id=eq.${time}&user_id=eq.${lider.id}`, { is_leader: true });
});

describe("equipes do time", () => {
  test("o líder cria uma equipe e coloca integrantes nela", async () => {
    const g = await lider.api.post("team_groups", { team_id: time, org_id: org, name: "Banda A" });
    expect(g.status).toBe(201);
    grupo = g.data[0].id;
    const m = await lider.api.post("team_group_members", { group_id: grupo, user_id: membro.id, team_id: time, org_id: org });
    expect(m.status).toBe(201);
  });
  test("integrante comum vê as equipes, mas não cria nem apaga", async () => {
    expect((await membro.api.get(`/team_groups?team_id=eq.${time}`)).data.length).toBe(1);
    expect((await membro.api.post("team_groups", { team_id: time, org_id: org, name: "Banda B" })).status).toBeGreaterThanOrEqual(400);
    await membro.api.del(`/team_groups?id=eq.${grupo}`);
    expect((await lider.api.get(`/team_groups?id=eq.${grupo}`)).data.length).toBe(1);
  });
  test("quem é de outro time ou de fora da igreja não vê as equipes", async () => {
    expect((await outro.api.get(`/team_groups?team_id=eq.${time}`)).data.length).toBe(0);
    expect((await fora.api.get(`/team_groups?team_id=eq.${time}`)).data.length).toBe(0);
  });
  test("o líder de um time não mexe nas equipes de outro time", async () => {
    expect((await lider.api.post("team_groups", { team_id: outroTime, org_id: org, name: "Invasora" })).status).toBeGreaterThanOrEqual(400);
  });
});

describe("classificações do repertório", () => {
  test("líder cadastra; membro da igreja lê; membro comum não altera; fora não vê", async () => {
    expect((await lider.api.post("classifications", { org_id: org, name: "Adoração", sort: 1 })).status).toBe(201);
    expect((await membro.api.get(`/classifications?org_id=eq.${org}`)).data.length).toBe(1);
    expect((await membro.api.post("classifications", { org_id: org, name: "Ceia" })).status).toBeGreaterThanOrEqual(400);
    expect((await fora.api.get(`/classifications?org_id=eq.${org}`)).data.length).toBe(0);
  });
  test("nome repetido na mesma igreja é recusado", async () => {
    expect((await lider.api.post("classifications", { org_id: org, name: "Adoração" })).status).toBeGreaterThanOrEqual(400);
  });
});
