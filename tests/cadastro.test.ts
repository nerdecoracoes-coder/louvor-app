// Cadastro de quem entra no Louvor por convite: o convite lista as funções e a pessoa grava as próprias (pelo menos uma).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, novo: any, estranho: any, org = "", louvor = "", token = "";
beforeAll(async () => {
  [admin, novo, estranho] = await Promise.all(["Admin R", "Novo R", "Estranho R"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Cadastro" })).data;
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, novo);
  token = (await admin.api.rpc("create_team_invite", { p_team: louvor })).data;
});

describe("cadastro do Louvor", () => {
  test("o convite informa o tipo do time e lista as funções", async () => {
    expect((await novo.api.rpc("get_invite", { p_token: token })).data.team.team_type).toBe("louvor");
    const roles = (await novo.api.rpc("invite_roles", { p_token: token })).data;
    expect(roles.map((r: any) => r.name)).toContain("Guitarra");
    expect((await novo.api.rpc("invite_roles", { p_token: "token-falso" })).data).toHaveLength(0);
  });
  test("só quem já é do time grava funções, e no Louvor precisa de pelo menos uma", async () => {
    const roles = (await novo.api.rpc("invite_roles", { p_token: token })).data;
    expect((await novo.api.rpc("finish_registration", { p_team: louvor, p_roles: [roles[0].id] })).ok).toBe(false); // ainda não aceitou
    expect((await novo.api.rpc("accept_invite", { p_token: token, p_church: null })).ok).toBe(true);
    expect((await novo.api.rpc("finish_registration", { p_team: louvor, p_roles: [] })).ok).toBe(false);
    expect((await novo.api.rpc("finish_registration", { p_team: louvor, p_roles: [roles[1].id, roles[2].id] })).ok).toBe(true);
    const mine = (await novo.api.get(`/team_member_roles?team_id=eq.${louvor}&user_id=eq.${novo.id}`)).data;
    expect(mine).toHaveLength(2);
    expect((await estranho.api.rpc("finish_registration", { p_team: louvor, p_roles: [roles[0].id] })).ok).toBe(false);
  });
});
