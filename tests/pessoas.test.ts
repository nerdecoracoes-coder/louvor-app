// Cadastro de pessoas: permissões, classificação com histórico, formulário público, vínculo de usuários e importação.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, anonKey, Api, REST } from "./helpers";

let admin: any, secretaria: any, lider: any, integrante: any, supervisor: any, geral: any, dev: any, comum: any;
let org = "", louvor = "", outroTime = "", rede = "", token = "";
let anon: Api;

const list = async (u: any, args: any = {}) => (await u.api.rpc("people_list", { p_org: org, ...args }));
const CPF = "529.982.247-25"; // válido

beforeAll(async () => {
  [admin, secretaria, lider, integrante, supervisor, geral, dev, comum] = await Promise.all(["Admin", "Secretaria", "Lider", "Integrante", "Supervisor", "Geral", "Dev", "Comum"].map(newUser));
  anon = new Api(await anonKey());
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Pessoas" })).data;
  await joinChurch(admin.api, org, secretaria, lider, integrante, supervisor, geral, dev, comum);
  const mk = async (name: string, type: string) => (await admin.api.post("teams", { org_id: org, name, team_type: type })).data[0].id;
  louvor = await mk("Louvor", "louvor"); outroTime = await mk("Infantil", "infantil");
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id, integrante.id] });
  await admin.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${lider.id}`, { is_leader: true });
  rede = (await admin.api.rpc("network_save", { p_org: org, p_id: null, p_name: "Rede A", p_teams: [louvor] })).data;
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria" });
  await admin.api.rpc("grant_set", { p_org: org, p_user: supervisor.id, p_role: "network_supervisor", p_network: rede, p_title: "Pastor", p_actions: ["view", "people_view"] });
  await admin.api.rpc("grant_set", { p_org: org, p_user: geral.id, p_role: "general_leader", p_network: null, p_title: "Pastor presidente" });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${await serviceKey()}`, apikey: await serviceKey(), "Content-Type": "application/json" }, body: JSON.stringify({ is_developer: true }) });
});

describe("permissões do módulo", () => {
  test("administrador e secretaria cadastram; líder, integrante, comum e desenvolvedor não", async () => {
    const r = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Maria da Silva", classification: "member", email: "maria@teste.com", birth_date: "1990-05-10" } });
    expect(r.data.saved).toBe(true);
    const s = await secretaria.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "José Santos", classification: "attender" } });
    expect(s.data.saved).toBe(true);
    for (const u of [lider, integrante, comum, dev, geral]) {
      const x = await u.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Intruso" } });
      expect(x.ok).toBe(false);
    }
  });
  test("só quem tem people_view enxerga a base; líder e desenvolvedor não leem nada", async () => {
    expect((await list(admin)).data.total).toBeGreaterThanOrEqual(2);
    expect((await list(secretaria)).data.total).toBeGreaterThanOrEqual(2);
    for (const u of [lider, integrante, comum, dev, geral]) {
      expect((await u.api.get(`/people?org_id=eq.${org}`)).data).toEqual([]);
      expect((await list(u)).data.total).toBe(0);
    }
    expect((await dev.api.get(`/person_history?org_id=eq.${org}`)).data).toEqual([]);
  });
  test("ninguém escreve direto na tabela", async () => {
    const id = (await admin.api.get(`/people?org_id=eq.${org}&limit=1`)).data[0].id;
    for (const u of [admin, secretaria, lider]) {
      expect((await u.api.post("people", { org_id: org, full_name: "direto" })).ok).toBe(false);
      await u.api.patch(`people?id=eq.${id}`, { full_name: "alterado" });
      await u.api.del(`people?id=eq.${id}`);
    }
    expect((await admin.api.get(`/people?id=eq.${id}`)).data[0].full_name).not.toBe("alterado");
  });
  test("secretaria não repassa mais do que tem; liderança geral sem people_* não vê a base", async () => {
    const r = await secretaria.api.rpc("grant_set", { p_org: org, p_user: comum.id, p_role: "secretary", p_network: null, p_title: "x" });
    expect(r.ok).toBe(false);
    expect((await geral.api.rpc("grant_set", { p_org: org, p_user: comum.id, p_role: "secretary", p_network: null, p_title: "x", p_actions: ["people_view"] })).ok).toBe(false);
  });
  test("my_access informa as ações de pessoas", async () => {
    expect((await admin.api.rpc("my_access", { p_org: org })).data.people).toContain("people_import");
    expect((await secretaria.api.rpc("my_access", { p_org: org })).data.people.sort()).toEqual(["people_approve", "people_edit", "people_import", "people_view"]);
    expect((await lider.api.rpc("my_access", { p_org: org })).data.people).toEqual([]);
    expect((await dev.api.rpc("my_access", { p_org: org })).data.people).toEqual([]);
  });
});

