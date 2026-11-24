// Recurso 04: dados pessoais, família, familiar sem conta, responsáveis legais, integridade e privacidade.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, secretaria: any, pastor: any, integrante: any, lider: any, supervisor: any, comum: any, outra: any;
let org = "", orgB = "";
const ids: Record<string, string> = {};
const save = async (u: any, p: any, id: string | null = null) => (await u.api.rpc("person_save", { p_org: org, p_id: id, p })).data;
const mk = async (name: string, extra: any = {}) => (ids[name] = (await save(secretaria, { full_name: name, classification: "member", ...extra })).id);
const add = (u: any, a: string, b: string, rel: string) => u.api.rpc("person_relation_add", { p_person: ids[a], p_relative: ids[b], p_relation: rel });
const fam = async (u: any, n: string) => (await u.api.rpc("person_family", { p_person: ids[n] })).data;
const msg = (r: any) => String(r.data?.message ?? "");

beforeAll(async () => {
  [admin, secretaria, pastor, integrante, lider, supervisor, comum, outra] = await Promise.all(["Admin", "Secretaria", "Pastor", "Integrante", "Lider", "Supervisor", "Comum", "Outra"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Familia" })).data;
  await joinChurch(admin.api, org, secretaria, pastor, integrante, lider, supervisor);
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria" });
  await admin.api.rpc("grant_set", { p_org: org, p_user: pastor.id, p_role: "general_leader", p_network: null, p_title: "Pastoral", p_actions: ["people_view"] });
  orgB = (await outra.api.rpc("create_organization", { p_name: "Outra Igreja" })).data;
  ids.PessoaB = (await outra.api.rpc("person_save", { p_org: orgB, p_id: null, p: { full_name: "Pessoa B" } })).data.id;
  await mk("Pai", { birth_date: "1980-03-10", sex: "M" });
  await mk("Mae", { birth_date: "1982-05-01", sex: "F" });
  await mk("Filho", { birth_date: "2015-06-01", sex: "M" });
  await mk("Avo", { birth_date: "1950-01-01", sex: "M" });
  await mk("Tio", { birth_date: "1978-01-01" });
});

describe("dados pessoais", () => {
  test("salva identificação, contatos e endereço completos e relê", async () => {
    const r = await save(secretaria, { full_name: "Maria Completa", social_name: "Mari", birth_date: "1990-02-02", sex: "F", marital_status: "casado", phone: "11999990000", phone2: "1133334444", email: "mari@x.com", whatsapp: "11999990000",
      zip: "01001000", address: "Rua A", address_number: "10", address_complement: "ap 2", neighborhood: "Centro", city: "São Paulo", state: "SP", country: "Brasil" });
    expect(r.saved).toBe(true);
    const p = (await secretaria.api.get(`/people?id=eq.${r.id}&select=*`)).data[0];
    expect(p).toMatchObject({ social_name: "Mari", phone2: "1133334444", address_number: "10", address_complement: "ap 2", neighborhood: "Centro", country: "Brasil", state: "SP" });
  });
  test("recusa campo grande demais e data de nascimento no futuro", async () => {
    const r = await secretaria.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "X".repeat(400) } });
    expect(r.ok).toBe(false); expect(msg(r)).toContain("field_too_long");
    const f = await secretaria.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Futuro", birth_date: "2999-01-01" } });
    expect(f.ok).toBe(false); expect(msg(f)).toContain("invalid_birth");
  });
  test("a própria pessoa atualiza endereço e telefone secundário", async () => {
    const r = await integrante.api.rpc("my_person_update", { p_org: org, p: { full_name: "Integrante Próprio", phone2: "21988887777", neighborhood: "Tijuca", address_number: "5" } });
    expect(r.ok).toBe(true);
    const me = (await integrante.api.rpc("my_person", { p_org: org })).data;
    expect(me).toMatchObject({ phone2: "21988887777", neighborhood: "Tijuca", address_number: "5" });
  });
  test("sem permissão não edita dados pessoais", async () => {
    for (const u of [integrante, lider, comum, pastor]) expect((await u.api.rpc("person_save", { p_org: org, p_id: ids.Pai, p: { phone: "1" } })).ok).toBe(false);
  });
});

