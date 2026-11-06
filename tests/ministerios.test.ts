// Ministério Infantil (crianças, entrada e saída) e Diáconos (visitantes).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, voluntario: any, fora: any, outroTime: any;
let org = "", infantil = "", diaconal = "", louvor = "", kid = "";

beforeAll(async () => {
  [admin, lider, voluntario, fora, outroTime] = await Promise.all(["Admin K", "Lider K", "Voluntario K", "Fora K", "Outro Time K"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Kids" })).data;
  infantil = (await admin.api.post("teams", { org_id: org, name: "Infantil", team_type: "infantil" })).data[0].id;
  diaconal = (await admin.api.post("teams", { org_id: org, name: "Diáconos", team_type: "diaconal" })).data[0].id;
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, lider, voluntario, outroTime);
  await admin.api.rpc("add_team_members", { p_team: infantil, p_users: [lider.id, voluntario.id] });
  await admin.api.rpc("add_team_members", { p_team: diaconal, p_users: [lider.id] });
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [outroTime.id] });
  await admin.api.patch(`team_members?team_id=eq.${infantil}&user_id=eq.${lider.id}`, { is_leader: true });
});

describe("ambientes dos ministérios", () => {
  test("os tipos já vêm com recursos e funções", async () => {
    expect((await admin.api.get(`/teams?id=eq.${infantil}&select=features`)).data[0].features).toEqual(["checklist", "criancas", "eventos"]);
    expect((await admin.api.get(`/teams?id=eq.${diaconal}&select=features`)).data[0].features).toEqual(["checklist", "eventos", "roteiro", "visitantes"]);
    const d = (await admin.api.get(`/music_roles?org_id=eq.${org}&team_type=eq.diaconal`)).data.map((r: any) => r.name);
    for (const n of ["Portaria", "Ofertório", "Introdução", "Santa Ceia"]) expect(d).toContain(n);
  });

  test("crianças: o time cadastra, faz entrada e saída; quem é de outro time não vê", async () => {
    const c = await voluntario.api.post("children", { org_id: org, team_id: infantil, name: "Lia", guardian_name: "Marta", guardian_phone: "21999990000", allergies: "amendoim" });
    expect(c.status).toBe(201); kid = c.data[0].id;
    expect((await outroTime.api.get(`/children?team_id=eq.${infantil}`)).data).toHaveLength(0);
    expect((await fora.api.get(`/children?team_id=eq.${infantil}`)).data).toHaveLength(0);
    expect((await outroTime.api.post("children", { org_id: org, team_id: infantil, name: "X" })).ok).toBe(false);
    const ci = await voluntario.api.post("child_checkins", { org_id: org, team_id: infantil, child_id: kid, code: "1234", checked_in_by: voluntario.id });
    expect(ci.status).toBe(201);
    expect((await voluntario.api.post("child_checkins", { org_id: org, team_id: infantil, child_id: kid, code: "9999" })).ok).toBe(false); // já está presente
    const out = await voluntario.api.patch(`child_checkins?id=eq.${ci.data[0].id}`, { checked_out_at: new Date().toISOString(), picked_by: "Marta", code_ok: true });
    expect(out.ok).toBe(true);
    expect((await voluntario.api.post("child_checkins", { org_id: org, team_id: infantil, child_id: kid, code: "5555" })).status).toBe(201); // nova entrada depois da saída
  });

  test("o time Diáconos não cadastra crianças (recurso do time)", async () => {
    expect((await lider.api.post("children", { org_id: org, team_id: diaconal, name: "Y" })).ok).toBe(false);
  });

  test("visitantes: o time registra e acompanha; outro time não vê", async () => {
    const v = await lider.api.post("visitors", { org_id: org, team_id: diaconal, name: "Paulo", phone: "21988887777", how_known: "Convite de alguém" });
    expect(v.status).toBe(201);
    expect((await lider.api.patch(`visitors?id=eq.${v.data[0].id}`, { status: "contatado" })).ok).toBe(true);
    expect((await outroTime.api.get(`/visitors?team_id=eq.${diaconal}`)).data).toHaveLength(0);
    expect((await lider.api.post("visitors", { org_id: org, team_id: infantil, name: "Z" })).ok).toBe(false);
  });
});