describe("cadastro manual", () => {
  test("validações: CPF, e-mail, nome obrigatório", async () => {
    const bad = (p: any) => admin.api.rpc("person_save", { p_org: org, p_id: null, p });
    expect((await bad({ full_name: "A", cpf: "111.111.111-11" })).data.message).toContain("invalid_cpf");
    expect((await bad({ full_name: "A", email: "sem-arroba" })).data.message).toContain("invalid_email");
    expect((await bad({ full_name: "  " })).data.message).toContain("name_required");
    expect((await bad({ full_name: "A", classification: "bispo" })).data.message).toContain("invalid_classification");
  });
  test("CPF é guardado só com dígitos e não duplica", async () => {
    const a = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Ana CPF", cpf: CPF } });
    expect(a.data.saved).toBe(true);
    expect((await admin.api.get(`/people?id=eq.${a.data.id}`)).data[0].cpf).toBe("52998224725");
    const b = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Outra Ana", cpf: "52998224725" } });
    expect(b.data.saved).toBe(false); expect(b.data.duplicates[0].reason).toBe("cpf");
    expect((await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Outra Ana", cpf: "52998224725" }, p_force: true })).ok).toBe(false);
  });
  test("duplicidade por e-mail e por nome+nascimento avisa; salvar mesmo assim marca a ocorrência", async () => {
    const e = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Maria Outra", email: "MARIA@teste.com" } });
    expect(e.data.saved).toBe(false); expect(e.data.duplicates[0].reason).toBe("email");
    const n = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "maria da silva", birth_date: "1990-05-10" } });
    expect(n.data.duplicates[0].reason).toBe("nome e nascimento");
    const f = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Maria Outra", email: "maria@teste.com" }, p_force: true });
    expect(f.data.saved).toBe(true);
    expect((await admin.api.get(`/people?id=eq.${f.data.id}`)).data[0].flagged_duplicate).toBe(true);
  });
  test("mudar a classificação preserva o histórico", async () => {
    const id = (await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Carlos Visitante", classification: "visitor" } })).data.id;
    await secretaria.api.rpc("person_save", { p_org: org, p_id: id, p: { classification: "attender", phone: "21999990000" } });
    await secretaria.api.rpc("person_save", { p_org: org, p_id: id, p: { classification: "member", joined_at: "2026-11-01" } });
    expect((await admin.api.get(`/people?id=eq.${id}`)).data[0]).toMatchObject({ classification: "member", phone: "21999990000", joined_at: "2026-11-01" });
    const h = (await admin.api.get(`/person_history?person_id=eq.${id}&order=id`)).data;
    const cls = h.filter((x: any) => x.kind === "classification").map((x: any) => `${x.old_value}>${x.new_value}`);
    expect(cls).toEqual(["visitor>attender", "attender>member"]);
    expect(h.some((x: any) => x.field === "phone" && x.new_value === "21999990000")).toBe(true);
  });
  test("a conta de usuário não é criada junto com a pessoa", async () => {
    const r = (await admin.api.get(`/people?org_id=eq.${org}&full_name=eq.Carlos Visitante`)).data[0];
    expect(r.user_id).toBeNull();
  });
});