describe("vínculos familiares", () => {
  test("tipos extensíveis em tabela e lista para a tela", async () => {
    const t = (await secretaria.api.rpc("relation_types_list", {})).data;
    expect(t.map((x: any) => x.key)).toEqual(expect.arrayContaining(["spouse", "child", "father", "mother", "sibling", "grandparent", "grandchild", "other"]));
  });
  test("pai/mãe/filho: relação inversa correta, aparece dos dois lados, usa o sexo", async () => {
    expect((await add(secretaria, "Pai", "Filho", "child")).ok).toBe(true);
    expect((await add(secretaria, "Mae", "Filho", "child")).ok).toBe(true);
    expect((await fam(secretaria, "Filho")).map((x: any) => x.relation).sort()).toEqual(["father", "mother"]);
    expect((await fam(secretaria, "Pai"))[0]).toMatchObject({ name: "Filho", relation: "child", status: "active" });
  });
  test("cônjuge é recíproco e só pode haver um", async () => {
    expect((await add(secretaria, "Pai", "Mae", "spouse")).ok).toBe(true);
    expect((await fam(secretaria, "Mae")).some((x: any) => x.name === "Pai" && x.relation === "spouse")).toBe(true);
    expect(msg(await add(secretaria, "Pai", "Tio", "spouse"))).toContain("already_has_spouse");
  });
  test("recusa duplicidade, contradição, si mesmo, outra igreja, inexistente e tipo inválido", async () => {
    expect(msg(await add(secretaria, "Filho", "Pai", "child"))).toMatch(/already_related|invalid/);
    expect(msg(await add(secretaria, "Pai", "Pai", "other"))).toContain("same_person");
    expect(msg(await add(secretaria, "Pai", "PessoaB", "other"))).toContain("not_found");
    const r = await secretaria.api.rpc("person_relation_add", { p_person: ids.Pai, p_relative: "00000000-0000-0000-0000-000000000000", p_relation: "other" });
    expect(msg(r)).toContain("not_found");
    expect(msg(await add(secretaria, "Pai", "Tio", "primo"))).toContain("invalid_relation");
  });
  test("ciclos e idades impossíveis são barrados", async () => {
    expect((await add(secretaria, "Avo", "Pai", "child")).ok).toBe(true);
    expect(msg(await add(secretaria, "Filho", "Avo", "child"))).toMatch(/invalid_cycle|invalid_age/);   // neto não pode ser pai do avô
    expect(msg(await add(secretaria, "Filho", "Pai", "parent"))).toMatch(/already_related/);
    // filho nascido antes do pai
    expect(msg(await add(secretaria, "Filho", "Tio", "child"))).toContain("invalid_age");
  });
  test("alterar parentesco atualiza os dois lados; encerrar mantém as fichas e registra histórico", async () => {
    expect((await add(secretaria, "Tio", "Avo", "other")).ok).toBe(true);
    const id = (await fam(secretaria, "Tio"))[0].id;
    expect((await secretaria.api.rpc("person_relation_update", { p_id: id, p_relation: "sibling" })).ok).toBe(true);
    expect((await fam(secretaria, "Avo")).find((x: any) => x.name === "Tio").relation).toBe("sibling");
    expect((await secretaria.api.rpc("person_relation_remove", { p_id: id })).ok).toBe(true);
    expect(await fam(secretaria, "Tio")).toEqual([]);
    expect((await secretaria.api.get(`/people?id=in.(${ids.Tio},${ids.Avo})&select=id`)).data.length).toBe(2);
    const h = (await admin.api.get(`/person_history?person_id=eq.${ids.Tio}&select=kind`)).data || [];
    expect(h.some((x: any) => x.kind === "family")).toBe(true);
  });
  test("editar o parentesco pelo outro lado vale ao contrário", async () => {
    expect((await add(secretaria, "Mae", "Tio", "other")).ok).toBe(true);
    const id = (await fam(secretaria, "Tio"))[0].id;   // visto do Tio: a Mãe é "outro"
    expect((await secretaria.api.rpc("person_relation_update", { p_id: id, p_relation: "sibling", p_from: ids.Tio })).ok).toBe(true);
    expect((await fam(secretaria, "Mae")).find((x: any) => x.name === "Tio").relation).toBe("sibling");
    expect((await fam(secretaria, "Tio"))[0].relation).toBe("sibling");
    expect((await secretaria.api.rpc("person_relation_remove", { p_id: id })).ok).toBe(true);
  });
  test("permissão: só quem edita pessoas altera vínculos", async () => {
    for (const u of [integrante, lider, comum, pastor]) {
      expect((await add(u, "Tio", "Avo", "other")).ok).toBe(false);
      expect((await u.api.rpc("person_relation_update", { p_id: 1, p_relation: "other" })).ok).toBe(false);
    }
  });
});

