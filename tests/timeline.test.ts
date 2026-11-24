// Recurso 05: Linha do Tempo individual (histórico geral, registros manuais, correção rastreável, filtros, permissões e separação do pastoral).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, secretaria: any, pastor: any, integrante: any, lider: any, supervisor: any, dev: any, comum: any, outra: any, apenasAdd: any;
let org = "", louvor = "", rede = "", ana = "", beto = "", menor = "", pessoaB = "";
const save = async (u: any, p: any, id: string | null = null) => (await u.api.rpc("person_save", { p_org: org, p_id: id, p })).data;
const tl = async (u: any, id: string, f: any = {}) => await u.api.rpc("person_timeline", { p_person: id, p_categories: null, p_origin: null, p_from: null, p_to: null, p_by: null, p_limit: 50, p_offset: 0, ...f });
const items = async (u: any, id: string, f: any = {}) => (await tl(u, id, f)).data.items as any[];
const msg = (r: any) => String(r.data?.message ?? "");
const add = (u: any, id: string, o: any = {}) => u.api.rpc("timeline_add", { p_person: id, p_category: "integracao", p_title: "Participou do culto de integração", p_description: null, p_occurred_on: null, p_notes: null, p_key: null, ...o });

beforeAll(async () => {
  [admin, secretaria, pastor, integrante, lider, supervisor, dev, comum, outra, apenasAdd] = await Promise.all(["Admin", "Secretaria", "Pastor", "Integrante", "Lider", "Supervisor", "Dev", "Comum", "Outra", "ApenasAdd"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Linha" })).data;
  await joinChurch(admin.api, org, secretaria, pastor, integrante, lider, supervisor, dev, apenasAdd);
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  rede = (await admin.api.rpc("network_save", { p_org: org, p_id: null, p_name: "Rede A", p_teams: [louvor] })).data;
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria" });
  await admin.api.rpc("grant_set", { p_org: org, p_user: pastor.id, p_role: "general_leader", p_network: null, p_title: "Pastoral", p_actions: ["people_view", "people_care"] });
  await admin.api.rpc("grant_set", { p_org: org, p_user: supervisor.id, p_role: "network_supervisor", p_network: rede, p_title: "Supervisor", p_actions: ["view", "people_view"] });
  await admin.api.rpc("grant_set", { p_org: org, p_user: apenasAdd.id, p_role: "general_leader", p_network: null, p_title: "Registrador", p_actions: ["people_view", "people_timeline_add"] });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${await serviceKey()}`, apikey: await serviceKey(), "Content-Type": "application/json" }, body: JSON.stringify({ is_developer: true }) });
  ana = (await save(secretaria, { full_name: "Ana Linha", classification: "visitor", phone: "11911112222" })).id;
  beto = (await save(secretaria, { full_name: "Beto Linha", classification: "member" })).id;
  menor = (await save(secretaria, { full_name: "Menor Linha", classification: "attender", birth_date: "2016-01-01" })).id;
  await secretaria.api.rpc("people_link_users", { p_org: org, p_user_ids: [lider.id], p_classification: "member" });
  const o = (await outra.api.rpc("create_organization", { p_name: "Outra" })).data;
  pessoaB = (await outra.api.rpc("person_save", { p_org: o, p_id: null, p: { full_name: "Pessoa B" } })).data.id;
});

describe("abertura e registros automáticos", () => {
  test("abre a linha do tempo e já traz a criação da ficha, automática e com responsável", async () => {
    const r = await tl(secretaria, ana);
    expect(r.ok).toBe(true);
    const it = r.data.items.find((x: any) => x.title === "Cadastro inicial como visitante");
    expect(it).toMatchObject({ origin: "manual" === it.origin ? "manual" : "auto", category: "cadastro", by: expect.any(String) });
    expect(it.origin).toBe("auto");
    expect(it.by).not.toBe("Sistema");
  });
  test("mudança de classificação vira acontecimento legível, na mesma ficha", async () => {
    await save(secretaria, { classification: "attender" }, ana);
    await save(secretaria, { classification: "member" }, ana);
    const t = (await items(secretaria, ana)).map((x: any) => x.title);
    expect(t).toContain("Passou de Visitante a Frequentador");
    expect(t).toContain("Passou de Frequentador a Membro");
  });
  test("inativar e reativar", async () => {
    await save(secretaria, { status: "inactive" }, ana); await save(secretaria, { status: "active" }, ana);
    const t = (await items(secretaria, ana)).map((x: any) => x.title);
    expect(t).toContain("Cadastro inativado"); expect(t).toContain("Cadastro reativado");
  });
  test("várias alterações de dados na mesma operação viram um só acontecimento agrupado", async () => {
    await save(secretaria, { phone: "11988887777", city: "Santos", neighborhood: "Gonzaga" }, ana);
    const g = (await items(secretaria, ana)).filter((x: any) => x.category === "pessoais");
    expect(g.length).toBe(1);
    expect(g[0].changes.length).toBeGreaterThanOrEqual(3);
    expect(g[0].description).toContain("Telefone");
  });
  test("entrada, liderança e saída de times entram na linha do tempo", async () => {
    const p = (await admin.api.get(`/people?user_id=eq.${lider.id}&select=id`)).data[0].id;
    await admin.api.del(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`);   // a ficha só existe depois do vínculo: recomeça do zero
    await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id] });
    await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: true });
    const t = (await items(secretaria, p)).map((x: any) => x.title);
    expect(t).toContain("Entrou em Louvor");
    expect(t).toContain("Nomeado(a) líder de Louvor");
    await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: false });
    await admin.api.del(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`);
    const t2 = (await items(secretaria, p)).map((x: any) => x.title);
    expect(t2).toContain("Deixou a liderança de Louvor"); expect(t2).toContain("Saiu de Louvor");
  });
  test("o time Louvor continua funcionando (entrar de novo)", async () => {
    expect((await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id] })).ok).toBe(true);
  });
  test("o mesmo evento repetido não duplica (chave de operação)", async () => {
    const a = (await add(secretaria, beto, { p_key: "k-123", p_title: "Culto de integração" })).data;
    const b = (await add(secretaria, beto, { p_key: "k-123", p_title: "Culto de integração" })).data;
    expect(b).toBe(a);
    expect((await items(secretaria, beto)).filter((x: any) => x.title === "Culto de integração").length).toBe(1);
  });
});

describe("registros manuais", () => {
  test("cria acontecimento manual: responsável é o usuário logado, origem manual", async () => {
    const id = (await add(secretaria, beto, { p_category: "formacao", p_title: "Curso de discipulado", p_description: "Concluiu a turma 3", p_notes: "Certificado entregue" })).data;
    const it = (await items(secretaria, beto)).find((x: any) => x.id === id);
    expect(it).toMatchObject({ origin: "manual", category: "formacao", title: "Curso de discipulado", notes: "Certificado entregue", edited: false });
  });
  test("retroativo: data do fato diferente da data do registro", async () => {
    const id = (await add(secretaria, beto, { p_category: "batismo", p_title: "Batizado em outra igreja", p_occurred_on: "2010-05-09" })).data;
    const it = (await items(secretaria, beto)).find((x: any) => x.id === id);
    expect(it.occurred_on).toBe("2010-05-09");
    expect(it.at.slice(0, 10)).not.toBe("2010-05-09");
  });
  test("recusa data futura, título vazio, categoria inválida/automática e texto grande", async () => {
    expect(msg(await add(secretaria, beto, { p_occurred_on: "2999-01-01" }))).toContain("invalid_date");
    expect(msg(await add(secretaria, beto, { p_title: " " }))).toContain("invalid_title");
    expect(msg(await add(secretaria, beto, { p_category: "familia" }))).toContain("invalid_category");
    expect(msg(await add(secretaria, beto, { p_category: "inexistente" }))).toContain("invalid_category");
    expect(msg(await add(secretaria, beto, { p_description: "x".repeat(1100) }))).toContain("text_too_long");
  });
  test("não há como informar outro responsável nem escrever direto na tabela", async () => {
    const r = await secretaria.api.post("person_history", { org_id: org, person_id: beto, kind: "manual", actor: admin.id });
    expect(r.ok).toBe(false);
    const u = await admin.api.patch(`person_history?person_id=eq.${beto}`, { title: "adulterado" });
    expect(u.ok === false || (Array.isArray(u.data) && u.data.length === 0)).toBe(true);
  });
  test("só quem tem permissão adiciona (integrante, líder, comum, supervisor, só-leitura, desenvolvedor)", async () => {
    for (const u of [integrante, lider, comum, supervisor, pastor, dev]) expect((await add(u, beto)).ok).toBe(false);
    expect((await add(apenasAdd, beto, { p_title: "Registrado pela permissão própria" })).ok).toBe(true);
  });
});

describe("proteção e correção", () => {
  test("registro automático não pode ser corrigido nem anulado por ninguém", async () => {
    const auto = (await items(secretaria, ana)).find((x: any) => x.origin === "auto");
    for (const u of [secretaria, admin]) {
      expect(msg(await u.api.rpc("timeline_correct", { p_id: auto.id, p_title: "Mudei", p_description: null, p_occurred_on: null, p_notes: null, p_category: null, p_reason: null }))).toContain("auto_protected");
      expect(msg(await u.api.rpc("timeline_void", { p_id: auto.id, p_reason: "esconder" }))).toContain("auto_protected");
    }
  });
  test("correção de manual guarda o valor anterior, marca como editado e aparece na auditoria do administrador", async () => {
    const id = (await add(secretaria, beto, { p_title: "Titulo errado", p_category: "outros" })).data;
    expect((await secretaria.api.rpc("timeline_correct", { p_id: id, p_title: "Título certo", p_description: "detalhe", p_occurred_on: "2020-01-01", p_notes: null, p_category: null, p_reason: "erro de digitação" })).ok).toBe(true);
    const it = (await items(secretaria, beto)).find((x: any) => x.id === id);
    expect(it).toMatchObject({ title: "Título certo", edited: true, occurred_on: "2020-01-01" });
    const a = (await admin.api.rpc("timeline_audit", { p_person: beto })).data;
    const e = a.find((x: any) => x.before.title === "Titulo errado");
    expect(e).toMatchObject({ action: "edit", reason: "erro de digitação" });
    for (const u of [secretaria, pastor, supervisor, integrante]) expect((await u.api.rpc("timeline_audit", { p_person: beto })).ok).toBe(false);
  });
  test("anular exige motivo, some da linha do tempo mas fica na auditoria", async () => {
    const id = (await add(secretaria, beto, { p_title: "Lançado por engano" })).data;
    expect(msg(await secretaria.api.rpc("timeline_void", { p_id: id, p_reason: "" }))).toContain("reason_required");
    expect((await secretaria.api.rpc("timeline_void", { p_id: id, p_reason: "pessoa errada" })).ok).toBe(true);
    expect((await items(secretaria, beto)).some((x: any) => x.id === id)).toBe(false);
    const a = (await admin.api.rpc("timeline_audit", { p_person: beto })).data;
    expect(a.some((x: any) => x.action === "void" && x.reason === "pessoa errada")).toBe(true);
    expect(msg(await secretaria.api.rpc("timeline_correct", { p_id: id, p_title: "Voltou", p_description: null, p_occurred_on: null, p_notes: null, p_category: null, p_reason: null }))).toContain("voided");
  });
  test("quem só adiciona não corrige; integrante e líder não corrigem", async () => {
    const id = (await add(secretaria, beto, { p_title: "Para tentar corrigir" })).data;
    for (const u of [apenasAdd, integrante, lider, comum]) expect((await u.api.rpc("timeline_correct", { p_id: id, p_title: "x", p_description: null, p_occurred_on: null, p_notes: null, p_category: null, p_reason: null })).ok).toBe(false);
  });
});

describe("filtros e paginação", () => {
  test("filtra por categoria, origem, período e responsável", async () => {
    const f = await items(secretaria, beto, { p_categories: ["formacao"] });
    expect(f.length).toBeGreaterThan(0); expect(f.every((x: any) => x.category === "formacao")).toBe(true);
    expect((await items(secretaria, beto, { p_origin: "manual" })).every((x: any) => x.origin === "manual")).toBe(true);
    expect((await items(secretaria, beto, { p_origin: "auto" })).every((x: any) => x.origin === "auto")).toBe(true);
    const per = await items(secretaria, beto, { p_from: "2010-01-01", p_to: "2010-12-31" });
    expect(per.length).toBe(1); expect(per[0].title).toBe("Batizado em outra igreja");
    const by = await items(secretaria, beto, { p_by: secretaria.id });
    expect(by.every((x: any) => x.by_id === secretaria.id)).toBe(true);
    expect((await tl(secretaria, beto, { p_origin: "xx" })).ok).toBe(false);
  });
  test("ordem: acontecimento mais recente primeiro e paginação", async () => {
    const all = await items(secretaria, beto);
    const dates = all.map((x: any) => x.occurred_on); expect([...dates].sort().reverse()).toEqual(dates);
    const p1 = (await tl(secretaria, beto, { p_limit: 2, p_offset: 0 })).data, p2 = (await tl(secretaria, beto, { p_limit: 2, p_offset: 2 })).data;
    expect(p1.items.length).toBe(2); expect(p1.has_more).toBe(true);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
  });
  test("categorias: lista com as do sistema; administrador cria e desativa; outros não", async () => {
    const l = (await secretaria.api.rpc("history_categories_list", { p_org: org })).data;
    expect(l.map((c: any) => c.key)).toEqual(expect.arrayContaining(["acolhimento", "participacao", "batismo", "membresia", "integracao", "ministerio", "formacao", "outros"]));
    const k = (await admin.api.rpc("history_category_save", { p_org: org, p_key: null, p_label: "Viagem missionária", p_active: true })).data;
    expect(k).toMatch(/^c_/);
    expect((await add(secretaria, beto, { p_category: k, p_title: "Missão em Angola" })).ok).toBe(true);
    expect((await admin.api.rpc("history_category_save", { p_org: org, p_key: k, p_label: "Viagem missionária", p_active: false })).ok).toBe(true);
    expect(msg(await add(secretaria, beto, { p_category: k }))).toContain("invalid_category");
    expect(msg(await admin.api.rpc("history_category_save", { p_org: org, p_key: null, p_label: "Batismo", p_active: true }))).toContain("already_exists");
    for (const u of [secretaria, pastor, integrante]) expect((await u.api.rpc("history_category_save", { p_org: org, p_key: null, p_label: "Outra nova", p_active: true })).ok).toBe(false);
  });
});

describe("separação pastoral, família restrita e permissões", () => {
  test("anotações pastorais nunca aparecem na linha do tempo, mas continuam no acompanhamento", async () => {
    expect((await pastor.api.rpc("care_add", { p_person: beto, p_kind: "counsel", p_note: "SEGREDO-PASTORAL-XYZ" })).ok).toBe(true);
    for (const u of [admin, secretaria, pastor]) expect(JSON.stringify(await items(u, beto))).not.toContain("SEGREDO-PASTORAL-XYZ");
    expect((await pastor.api.rpc("care_list", { p_person: beto })).data[0].note).toContain("SEGREDO-PASTORAL-XYZ");
    expect((await secretaria.api.rpc("care_list", { p_person: beto })).ok).toBe(false);
  });
  test("vida familiar aparece como acontecimento restrito: sem detalhes para quem só consulta", async () => {
    await secretaria.api.rpc("person_relation_add", { p_person: beto, p_relative: ana, p_relation: "other" });
    const comDetalhe = (await items(secretaria, beto)).find((x: any) => x.category === "familia");
    expect(comDetalhe.title).toBe("Vínculo familiar incluído"); expect(comDetalhe.description).toContain("Ana Linha");
    const sem = (await items(pastor, beto)).find((x: any) => x.category === "familia");
    expect(sem.title).toBe("Vida familiar atualizada"); expect(sem.description).toBeNull(); expect(sem.restricted).toBe(true);
  });
  test("consulta direta à tabela não vaza registros restritos a quem só tem 'ver pessoas'", async () => {
    const r = (await pastor.api.get(`/person_history?person_id=eq.${beto}&select=kind`)).data || [];
    expect(r.some((x: any) => x.kind === "family")).toBe(false);
  });
  test("integrante, líder de time, comum e desenvolvedor não leem a linha do tempo de ninguém", async () => {
    for (const u of [integrante, lider, comum, dev]) { expect((await tl(u, beto)).ok).toBe(false); expect((await tl(u, ana)).ok).toBe(false); }
  });
  test("supervisor só vê pessoas da sua rede e nunca menores nem registros restritos", async () => {
    const pl = (await admin.api.get(`/people?user_id=eq.${lider.id}&select=id`)).data[0].id;
    expect((await tl(supervisor, pl)).ok).toBe(true);
    expect((await items(supervisor, pl)).every((x: any) => !x.restricted && x.category !== "familia")).toBe(true);
    expect((await tl(supervisor, beto)).ok).toBe(false);   // fora da rede
    expect((await tl(supervisor, menor)).ok).toBe(false);
  });
  test("liderança geral e secretaria leem; outra igreja não lê nada", async () => {
    for (const u of [admin, secretaria, pastor]) expect((await tl(u, beto)).ok).toBe(true);
    expect((await tl(outra, beto)).ok).toBe(false); expect((await tl(admin, pessoaB)).ok).toBe(false);
    expect((await outra.api.rpc("history_categories_list", { p_org: org })).ok).toBe(false);
  });
  test("o desenvolvedor mantém o perfil técnico: ainda é desenvolvedor e não ganhou acesso a dados", async () => {
    const p = (await dev.api.get(`/profiles?id=eq.${dev.id}&select=is_developer`)).data[0];
    expect(p.is_developer).toBe(true);
    expect((await dev.api.get(`/person_history?select=id&limit=1`)).data?.length ?? 0).toBe(0);
  });
});

describe("preservação dos registros existentes", () => {
  test("registros criados antes da migração ganharam categoria e data do fato (nenhum ficou sem)", async () => {
    const r = (await admin.api.get(`/person_history?org_id=eq.${org}&category=is.null&select=id`)).data || [];
    expect(r.length).toBe(0);
    const o = (await admin.api.get(`/person_history?org_id=eq.${org}&occurred_on=is.null&select=id`)).data || [];
    expect(o.length).toBe(0);
  });
  test("excluir a pessoa continua apagando sua trilha e correções junto (LGPD)", async () => {
    const x = (await save(secretaria, { full_name: "Para Excluir" })).id;
    const id = (await add(secretaria, x, { p_title: "Algo" })).data;
    await secretaria.api.rpc("timeline_correct", { p_id: id, p_title: "Algo 2", p_description: null, p_occurred_on: null, p_notes: null, p_category: null, p_reason: null });
    expect((await secretaria.api.rpc("person_delete", { p_id: x })).ok).toBe(true);
    const sk = await serviceKey();
    const rows = await (await fetch(`${REST}/person_history?person_id=eq.${x}&select=id`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json();
    expect(rows).toEqual([]);
  });
});