describe("o próprio cadastro", () => {
  test("a pessoa vê e edita seus dados, mas não a classificação, e não vê a base", async () => {
    expect((await comum.api.rpc("my_person", { p_org: org })).data).toBeNull();
    const c = await comum.api.rpc("my_person_update", { p_org: org, p: { phone: "21988887777", city: "Rio", classification: "member", status: "inactive", admin_notes: "hack" } });
    expect(c.ok).toBe(true);
    const me = (await comum.api.rpc("my_person", { p_org: org })).data;
    expect(me).toMatchObject({ classification: "visitor", status: "active", phone: "21988887777", city: "Rio", user_id: comum.id });
    expect(me.admin_notes).toBeUndefined();
    await comum.api.rpc("my_person_update", { p_org: org, p: { classification: "member", joined_at: "2020-01-01" } });
    expect((await comum.api.rpc("my_person", { p_org: org })).data).toMatchObject({ classification: "visitor", joined_at: null });
    expect((await comum.api.get(`/people?org_id=eq.${org}`)).data.length).toBe(1);
    expect((await comum.api.rpc("my_person_update", { p_org: org, p: { cpf: "123" } })).ok).toBe(false);
  });
  test("quem não é da igreja não cria cadastro nela", async () => {
    const forasteiro = await newUser("Forasteiro");
    expect((await forasteiro.api.rpc("my_person_update", { p_org: org, p: { phone: "1" } })).ok).toBe(false);
  });
});

describe("formulário público", () => {
  test("administrador gera; anônimo vê só o necessário e envia; fica pendente", async () => {
    expect((await lider.api.rpc("people_form_save", { p_org: org, p_id: null, p: { fields: ["phone"] } })).ok).toBe(false);
    const id = (await secretaria.api.rpc("people_form_save", { p_org: org, p_id: null, p: { title: "Cadastro de visitantes", fields: ["phone", "email", "cpf", "hack"], initial_classification: "visitor", requires_approval: true } })).data;
    const form = (await secretaria.api.get(`/people_forms?id=eq.${id}`)).data[0];
    token = form.token; expect(token.length).toBeGreaterThanOrEqual(32); expect(form.fields).not.toContain("hack");
    expect((await lider.api.get(`/people_forms?id=eq.${id}`)).data).toEqual([]);
    const g = (await anon.rpc("people_form_get", { p_token: token })).data;
    expect(g).toMatchObject({ title: "Cadastro de visitantes", org_name: "Igreja Pessoas" }); expect([...g.fields].sort()).toEqual(["cpf", "email", "phone"]);
    expect((await anon.rpc("people_form_get", { p_token: "inexistente" })).data).toBeNull();
    const s = await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "Paulo Visitante", phone: "21977776666", city: "ignorada", classification: "member", status: "active" } });
    expect(s.data).toEqual({ ok: true });
    const row = (await secretaria.api.get(`/people?full_name=eq.Paulo Visitante`)).data[0];
    expect(row).toMatchObject({ status: "pending", classification: "visitor", source: "form", phone: "21977776666", city: null });
  });
  test("anônimo não lê pessoas nem escreve direto; honeypot e dados inválidos", async () => {
    expect((await anon.get(`/people`)).ok).toBe(false);
    expect((await anon.post("people", { org_id: org, full_name: "x" })).ok).toBe(false);
    expect((await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "Robô", website: "http://spam" } })).data).toEqual({ ok: true });
    expect((await secretaria.api.get(`/people?full_name=eq.Robô`)).data).toEqual([]);
    expect((await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "Fulano", email: "ruim" } })).ok).toBe(false);
    expect((await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "" } })).ok).toBe(false);
    expect((await anon.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "x" } })).ok).toBe(false);
    expect((await anon.rpc("people_list", { p_org: org })).data?.total ?? 0).toBe(0);
  });
  test("o formulário não devolve nada sobre quem já está cadastrado", async () => {
    const a = await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "Ana CPF", cpf: CPF } });
    const b = await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "Novo Nome", cpf: "111.444.777-35" } });
    expect(a.data).toEqual({ ok: true }); expect(b.data).toEqual({ ok: true });
    const pend = (await secretaria.api.get(`/people?full_name=eq.Ana CPF&status=eq.pending`)).data;
    expect(pend.length).toBe(1); expect(pend[0].cpf).toBeNull(); expect(pend[0].flagged_duplicate).toBe(true);
  });
  test("aprovar, corrigir e rejeitar", async () => {
    const pend = (await secretaria.api.get(`/people?status=eq.pending&order=created_at`)).data;
    const paulo = pend.find((p: any) => p.full_name === "Paulo Visitante");
    expect((await lider.api.rpc("person_review", { p_id: paulo.id, p_decision: "approve" })).ok).toBe(false);
    expect((await secretaria.api.rpc("person_review", { p_id: paulo.id, p_decision: "approve", p: { full_name: "Paulo Souza", classification: "attender" } })).ok).toBe(true);
    expect((await secretaria.api.get(`/people?id=eq.${paulo.id}`)).data[0]).toMatchObject({ status: "active", full_name: "Paulo Souza", classification: "attender" });
    const nova = pend.find((p: any) => p.full_name === "Novo Nome");
    await secretaria.api.rpc("person_review", { p_id: nova.id, p_decision: "reject", p: { note: "teste" } });
    expect((await secretaria.api.get(`/people?id=eq.${nova.id}`)).data[0].status).toBe("rejected");
    expect((await secretaria.api.rpc("person_review", { p_id: nova.id, p_decision: "approve" })).ok).toBe(false);
    expect((await list(secretaria, { p_status: "pending" })).data.counts.pending).toBeGreaterThanOrEqual(1);
  });
  test("formulário desativado não recebe", async () => {
    const id = (await secretaria.api.get(`/people_forms?token=eq.${token}`)).data[0].id;
    await secretaria.api.rpc("people_form_save", { p_org: org, p_id: id, p: { fields: ["phone"], active: false } });
    expect((await anon.rpc("people_form_get", { p_token: token })).data).toBeNull();
    expect((await anon.rpc("people_form_submit", { p_token: token, p: { full_name: "Tarde Demais" } })).ok).toBe(false);
  });
});