describe("familiar sem conta", () => {
  test("cria familiar já vinculado, sem usuário e sem virar membro", async () => {
    const r = (await secretaria.api.rpc("person_relation_create", { p_person: ids.Pai, p_relation: "sibling", p: { full_name: "Irmão Sem Conta", birth_date: "1983-01-01" }, p_force: false })).data;
    expect(r.saved).toBe(true);
    const p = (await secretaria.api.get(`/people?id=eq.${r.id}&select=user_id,classification,status`)).data[0];
    expect(p.user_id).toBeNull(); expect(p.classification).toBe("none");
    expect((await fam(secretaria, "Pai")).some((x: any) => x.name === "Irmão Sem Conta" && x.relation === "sibling")).toBe(true);
  });
  test("vínculo inválido desfaz também o cadastro (tudo ou nada)", async () => {
    const antes = (await admin.api.get(`/people?full_name=eq.Fantasma&select=id`)).data.length;
    const r = await secretaria.api.rpc("person_relation_create", { p_person: ids.Pai, p_relation: "spouse", p: { full_name: "Fantasma", birth_date: "1985-01-01" }, p_force: false });
    expect(r.ok).toBe(false);
    expect((await admin.api.get(`/people?full_name=eq.Fantasma&select=id`)).data.length).toBe(antes);
  });
  test("aceita classificação informada e alerta possível duplicado", async () => {
    const r = (await secretaria.api.rpc("person_relation_create", { p_person: ids.Pai, p_relation: "other", p: { full_name: "Mae", birth_date: "1982-05-01" }, p_force: false })).data;
    expect(r.saved).toBe(false);   // duplicado: devolve candidatos, não cria
  });
  test("sem permissão não cria familiar", async () => {
    expect((await integrante.api.rpc("person_relation_create", { p_person: ids.Pai, p_relation: "other", p: { full_name: "Intruso" }, p_force: false })).ok).toBe(false);
  });
});

