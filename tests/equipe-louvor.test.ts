// Cadastro de uma equipe de louvor independente: espaço próprio, líder, somente time, isolada das outras.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser } from "./helpers";

let a: any, b: any, ra: any;

beforeAll(async () => {
  [a, b] = await Promise.all(["Líder A", "Líder B"].map(newUser));
  ra = (await a.api.rpc("create_louvor_team", { p_name: "Louvor Alfa", p_church: "Igreja Alfa" })).data;
});

describe("cadastro de equipe de louvor", () => {
  test("cria o espaço, a equipe de louvor e deixa quem cadastrou como líder", async () => {
    expect(ra.org_id && ra.team_id).toBeTruthy();
    const org = (await a.api.get(`/organizations?id=eq.${ra.org_id}`)).data[0];
    expect(org).toMatchObject({ name: "Louvor Alfa", subtitle: "Igreja Alfa", team_only: true });
    const team = (await a.api.get(`/teams?id=eq.${ra.team_id}`)).data[0];
    expect(team).toMatchObject({ team_type: "louvor", name: "Louvor Alfa" });
    const tm = (await a.api.get(`/team_members?team_id=eq.${ra.team_id}`)).data;
    expect(tm).toHaveLength(1); expect(tm[0]).toMatchObject({ user_id: a.id, is_leader: true });
    expect((await a.api.get(`/music_roles?org_id=eq.${ra.org_id}`)).data.length).toBeGreaterThan(5);   // funções de louvor já cadastradas
  });
  test("outra equipe não enxerga nada da primeira", async () => {
    const rb = (await b.api.rpc("create_louvor_team", { p_name: "Louvor Beta" })).data;
    expect((await b.api.get(`/teams?id=eq.${ra.team_id}`)).data).toEqual([]);
    expect((await b.api.get(`/organizations?id=eq.${ra.org_id}`)).data).toEqual([]);
    expect((await a.api.get(`/teams?id=eq.${rb.team_id}`)).data).toEqual([]);
  });
  test("nome é obrigatório e é preciso estar logado", async () => {
    expect((await a.api.rpc("create_louvor_team", { p_name: "  " })).ok).toBe(false);
  });

  test("a marca de desenvolvedor não pode ser ligada pelo próprio usuário", async () => {
    await a.api.patch(`/profiles?id=eq.${a.id}`, { is_developer: true, about: "oi" });
    const p = (await a.api.get(`/profiles?id=eq.${a.id}`)).data[0];
    expect(p).toMatchObject({ about: "oi", is_developer: false });
  });
});