describe("vincular usuários existentes", () => {
  test("lista só quem ainda não tem cadastro; vincula sem criar conta nova e sem sobrescrever", async () => {
    expect((await lider.api.rpc("people_linkable_users", { p_org: org })).ok).toBe(false);
    const l = (await secretaria.api.rpc("people_linkable_users", { p_org: org })).data;
    const ids = l.map((x: any) => x.user_id);
    expect(ids).toContain(integrante.id); expect(ids).not.toContain(comum.id);
    // cadastro antigo com o mesmo e-mail da conta do integrante => divergência para revisar
    const mail = (await secretaria.api.rpc("people_linkable_users", { p_org: org, p_q: "Integrante" })).data[0].email;
    const old = await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Integrante Antigo", email: mail, phone: "21000000000" } });
    const r1 = (await secretaria.api.rpc("people_link_users", { p_org: org, p_user_ids: [integrante.id, lider.id], p_classification: "member" })).data;
    expect(r1.conflicts.length).toBe(1); expect(r1.conflicts[0].person_id).toBe(old.data.id); expect(r1.created).toBe(1);
    const r2 = (await secretaria.api.rpc("people_link_users", { p_org: org, p_user_ids: [integrante.id], p_classification: "member", p_resolve: { [integrante.id]: old.data.id } })).data;
    expect(r2.linked).toBe(1);
    const p = (await secretaria.api.get(`/people?id=eq.${old.data.id}`)).data[0];
    expect(p).toMatchObject({ user_id: integrante.id, full_name: "Integrante Antigo", phone: "21000000000" });
    expect((await secretaria.api.rpc("people_link_users", { p_org: org, p_user_ids: [integrante.id], p_classification: "member" })).data).toMatchObject({ linked: 0, created: 0 });
    expect((await secretaria.api.get(`/people?user_id=eq.${integrante.id}`)).data.length).toBe(1);
  });
});