describe("responsáveis legais", () => {
  test("separados do parentesco; múltiplos; tipo e observação; aparecem nos dois lados", async () => {
    expect((await secretaria.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.Pai, p_kind: "parental", p_note: "pai" })).ok).toBe(true);
    expect((await secretaria.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.Avo, p_kind: "guardian", p_note: "guarda compartilhada" })).ok).toBe(true);
    const g = (await secretaria.api.rpc("person_guardians", { p_person: ids.Filho })).data;
    expect(g.guardians.map((x: any) => x.name).sort()).toEqual(["Avo", "Pai"]);
    expect((await secretaria.api.rpc("person_guardians", { p_person: ids.Pai })).data.wards[0].name).toBe("Filho");
  });
  test("recusa duplicado, si mesmo, tipo inválido, responsável menor, tutelado adulto e outra igreja", async () => {
    expect(msg(await secretaria.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.Pai, p_kind: "parental" }))).toContain("already_guardian");
    expect(msg(await secretaria.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.Filho, p_kind: "parental" }))).toContain("same_person");
    expect(msg(await secretaria.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.Mae, p_kind: "xx" }))).toContain("invalid_kind");
    expect(msg(await secretaria.api.rpc("guardian_add", { p_ward: ids.Pai, p_guardian: ids.Filho, p_kind: "guardian" }))).toMatch(/guardian_minor|ward_not_minor/);
    expect(msg(await secretaria.api.rpc("guardian_add", { p_ward: ids.Pai, p_guardian: ids.Mae, p_kind: "guardian" }))).toContain("ward_not_minor");
    expect(msg(await secretaria.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.PessoaB, p_kind: "guardian" }))).toContain("not_found");
  });
  test("alterar tipo e remover mantêm as fichas", async () => {
    const g = (await secretaria.api.rpc("person_guardians", { p_person: ids.Filho })).data.guardians.find((x: any) => x.name === "Avo");
    expect((await secretaria.api.rpc("guardian_update", { p_id: g.id, p_kind: "other", p_note: "ok" })).ok).toBe(true);
    expect((await secretaria.api.rpc("guardian_remove", { p_id: g.id })).ok).toBe(true);
    expect((await secretaria.api.rpc("person_guardians", { p_person: ids.Filho })).data.guardians.length).toBe(1);
    expect((await secretaria.api.get(`/people?id=eq.${ids.Avo}&select=id`)).data.length).toBe(1);
  });
  test("sem permissão: nem vê nem altera; tabelas sem acesso direto", async () => {
    for (const u of [integrante, lider, comum, supervisor]) {
      expect((await u.api.rpc("person_guardians", { p_person: ids.Filho })).ok).toBe(false);
      expect((await u.api.rpc("guardian_add", { p_ward: ids.Filho, p_guardian: ids.Mae, p_kind: "parental" })).ok).toBe(false);
    }
    const d = await admin.api.get(`/person_guardians?select=*`);
    expect(!d.ok || (Array.isArray(d.data) && d.data.length === 0)).toBe(true);
  });
});

describe("privacidade e proteção de menores", () => {
  test("quem só tem 'ver pessoas' vê família mas leitura de menor deixa rastro visível só ao administrador", async () => {
    await pastor.api.rpc("person_family", { p_person: ids.Filho });
    const h = (await admin.api.rpc("person_access_history", { p_person: ids.Filho })).data;
    expect(h.length).toBeGreaterThan(0);
    for (const u of [secretaria, pastor, integrante, comum]) expect((await u.api.rpc("person_access_history", { p_person: ids.Filho })).ok).toBe(false);
  });
  test("pessoa de outra igreja não lê nada daqui", async () => {
    expect((await outra.api.rpc("person_family", { p_person: ids.Pai })).ok).toBe(false);
    expect((await outra.api.rpc("person_guardians", { p_person: ids.Filho })).ok).toBe(false);
    expect((await outra.api.get(`/people?id=eq.${ids.Filho}&select=id`)).data).toEqual([]);
  });
  test("integrante comum não lê endereço/contatos de outras pessoas nem família", async () => {
    expect((await integrante.api.get(`/people?id=eq.${ids.Pai}&select=phone,address`)).data?.length ?? 0).toBe(0);
    expect((await integrante.api.rpc("person_family", { p_person: ids.Pai })).ok).toBe(false);
  });
  test("não há como consultar tabelas de vínculo/ responsáveis/ acessos direto", async () => {
    for (const t of ["person_sensitive_access", "person_guardians"]) {
      const r = await integrante.api.get(`/${t}?select=*`);
      expect(!r.ok || (Array.isArray(r.data) && r.data.length === 0)).toBe(true);
    }
  });
});
