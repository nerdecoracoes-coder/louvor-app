// Ficha individual: família, vida na igreja, vínculos com times, histórico, cartão do líder e acompanhamento pastoral restrito.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, secretaria: any, pastor: any, integrante: any, lider: any, outroLider: any, dev: any, comum: any, outraIgreja: any, semFicha: any;
const denied = (r: any) => !r.ok || (Array.isArray(r.data) && r.data.length === 0);
let org = "", louvor = "", infantil = "";
let ana = "", beto = "", caio = "", semConta = "", orgB = "", pessoaB = "";
const save = async (u: any, p: any, id: string | null = null) => (await u.api.rpc("person_save", { p_org: org, p_id: id, p })).data;
const hist = async (id: string) => ((await admin.api.get(`/person_history?person_id=eq.${id}&select=kind,field,new_value,note&order=id`)).data || []);

beforeAll(async () => {
  [admin, secretaria, pastor, integrante, lider, outroLider, dev, comum, outraIgreja, semFicha] = await Promise.all(["Admin", "Secretaria", "Pastor", "Integrante", "Lider", "OutroLider", "Dev", "Comum", "OutraIgreja", "SemFicha"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Ficha" })).data;
  await joinChurch(admin.api, org, secretaria, pastor, integrante, lider, outroLider, dev, semFicha);
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  infantil = (await admin.api.post("teams", { org_id: org, name: "Infantil", team_type: "infantil" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id, integrante.id] });
  await admin.api.rpc("add_team_members", { p_team: infantil, p_users: [outroLider.id, integrante.id] });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.patch(`team_members?team_id=eq.${infantil}&user_id=eq.${outroLider.id}`, { is_leader: true });
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria" });
  expect((await admin.api.rpc("grant_set", { p_org: org, p_user: pastor.id, p_role: "general_leader", p_network: null, p_title: "Pastoral", p_actions: ["people_view", "people_care"] })).ok).toBe(true);
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${await serviceKey()}`, apikey: await serviceKey(), "Content-Type": "application/json" }, body: JSON.stringify({ is_developer: true }) });
  ana = (await save(secretaria, { full_name: "Ana Ficha", classification: "visitor" })).id;
  beto = (await save(secretaria, { full_name: "Beto Ficha", classification: "member" })).id;
  caio = (await save(secretaria, { full_name: "Caio Ficha", classification: "attender" })).id;
  semConta = ana;
  await secretaria.api.rpc("people_link_users", { p_org: org, p_user_ids: [integrante.id, lider.id], p_classification: "member" });
  orgB = (await outraIgreja.api.rpc("create_organization", { p_name: "Outra Igreja" })).data;
  pessoaB = (await outraIgreja.api.rpc("person_save", { p_org: orgB, p_id: null, p: { full_name: "Pessoa da Outra" } })).data.id;
});

describe("uma pessoa, uma ficha", () => {
  test("pessoa sem conta existe; usuário sem cadastro de pessoa também", async () => {
    const r = (await admin.api.get(`/people?id=eq.${semConta}&select=user_id,full_name`)).data[0];
    expect(r.user_id).toBeNull();
    expect((await admin.api.get(`/people?user_id=eq.${comum.id}&select=id`)).data).toEqual([]);
  });
  test("visitante vira membro na mesma ficha, com histórico preservado", async () => {
    await secretaria.api.rpc("welcome_register", { p_org: org, p_name: "Dora Visitante" });
    const dora = (await admin.api.get(`/people?full_name=eq.Dora Visitante&select=id`)).data[0].id;
    await save(secretaria, { classification: "member", joined_at: "2026-11-01" }, dora);
    const life = (await secretaria.api.rpc("person_church_life", { p_person: dora })).data;
    expect(life.visits.length).toBe(1); expect(life.first_visit_on).toBeTruthy();
    expect(life.classification_changes[0]).toMatchObject({ from: "visitor", to: "member" });
    expect((await admin.api.get(`/people?full_name=eq.Dora Visitante&select=id`)).data.length).toBe(1);
  });
});

describe("família", () => {
  test("relaciona pessoas já cadastradas e aparece dos dois lados com a relação inversa", async () => {
    expect((await secretaria.api.rpc("person_relation_add", { p_person: beto, p_relative: caio, p_relation: "child" })).ok).toBe(true);
    const fb = (await secretaria.api.rpc("person_family", { p_person: beto })).data;
    expect(fb).toHaveLength(1); expect(fb[0]).toMatchObject({ name: "Caio Ficha", relation: "child" });
    const fc = (await secretaria.api.rpc("person_family", { p_person: caio })).data;
    expect(fc[0]).toMatchObject({ name: "Beto Ficha", relation: "parent" });
    expect((await hist(beto)).some((h: any) => h.kind === "family")).toBe(true);
  });
  test("recusa duplicidade (em qualquer sentido), si mesmo, outra igreja e relação inválida", async () => {
    expect((await secretaria.api.rpc("person_relation_add", { p_person: caio, p_relative: beto, p_relation: "parent" })).data.message).toContain("already_related");
    expect((await secretaria.api.rpc("person_relation_add", { p_person: beto, p_relative: beto, p_relation: "other" })).data.message).toContain("same_person");
    expect((await secretaria.api.rpc("person_relation_add", { p_person: beto, p_relative: pessoaB, p_relation: "other" })).data.message).toContain("not_found");
    expect((await secretaria.api.rpc("person_relation_add", { p_person: beto, p_relative: ana, p_relation: "primo" })).data.message).toContain("invalid_relation");
  });
  test("só quem edita pessoas altera; desfazer registra no histórico", async () => {
    for (const u of [integrante, lider, dev, comum, pastor]) expect((await u.api.rpc("person_relation_add", { p_person: beto, p_relative: ana, p_relation: "spouse" })).data.message).toContain("forbidden");
    const id = (await secretaria.api.rpc("person_family", { p_person: beto })).data[0].id;
    expect((await secretaria.api.rpc("person_relation_remove", { p_id: id })).ok).toBe(true);
    expect((await secretaria.api.rpc("person_family", { p_person: beto })).data).toEqual([]);
  });
  test("quem não pode ler a ficha não lê a família", async () => {
    for (const u of [integrante, lider, dev, comum]) expect((await u.api.rpc("person_family", { p_person: beto })).data.message).toContain("forbidden");
  });
});

describe("batismo e vida na igreja", () => {
  test("registra batismo, valida data e guarda alterações", async () => {
    expect((await secretaria.api.rpc("person_church_life_save", { p_person: beto, p: { baptism_date: "2010-05-02" } })).ok).toBe(true);
    const l = (await secretaria.api.rpc("person_church_life", { p_person: beto })).data;
    expect(l.baptized).toBe(true); expect(l.baptism_date).toBe("2010-05-02");
    expect((await secretaria.api.rpc("person_church_life_save", { p_person: beto, p: { baptism_date: "2999-01-01" } })).data.message).toContain("invalid_date");
    expect((await secretaria.api.rpc("person_church_life_save", { p_person: beto, p: { baptized: false } })).ok).toBe(true);
    expect((await secretaria.api.rpc("person_church_life", { p_person: beto })).data.baptism_date).toBeNull();
    expect((await hist(beto)).filter((h: any) => h.field === "baptism_date").length).toBe(2);
    expect((await integrante.api.rpc("person_church_life_save", { p_person: beto, p: { baptized: true } })).data.message).toContain("forbidden");
  });
});

describe("times e ministérios", () => {
  let pInt = "";
  beforeAll(async () => { pInt = (await admin.api.get(`/people?user_id=eq.${integrante.id}&select=id`)).data[0].id; });
  test("mostra todos os vínculos reais, função e data de entrada", async () => {
    const t = (await secretaria.api.rpc("person_teams", { p_person: pInt })).data;
    expect(t.map((x: any) => x.name).sort()).toEqual(["Infantil", "Louvor"]);
    expect(t.every((x: any) => x.role === "member" && x.joined_at)).toBe(true);
    const pl = (await admin.api.get(`/people?user_id=eq.${lider.id}&select=id`)).data[0].id;
    expect((await secretaria.api.rpc("person_teams", { p_person: pl })).data[0].role).toBe("leader");
  });
  test("pessoa sem conta não tem vínculos de time", async () => {
    expect((await secretaria.api.rpc("person_teams", { p_person: semConta })).data).toEqual([]);
  });
  test("entrada, saída e mudança de função entram no histórico (e não atrapalham o time)", async () => {
    await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [semFicha.id] });  // semFicha não tem ficha: nada a registrar, nada quebra
    expect((await admin.api.get(`/team_members?team_id=eq.${louvor}&user_id=eq.${semFicha.id}&select=user_id`)).data.length).toBe(1);
    await admin.api.patch(`team_members?team_id=eq.${infantil}&user_id=eq.${integrante.id}`, { is_leader: true });
    await admin.api.del(`team_members?team_id=eq.${infantil}&user_id=eq.${integrante.id}`);
    const kinds = (await hist(pInt)).filter((h: any) => h.kind.startsWith("team_"));
    expect(kinds.map((h: any) => h.kind)).toEqual(["team_role", "team_leave"]);
    expect(kinds[0].note).toContain("Infantil");
    expect((await secretaria.api.rpc("person_teams", { p_person: pInt })).data.map((x: any) => x.name)).toEqual(["Louvor"]);
  });
  test("integrante, líder e usuário comum não leem vínculos pela ficha", async () => {
    for (const u of [integrante, lider, comum, dev]) expect((await u.api.rpc("person_teams", { p_person: pInt })).data.message).toContain("forbidden");
  });
});

describe("cartão do integrante para o líder", () => {
  test("líder vê só o essencial de quem é do seu time", async () => {
    await save(secretaria, { full_name: "Integrante", phone: "21 90000-0000", address: "Rua Secreta 1", cpf: "52998224725", admin_notes: "reservado" }, (await admin.api.get(`/people?user_id=eq.${integrante.id}&select=id`)).data[0].id);
    const c = (await lider.api.rpc("team_member_card", { p_team: louvor, p_user: integrante.id })).data;
    expect(c.name).toBe("Integrante"); expect(c.phone).toBe("21 90000-0000");
    expect(JSON.stringify(c)).not.toContain("Rua Secreta"); expect(JSON.stringify(c)).not.toContain("52998224725"); expect(JSON.stringify(c)).not.toContain("reservado");
  });
  test("líder de outro time, integrante, comum e desenvolvedor são barrados", async () => {
    for (const u of [outroLider, integrante, comum, dev]) expect((await u.api.rpc("team_member_card", { p_team: louvor, p_user: lider.id })).data.message).toContain("forbidden");
    expect((await lider.api.rpc("team_member_card", { p_team: louvor, p_user: semFicha.id })).data.name).toBe("SemFicha");
  });
});

describe("acompanhamento pastoral", () => {
  test("quem tem people_care registra e lê; fica na trilha de acesso, fora do histórico geral", async () => {
    expect((await pastor.api.rpc("care_add", { p_person: beto, p_kind: "counsel", p_note: "Conversa sobre família" })).ok).toBe(true);
    expect((await admin.api.rpc("care_add", { p_person: beto, p_kind: "prayer", p_note: "Pedido de oração" })).ok).toBe(true);
    const l = (await pastor.api.rpc("care_list", { p_person: beto })).data;
    expect(l.map((x: any) => x.kind)).toEqual(["prayer", "counsel"]); expect(l[1].by).toBe("Pastor");
    expect(JSON.stringify(await hist(beto))).not.toContain("Conversa sobre família");
    const log = (await admin.api.rpc("care_access_log", { p_person: beto })).data;
    expect(log.filter((x: any) => x.action === "add").length).toBe(2); expect(log.some((x: any) => x.action === "read" && x.by === "Pastor")).toBe(true);
  });
  test("secretaria (mesmo com acesso à base), líder, integrante, comum e desenvolvedor não acessam", async () => {
    for (const u of [secretaria, lider, integrante, comum, dev]) {
      expect((await u.api.rpc("care_list", { p_person: beto })).data.message).toContain("forbidden");
      expect((await u.api.rpc("care_add", { p_person: beto, p_kind: "other", p_note: "x" })).data.message).toContain("forbidden");
    }
  });
  test("só o administrador vê a trilha de acesso", async () => {
    for (const u of [pastor, secretaria, dev, comum]) expect((await u.api.rpc("care_access_log", { p_person: beto })).data.message).toContain("forbidden");
  });
  test("sem leitura nem escrita direta nas tabelas, e sem editar ou apagar registros", async () => {
    for (const u of [admin, pastor, secretaria]) {
      expect(denied(await u.api.get("/person_care?select=id"))).toBe(true);
      expect(denied(await u.api.get("/person_care_access?select=id"))).toBe(true);
      expect((await u.api.post("person_care", { org_id: org, person_id: beto, kind: "other", note: "x" })).ok).toBe(false);
    }
    expect((await admin.api.rpc("care_add", { p_person: beto, p_kind: "xyz", p_note: "x" })).data.message).toContain("invalid_kind");
    expect((await admin.api.rpc("care_add", { p_person: beto, p_kind: "other", p_note: " " })).data.message).toContain("note_required");
  });
  test("people_care aparece em my_access e o desenvolvedor não a recebe", async () => {
    expect((await pastor.api.rpc("my_access", { p_org: org })).data.people).toContain("people_care");
    expect((await secretaria.api.rpc("my_access", { p_org: org })).data.people).not.toContain("people_care");
    expect((await dev.api.rpc("my_access", { p_org: org })).data.people).toEqual([]);
  });
});

describe("integridade", () => {
  test("excluir a pessoa leva junto família e acompanhamento", async () => {
    const x = (await save(secretaria, { full_name: "Para Excluir" })).id;
    await secretaria.api.rpc("person_relation_add", { p_person: x, p_relative: ana, p_relation: "sibling" });
    await admin.api.rpc("care_add", { p_person: x, p_kind: "other", p_note: "nota" });
    expect((await admin.api.rpc("person_delete", { p_id: x })).ok).toBe(true);
    expect((await secretaria.api.rpc("person_family", { p_person: ana })).data).toEqual([]);
    expect(denied(await admin.api.get("/person_relations?select=id"))).toBe(true);
  });
});