describe("supervisor de rede", () => {
  test("vê só pessoas (com conta) que integram os times da sua rede", async () => {
    const ver = (await supervisor.api.get(`/people?org_id=eq.${org}&select=full_name,user_id`)).data;
    const ids = ver.map((x: any) => x.user_id);
    expect(ids).toContain(integrante.id); expect(ids).toContain(lider.id);
    expect(ids).not.toContain(null);
    expect(ver.length).toBe(2);
    expect((await supervisor.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "x" } })).ok).toBe(false);
  });
});

describe("importação em massa", () => {
  const rows = [
    { full_name: "Importada Um", email: "um@x.com", classification: "member", cpf: "390.533.447-05", birth_date: "1985-02-03" },
    { full_name: "Importada Dois", classification: "visitor" },
    { full_name: "", email: "sem@nome.com" },
    { full_name: "CPF Ruim", cpf: "123" },
    { full_name: "Ana CPF", cpf: CPF },
    { full_name: "Repetida Arquivo", cpf: "390.533.447-05" },
    { full_name: "Classe Ruim", classification: "bispo" },
  ];
  let batch = "";
  test("só quem tem people_import importa; erros e duplicidades não entram", async () => {
    expect((await lider.api.rpc("people_import", { p_org: org, p_rows: rows })).ok).toBe(false);
    const r = (await secretaria.api.rpc("people_import", { p_org: org, p_rows: rows })).data;
    batch = r.batch;
    expect(r).toMatchObject({ total: 7, inserted: 2, skipped_duplicates: 1 });
    expect(r.errors.map((e: any) => `${e.row}:${e.error}`)).toEqual(["3:name_required", "4:invalid_cpf", "6:duplicate_in_file", "7:invalid_classification"]);
    expect((await secretaria.api.get(`/people?import_batch=eq.${batch}`)).data.length).toBe(2);
  });
  test("a prévia (simulação) mostra o resultado sem gravar nada", async () => {
    const antes = (await list(secretaria)).data.counts.all;
    const r = (await secretaria.api.rpc("people_import", { p_org: org, p_rows: rows, p_dry_run: true })).data;
    expect(r).toMatchObject({ dry_run: true, batch: null, total: 7, inserted: 1, skipped_duplicates: 2 });
    expect((await list(secretaria)).data.counts.all).toBe(antes);
  });
  test("reimportar não substitui nem duplica", async () => {
    const r = (await secretaria.api.rpc("people_import", { p_org: org, p_rows: rows.slice(0, 2) })).data;
    expect(r).toMatchObject({ inserted: 1, skipped_duplicates: 1 }); // "Um" repetido é ignorado; "Dois" não tem dado único para comparar
  });
  test("falha no meio desfaz tudo (nada pela metade)", async () => {
    const before = (await list(secretaria)).data.counts.all;
    const r = await secretaria.api.rpc("people_import", { p_org: org, p_rows: [{ full_name: "Boa Linha" }, "isto não é objeto" as any] });
    const after = (await list(secretaria)).data.counts.all;
    if (!r.ok) expect(after).toBe(before);
  });
  test("desfazer a importação remove só o que ninguém editou", async () => {
    const um = (await secretaria.api.get(`/people?import_batch=eq.${batch}&full_name=eq.Importada Um`)).data[0];
    await secretaria.api.rpc("person_save", { p_org: org, p_id: um.id, p: { phone: "21911112222" } });
    expect((await lider.api.rpc("people_import_undo", { p_org: org, p_batch: batch })).ok).toBe(false);
    expect((await secretaria.api.rpc("people_import_undo", { p_org: org, p_batch: batch })).data).toBe(1);
    expect((await secretaria.api.get(`/people?import_batch=eq.${batch}`)).data.length).toBe(1);
  });
});

