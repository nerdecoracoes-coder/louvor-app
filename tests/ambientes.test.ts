// Ambientes, redes e permissões: vínculos x funções x ações, sempre decididos no servidor.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, membro: any, integrante: any, multi: any, lider: any, supervisor: any, geral: any, dev: any, outro: any;
let org = "", louvor = "", infantil = "", multimidia = "", intercessao = "", redeA = "", redeB = "", orgOutro = "";

const perm = async (u: any, team: string, action: string) => (await u.api.rpc("has_perm", { p_team: team, p_action: action })).data;
const access = async (u: any) => (await u.api.rpc("my_access", { p_org: org })).data;

beforeAll(async () => {
  [admin, membro, integrante, multi, lider, supervisor, geral, dev, outro] = await Promise.all(
    ["Admin", "Membro", "Integrante", "Multi", "Líder", "Supervisor", "Geral", "Dev", "Outro"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Ambientes" })).data;
  await joinChurch(admin.api, org, membro, integrante, multi, lider, supervisor, geral, dev);
  const mk = async (name: string, type: string) => (await admin.api.post("teams", { org_id: org, name, team_type: type })).data[0].id;
  louvor = await mk("Louvor", "louvor"); infantil = await mk("Infantil", "infantil");
  multimidia = await mk("Multimídia", "multimidia"); intercessao = await mk("Intercessão", "intercessao");
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [integrante.id, multi.id, lider.id] });
  await admin.api.rpc("add_team_members", { p_team: infantil, p_users: [multi.id] });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: true });
  // conteúdo restrito ao time (chat): é ele que prova o isolamento entre ministérios e redes
  await integrante.api.post("messages", { org_id: org, team_id: louvor, user_id: integrante.id, kind: "text", body: "ensaio do louvor" });
  await multi.api.post("messages", { org_id: org, team_id: infantil, user_id: multi.id, kind: "text", body: "aula infantil" });
  redeA = (await admin.api.rpc("network_save", { p_org: org, p_id: null, p_name: "Rede A", p_teams: [louvor, intercessao] })).data;
  redeB = (await admin.api.rpc("network_save", { p_org: org, p_id: null, p_name: "Rede B", p_teams: [infantil, multimidia] })).data;
  await admin.api.rpc("grant_set", { p_org: org, p_user: supervisor.id, p_role: "network_supervisor", p_network: redeA, p_title: "Pastor da Rede A" });
  await admin.api.rpc("grant_set", { p_org: org, p_user: geral.id, p_role: "general_leader", p_network: null, p_title: "Pastor presidente" });
  orgOutro = (await outro.api.rpc("create_organization", { p_name: "Outra Igreja" })).data;
  await outro.api.post("teams", { org_id: orgOutro, name: "Time da outra igreja", team_type: "louvor" });
  // o desenvolvedor só pode ser marcado por quem tem a chave de serviço (SQL Editor), nunca pelo próprio usuário
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${await serviceKey()}`, apikey: await serviceKey(), "Content-Type": "application/json" }, body: JSON.stringify({ is_developer: true }) });
});

describe("cenário 1 — membro comum", () => {
  test("é da igreja, sem vínculo com time e sem nenhuma função", async () => {
    expect(await access(membro)).toMatchObject({ member: true, admin: false, developer: false, general_leader: null, networks: [], leader_of: [], member_of: [] });
    expect(await perm(membro, louvor, "view")).toBe(false);
    expect((await membro.api.get(`/messages?team_id=eq.${louvor}`)).data).toEqual([]);
  });
});

describe("cenário 2 — integrante de um time", () => {
  test("vê o time, mas não administra", async () => {
    expect((await access(integrante)).member_of).toEqual([louvor]);
    expect(await perm(integrante, louvor, "view")).toBe(true);
    for (const a of ["create", "edit", "delete", "approve", "manage", "administer"]) expect(await perm(integrante, louvor, a)).toBe(false);
    await integrante.api.patch(`teams?id=eq.${louvor}`, { description: "invadido" });
    expect((await admin.api.get(`/teams?id=eq.${louvor}`)).data[0].description).not.toBe("invadido");
  });
});

describe("cenário 3 — integrante de vários times", () => {
  test("acessa os dois, sem liderança automática", async () => {
    expect((await access(multi)).member_of.sort()).toEqual([louvor, infantil].sort());
    expect(await perm(multi, louvor, "view")).toBe(true); expect(await perm(multi, infantil, "view")).toBe(true);
    expect(await perm(multi, louvor, "manage")).toBe(false); expect(await perm(multi, infantil, "manage")).toBe(false);
    expect((await access(multi)).leader_of).toEqual([]);
  });
});

describe("cenário 4 — líder de ministério", () => {
  test("administra o próprio ministério e só ele", async () => {
    expect(await perm(lider, louvor, "manage")).toBe(true); expect(await perm(lider, louvor, "edit")).toBe(true);
    expect(await perm(lider, louvor, "administer")).toBe(false);
    expect(await perm(lider, infantil, "view")).toBe(false); expect(await perm(lider, infantil, "manage")).toBe(false);
    expect((await lider.api.rpc("can_manage_team", { p_team: infantil })).data).toBe(false);
    expect((await lider.api.rpc("can_manage_team", { p_team: louvor })).data).toBe(true);
  });
});

describe("cenário 5 — pastor supervisor", () => {
  test("enxerga e acompanha só os ministérios da sua rede", async () => {
    const a = await access(supervisor);
    expect(a.networks).toHaveLength(1); expect(a.networks[0]).toMatchObject({ id: redeA, title: "Pastor da Rede A" });
    for (const t of [louvor, intercessao]) { expect(await perm(supervisor, t, "view")).toBe(true); expect(await perm(supervisor, t, "manage")).toBe(true); expect(await perm(supervisor, t, "approve")).toBe(true); }
    for (const t of [infantil, multimidia]) { expect(await perm(supervisor, t, "view")).toBe(false); expect(await perm(supervisor, t, "manage")).toBe(false); }
    expect(await perm(supervisor, louvor, "delete")).toBe(false);
    expect((await supervisor.api.get(`/messages?team_id=eq.${louvor}`)).data.length).toBeGreaterThan(0);
    expect((await supervisor.api.get(`/messages?team_id=eq.${infantil}`)).data).toEqual([]);   // dados isolados entre redes
  });
  test("não configura rede nem funções de ninguém", async () => {
    expect((await supervisor.api.rpc("network_save", { p_org: org, p_id: null, p_name: "X", p_teams: [] })).ok).toBe(false);
    expect((await supervisor.api.rpc("grant_set", { p_org: org, p_user: membro.id, p_role: "network_supervisor", p_network: redeA, p_title: null })).ok).toBe(false);
  });
});

describe("cenário 6 — liderança geral", () => {
  test("acessa todos os times da igreja e configura redes e supervisores", async () => {
    for (const t of [louvor, infantil, multimidia, intercessao]) { expect(await perm(geral, t, "view")).toBe(true); expect(await perm(geral, t, "manage")).toBe(true); }
    expect(await perm(geral, louvor, "delete")).toBe(false);   // exclusão não vem no padrão da função
    expect((await access(geral)).general_leader).toMatchObject({ title: "Pastor presidente" });
    const g = await geral.api.rpc("grant_set", { p_org: org, p_user: membro.id, p_role: "network_supervisor", p_network: redeB, p_title: "Pastor B" });
    expect(g.ok).toBe(true);
    expect(await perm(membro, infantil, "view")).toBe(true); expect(await perm(membro, louvor, "view")).toBe(false);
    expect((await geral.api.rpc("grant_remove", { p_id: g.data })).ok).toBe(true);
    expect(await perm(membro, infantil, "view")).toBe(false);
  });
  test("não nomeia outra liderança geral nem repassa mais do que tem", async () => {
    expect((await geral.api.rpc("grant_set", { p_org: org, p_user: membro.id, p_role: "general_leader", p_network: null, p_title: "Bispo" })).ok).toBe(false);
    expect((await geral.api.rpc("grant_set", { p_org: org, p_user: membro.id, p_role: "network_supervisor", p_network: redeB, p_title: null, p_actions: ["view", "delete"] })).ok).toBe(false);
  });
  test("a liderança geral não é administradora (não apaga a igreja nem muda configurações de administrador)", async () => {
    expect((await geral.api.rpc("is_org_admin", { p_org: org })).data).toBe(false);
  });
});

describe("cenário 7 — desenvolvedor", () => {
  test("acessa qualquer igreja e time, mesmo sem vínculo", async () => {
    expect((await dev.api.rpc("my_access", { p_org: orgOutro })).data.developer).toBe(true);
    for (const a of ["view", "manage", "administer", "delete"]) expect(await perm(dev, louvor, a)).toBe(true);
    const orgs = (await dev.api.rpc("dev_orgs")).data.map((o: any) => o.id);
    expect(orgs).toContain(org); expect(orgs).toContain(orgOutro);
    expect((await dev.api.get(`/teams?org_id=eq.${orgOutro}`)).data).toBeDefined();
  });
  test("modo auditoria: circula e edita as áreas, mas não lê dado pessoal de ninguém", async () => {
    // estrutura continua aberta (e editável) em qualquer igreja
    expect((await dev.api.get(`/teams?org_id=eq.${orgOutro}`)).data.length).toBeGreaterThan(0);
    const tOutro = (await dev.api.get(`/teams?org_id=eq.${orgOutro}`)).data[0].id;
    expect((await dev.api.patch(`teams?id=eq.${tOutro}`, { description: "auditado" })).ok).toBe(true);
    // conversas de times em que não está de verdade: fechadas
    expect((await dev.api.get(`/messages?team_id=eq.${louvor}`)).data.length).toBe(0);
    expect((await dev.api.get(`/messages?team_id=eq.${infantil}`)).data.length).toBe(0);
    // pessoas de outra igreja: nem o vínculo nem o perfil
    expect((await dev.api.get(`/org_members?org_id=eq.${orgOutro}`)).data.length).toBe(0);
    expect((await dev.api.get(`/profiles?id=eq.${outro.id}`)).data.length).toBe(0);
    // o que é dele continua dele
    expect((await dev.api.get(`/profiles?id=eq.${dev.id}`)).data.length).toBe(1);
  });
  test("o servidor nega a quem não é desenvolvedor", async () => {
    expect((await membro.api.rpc("dev_orgs")).ok).toBe(false);
    expect((await admin.api.rpc("dev_orgs")).ok).toBe(false);
    expect(await perm(admin, louvor, "view")).toBe(true);   // admin da própria igreja continua com acesso
  });
});

describe("estrutura e proteção das tabelas", () => {
  test("nada é gravado direto: só pelas funções do servidor", async () => {
    expect((await admin.api.post("church_networks", { org_id: org, name: "direto" })).ok).toBe(false);
    expect((await admin.api.post("access_grants", { org_id: org, user_id: membro.id, role_key: "general_leader", actions: ["administer"] })).ok).toBe(false);
  });
  test("apagar uma rede não apaga os times", async () => {
    const r = (await admin.api.rpc("network_save", { p_org: org, p_id: null, p_name: "Temporária", p_teams: [multimidia] })).data;
    await admin.api.rpc("network_delete", { p_id: r });
    expect((await admin.api.get(`/teams?id=eq.${multimidia}`)).data).toHaveLength(1);
  });
  test("só entra na rede time da própria igreja, e só membro recebe função", async () => {
    const tOutro = (await outro.api.post("teams", { org_id: orgOutro, name: "Alheio", team_type: "louvor" })).data[0].id;
    expect((await admin.api.rpc("network_save", { p_org: org, p_id: null, p_name: "Mistura", p_teams: [tOutro] })).ok).toBe(false);
    expect((await admin.api.rpc("grant_set", { p_org: org, p_user: outro.id, p_role: "network_supervisor", p_network: redeA, p_title: null })).ok).toBe(false);
  });
  test("um membro só enxerga a própria concessão", async () => {
    expect((await supervisor.api.get(`/access_grants?org_id=eq.${org}`)).data.every((g: any) => g.user_id === supervisor.id)).toBe(true);
    expect((await admin.api.get(`/access_grants?org_id=eq.${org}`)).data.length).toBeGreaterThanOrEqual(2);
  });
});