describe("consulta", () => {
  test("totais, busca, filtro, ordem e paginação", async () => {
    const all = (await list(secretaria)).data;
    expect(all.counts.member).toBeGreaterThanOrEqual(1); expect(all.counts.all).toBeGreaterThan(5);
    expect((await list(secretaria, { p_q: "maria da silva" })).data.rows[0].full_name).toBe("Maria da Silva");
    expect((await list(secretaria, { p_q: "529.982" })).data.total).toBe(1);
    expect((await list(secretaria, { p_class: "member" })).data.rows.every((r: any) => r.classification === "member")).toBe(true);
    const p1 = (await list(secretaria, { p_limit: 3, p_offset: 0 })).data, p2 = (await list(secretaria, { p_limit: 3, p_offset: 3 })).data;
    expect(p1.rows.length).toBe(3); expect(p1.total).toBe(p2.total);
    expect(p1.rows.map((r: any) => r.id)).not.toEqual(p2.rows.map((r: any) => r.id));
    const names = (await list(secretaria, { p_order: "name", p_limit: 100 })).data.rows.map((r: any) => r.full_name.toLowerCase());
    expect([...names].sort()).toEqual(names);
  });
  test("isolamento entre igrejas", async () => {
    const outra = await newUser("Outra Igreja");
    const o2 = (await outra.api.rpc("create_organization", { p_name: "Outra" })).data;
    expect((await outra.api.rpc("people_list", { p_org: org })).data.total).toBe(0);
    expect((await outra.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "x" } })).ok).toBe(false);
    expect((await outra.api.rpc("people_list", { p_org: o2 })).data.total).toBe(0);
  });
  test("registro de operações administrativas", async () => {
    const h = (await admin.api.get(`/person_history?org_id=eq.${org}`)).data;
    const kinds = new Set(h.map((x: any) => x.kind));
    for (const k of ["create", "classification", "approve", "reject", "link", "import", "import_undo", "form_create", "grant"]) expect(kinds.has(k)).toBe(true);
    expect((await lider.api.get(`/person_history?org_id=eq.${org}`)).data).toEqual([]);
  });
});

describe("excluir cadastro", () => {
  test("só quem edita pessoas exclui; histórico some e fica só o registro da exclusão; a conta é mantida", async () => {
    const id = (await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Para Excluir", phone: "21955554444", classification: "member" } })).data.id;
    await admin.api.rpc("person_save", { p_org: org, p_id: id, p: { city: "Rio" } });
    expect((await lider.api.rpc("person_delete", { p_id: id })).ok).toBe(false);
    expect((await dev.api.rpc("person_delete", { p_id: id })).ok).toBe(false);
    expect((await admin.api.get(`/people?id=eq.${id}`)).data.length).toBe(1);
    expect((await secretaria.api.rpc("person_delete", { p_id: id })).ok).toBe(true);
    expect((await admin.api.get(`/people?id=eq.${id}`)).data).toEqual([]);
    expect((await admin.api.get(`/person_history?person_id=eq.${id}`)).data).toEqual([]);
    const log = (await admin.api.get(`/person_history?kind=eq.delete&order=id.desc&limit=1`)).data[0];
    expect(log).toMatchObject({ kind: "delete", old_value: "member" }); expect(JSON.stringify(log)).not.toContain("Para Excluir");
    expect((await admin.api.rpc("person_delete", { p_id: id })).ok).toBe(false);
  });
  test("excluir quem tem conta não remove a conta nem o vínculo com a igreja", async () => {
    const p = (await secretaria.api.get(`/people?user_id=eq.${lider.id}`)).data[0];
    expect((await secretaria.api.rpc("person_delete", { p_id: p.id })).ok).toBe(true);
    expect((await lider.api.rpc("my_access", { p_org: org })).data.member).toBe(true);
    expect((await lider.api.rpc("my_person", { p_org: org })).data).toBeNull();
  });
  test("inativar mantém o cadastro e o histórico", async () => {
    const id = (await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Saiu da Igreja", classification: "member" } })).data.id;
    await admin.api.rpc("person_save", { p_org: org, p_id: id, p: { status: "inactive" } });
    expect((await admin.api.get(`/people?id=eq.${id}`)).data[0].status).toBe("inactive");
    expect((await admin.api.get(`/person_history?person_id=eq.${id}&field=eq.status`)).data.length).toBe(1);
  });
});
