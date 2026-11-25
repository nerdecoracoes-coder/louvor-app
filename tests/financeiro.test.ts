// Fase 3 — Financeiro: permissões, cadastros, lançamentos, aprovação, baixa, estorno, parcelas, orçamento, relatórios e privacidade de quem contribui.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, lanca: any, aprova: any, gerente: any, ve: any, doador: any, lider: any, dev: any, ana: any, fora: any;
let org = "", org2 = "", team = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const catalog = async (u: any, o = org) => (await rpc(u, "fin_catalog", { p_org: o })).data;
const catId = async (kind: string, name: string, o = org, u = admin) => (await catalog(u, o)).categories.find((c: any) => c.kind === kind && c.name === name).id as string;
const accId = async (name: string, o = org, u = admin) => (await catalog(u, o)).accounts.find((a: any) => a.name === name).id as string;
const balance = async (id: string, o = org) => Number((await catalog(admin, o)).accounts.find((a: any) => a.id === id).balance);
const entry = (u: any, p: any, id: string | null = null, o = org) => rpc(u, "fin_entry_save", { p_org: o, p_id: id, p });
const get = async (u: any, id: string) => (await rpc(u, "fin_entry_get", { p_id: id })).data;
const list = async (u: any, f: any = {}, o = org) => (await rpc(u, "fin_entries_list", { p_org: o, p_filter: f })).data as any[];
const notifs = async (u: any, kind: string) => (await rows(`notifications?user_id=eq.${u.id}&kind=eq.${kind}&select=title`)).length;
let caixa = "", banco = "", dizimo = "", oferta = "", agua = "", material = "";

beforeAll(async () => {
  [admin, lanca, aprova, gerente, ve, doador, lider, dev, ana, fora] = await Promise.all(["Adm", "Lanca", "Aprova", "Gerente", "Ve", "Doador", "Lider", "Dev", "Ana", "Fora"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Financeiro" })).data;
  org2 = (await admin.api.rpc("create_organization", { p_name: "Igreja Relatórios" })).data;
  await joinChurch(admin.api, org, lanca, aprova, gerente, ve, doador, lider, dev, ana);
  const grant = (u: any, t: string, a: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: t, p_actions: a });
  await grant(lanca, "Lança", ["fin_entry"]); await grant(aprova, "Aprova", ["fin_approve", "fin_entry"]); await grant(gerente, "Gerente", ["fin_manage"]);
  await grant(ve, "Vê", ["fin_view"]); await grant(doador, "Doador", ["fin_donors", "fin_view"]);
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Fin", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_leader: true }) });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
  caixa = await accId("Caixa");
  banco = (await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "account", p_id: null, p: { name: "Banco", kind: "bank", opening_balance: 1000 } })).data.id;
  dizimo = await catId("income", "Dízimos"); oferta = await catId("income", "Ofertas"); agua = await catId("expense", "Água, luz e internet"); material = await catId("expense", "Material e equipamentos");
});

describe("permissões", () => {
  test("liderança de time, desenvolvedor, membro comum e fora da igreja não têm acesso", async () => {
    for (const u of [lider, dev, ana, fora]) {
      expect(msg(await rpc(u, "fin_catalog", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await entry(u, { kind: "income", description: "X", amount: 10, due_date: day(0), category_id: dizimo }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "fin_reports", { p_org: org, p_from: day(-30), p_to: day(0) }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "fin_entries_list", { p_org: org, p_filter: {} }))).toMatch(/forbidden/);
    }
  });
  test("cada permissão faz só o seu papel", async () => {
    const base = { kind: "income", description: "Oferta", amount: 10, due_date: day(0), category_id: oferta };
    expect(msg(await entry(ve, base))).toBe("forbidden");
    expect(msg(await entry(gerente, base))).toBe("forbidden");
    expect((await entry(lanca, base)).data.ok).toBe(true);
    expect(msg(await rpc(lanca, "fin_catalog_save", { p_org: org, p_type: "cost_center", p_id: null, p: { name: "Teste" } }))).toBe("forbidden");
    expect(msg(await rpc(ve, "fin_settings_save", { p_org: org, p: { approval_threshold: 5 } }))).toBe("forbidden");
    expect(msg(await rpc(lanca, "fin_budget_save", { p_org: org, p: { year: 2026, category_id: agua, amount: 1 } }))).toBe("forbidden");
    expect((await rpc(ve, "fin_reports", { p_org: org, p_from: day(-30), p_to: day(0) })).data.totals).toBeDefined();
    expect((await rpc(lanca, "fin_entries_list", { p_org: org, p_filter: {} })).ok).toBe(true);
    expect((await catalog(ve)).can.entry).toBe(false);
    expect((await catalog(admin)).can.approve).toBe(true);
  });
  test("tabelas fechadas para leitura e escrita diretas", async () => {
    for (const t of ["fin_entries", "fin_accounts", "fin_categories", "fin_budgets", "fin_settings"]) expect((await ana.api.get(`/${t}?org_id=eq.${org}`)).ok).toBe(false);
    expect((await admin.api.get(`/fin_entries?org_id=eq.${org}`)).ok).toBe(false);
  });
  test("comprovantes: bucket privado, só quem tem permissão financeira lê ou envia", async () => {
    // a pilha local não tem o serviço de arquivos; testamos a regra que as políticas do bucket usam
    const path = `fin/${org}/${Date.now()}-a.txt`;
    const ok = async (u: any, acts: string[], name = path) => (await rpc(u, "fin_storage_ok", { p_name: name, p_actions: acts })).data;
    const W = ["fin_entry", "fin_manage"], R = ["fin_view", "fin_entry", "fin_approve", "fin_manage", "fin_donors"];
    expect(await ok(lanca, W)).toBe(true); expect(await ok(gerente, W)).toBe(true); expect(await ok(ve, W)).toBe(false); expect(await ok(ana, W)).toBe(false);
    expect(await ok(ve, R)).toBe(true); expect(await ok(ana, R)).toBe(false); expect(await ok(lider, R)).toBe(false); expect(await ok(dev, R)).toBe(false);
    expect(await ok(lanca, W, `fin/${org2}/x.txt`)).toBe(false); expect(await ok(lanca, W, `chat/${org}/x.txt`)).toBe(false); expect(await ok(lanca, W, "fin/nao-e-uuid/x.txt")).toBe(false);
    expect(msg(await entry(lanca, { kind: "expense", description: "R", amount: 5, due_date: day(0), category_id: agua, receipt_path: `fin/${org2}/x.txt` }))).toBe("invalid_receipt");
    expect((await entry(lanca, { kind: "expense", description: "R", amount: 5, due_date: day(0), category_id: agua, receipt_path: path })).data.ok).toBe(true);
    expect((await list(ve, { q: "R" })).find((r: any) => r.description === "R").has_receipt).toBe(true);
  });
});

describe("cadastros", () => {
  test("categorias e caixa padrão nascem uma vez só", async () => {
    const a = await catalog(admin); const b = await catalog(admin);
    expect(a.categories.filter((c: any) => c.kind === "income").length).toBe(7);
    expect(b.categories.length).toBe(a.categories.length);
    expect(a.accounts.some((x: any) => x.name === "Caixa" && x.kind === "cash")).toBe(true);
  });
  test("nome repetido, tipo inválido e desativar", async () => {
    expect(msg(await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "account", p_id: null, p: { name: "caixa" } }))).toBe("name_taken");
    expect(msg(await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "category", p_id: null, p: { name: "Z", kind: "outro" } }))).toBe("invalid_kind");
    expect(msg(await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "xx", p_id: null, p: { name: "Z" } }))).toBe("invalid_type");
    expect(msg(await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "account", p_id: null, p: { name: "" } }))).toBe("name_required");
    const cc = (await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "cost_center", p_id: null, p: { name: "Jovens" } })).data.id;
    await rpc(gerente, "fin_catalog_save", { p_org: org, p_type: "cost_center", p_id: cc, p: { name: "Jovens", active: false } });
    expect(msg(await entry(lanca, { kind: "expense", description: "X", amount: 5, due_date: day(0), category_id: agua, cost_center_id: cc }))).toBe("invalid_reference");
  });
  test("categoria de outra igreja ou de outro tipo é recusada", async () => {
    const outra = await catId("expense", "Missões", org2);
    // o admin da org2 existe (mesmo usuário), mas a categoria pertence a outra igreja
    expect(msg(await entry(lanca, { kind: "expense", description: "X", amount: 5, due_date: day(0), category_id: outra }))).toBe("invalid_reference");
    expect(msg(await entry(lanca, { kind: "expense", description: "X", amount: 5, due_date: day(0), category_id: dizimo }))).toBe("invalid_reference");
  });
});

describe("lançamentos", () => {
  test("validações", async () => {
    const b = { kind: "expense", description: "Luz", amount: 50, due_date: day(5), category_id: agua };
    expect(msg(await entry(lanca, { ...b, amount: 0 }))).toBe("invalid_amount");
    expect(msg(await entry(lanca, { ...b, amount: -3 }))).toBe("invalid_amount");
    expect(msg(await entry(lanca, { ...b, amount: "abc" }))).toBe("invalid_amount");
    expect(msg(await entry(lanca, { ...b, description: " " }))).toBe("fin_description_required");
    expect(msg(await entry(lanca, { ...b, category_id: null }))).toBe("category_required");
    expect(msg(await entry(lanca, { ...b, due_date: null }))).toBe("due_required");
    expect(msg(await entry(lanca, { ...b, kind: "outro" }))).toBe("invalid_kind");
    expect(msg(await entry(lanca, { ...b, method: "ouro" }))).toBe("invalid_method");
    expect(msg(await entry(lanca, { ...b, paid_at: day(3), account_id: caixa }))).toBe("fin_future_date");
    expect(msg(await entry(lanca, { ...b, paid_at: day(0) }))).toBe("account_required");
    expect(msg(await entry(lanca, { ...b, installments: 61 }))).toBe("invalid_installments");
    expect(msg(await entry(lanca, { ...b, installments: 2, paid_at: day(0), account_id: caixa }))).toBe("invalid_installments");
  });
  test("receita baixada na hora e despesa em aberto mexem no saldo só quando efetivadas", async () => {
    const antes = await balance(caixa);
    const r = (await entry(lanca, { kind: "income", description: "Dízimos do culto", amount: 250.55, due_date: day(-1), paid_at: day(-1), account_id: caixa, category_id: dizimo, method: "cash", anonymous: true })).data;
    expect(r.status).toBe("settled");
    expect(await balance(caixa)).toBeCloseTo(antes + 250.55, 2);
    const d = (await entry(lanca, { kind: "expense", description: "Conta de luz", amount: 80, due_date: day(5), category_id: agua, account_id: caixa })).data;
    expect(d.status).toBe("open");
    expect(await balance(caixa)).toBeCloseTo(antes + 250.55, 2);
    expect((await rpc(lanca, "fin_entry_settle", { p_id: d.id, p_date: day(0), p_method: "pix" })).data.ok).toBe(true);
    expect(await balance(caixa)).toBeCloseTo(antes + 170.55, 2);
    expect(msg(await rpc(lanca, "fin_entry_settle", { p_id: d.id }))).toBe("entry_locked");
  });
  test("baixa exige conta e não aceita data futura", async () => {
    const d = (await entry(lanca, { kind: "expense", description: "Sem conta", amount: 20, due_date: day(1), category_id: agua })).data.id;
    expect(msg(await rpc(lanca, "fin_entry_settle", { p_id: d }))).toBe("account_required");
    expect(msg(await rpc(lanca, "fin_entry_settle", { p_id: d, p_date: day(2), p_account: caixa }))).toBe("fin_future_date");
    expect((await rpc(lanca, "fin_entry_settle", { p_id: d, p_account: banco })).data.ok).toBe(true);
  });
  test("transferência move saldo entre contas e valida as contas", async () => {
    const [c0, b0] = [await balance(caixa), await balance(banco)];
    expect(msg(await entry(lanca, { kind: "transfer", description: "Depósito", amount: 100, account_id: caixa, to_account_id: caixa }))).toBe("invalid_accounts");
    const t = (await entry(lanca, { kind: "transfer", description: "Depósito", amount: 100, account_id: caixa, to_account_id: banco, paid_at: day(0) })).data;
    expect(t.status).toBe("settled");
    expect(await balance(caixa)).toBeCloseTo(c0 - 100, 2); expect(await balance(banco)).toBeCloseTo(b0 + 100, 2);
    const rep = (await rpc(ve, "fin_reports", { p_org: org, p_from: day(-30), p_to: day(0) })).data;
    expect(rep.totals).toBeDefined();
    expect(msg(await entry(lanca, { kind: "transfer", description: "Depósito", amount: 5, account_id: caixa, to_account_id: banco }, t.id))).toBe("entry_locked");
  });
  test("edição só em aberto; baixado fica travado; alterações ficam no histórico", async () => {
    const id = (await entry(lanca, { kind: "expense", description: "Papel", amount: 30, due_date: day(3), category_id: material })).data.id;
    expect((await entry(lanca, { kind: "expense", description: "Papel A4", amount: 35, due_date: day(4), category_id: material }, id)).data.ok).toBe(true);
    const g = await get(ve, id);
    expect(g.entry.description).toBe("Papel A4"); expect(Number(g.entry.amount)).toBe(35);
    expect(g.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(["create", "update"]));
    await rpc(lanca, "fin_entry_settle", { p_id: id, p_account: caixa });
    expect(msg(await entry(lanca, { kind: "expense", description: "Outro", amount: 1, due_date: day(1), category_id: material }, id))).toBe("entry_locked");
  });
});

describe("quem contribuiu (privacidade)", () => {
  test("anônima é permitida; identificar exige fin_donors; quem só vê relatório não vê o nome", async () => {
    await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [ana.id], p_classification: "member" });
    const person = (await rows(`people?org_id=eq.${org}&user_id=eq.${ana.id}&select=id`))[0].id;
    const base = { kind: "income", amount: 300, due_date: day(0), category_id: dizimo };
    expect((await entry(lanca, { ...base, description: "Anônimo", anonymous: true })).data.ok).toBe(true);
    expect(msg(await entry(lanca, { ...base, description: "Com nome", counterparty: "João Silva" }))).toBe("donor_forbidden");
    expect(msg(await entry(lanca, { ...base, description: "Com pessoa", person_id: person }))).toBe("donor_forbidden");
    expect(msg(await entry(doador, { ...base, description: "Dízimo identificado", counterparty: "João Silva", person_id: person }))).toBe("forbidden"); // fin_donors sozinho não lança
  });
  test("lançamento identificado: a lista mascara para quem não tem fin_donors e a edição preserva", async () => {
    await admin.api.rpc("grant_set", { p_org: org, p_user: doador.id, p_role: "secretary", p_network: null, p_title: "Doador", p_actions: ["fin_donors", "fin_view", "fin_entry"] });
    const id = (await entry(doador, { kind: "income", description: "Dízimo identificado B", amount: 400, due_date: day(0), category_id: dizimo, counterparty: "João Silva" })).data.id;
    const comNome = (await list(doador, { q: "identificado B" }))[0];
    expect(comNome.counterparty).toBe("João Silva"); expect(comNome.donor_hidden).toBe(false);
    const semNome = (await list(ve, { q: "identificado B" }))[0];
    expect(semNome.counterparty).toBeNull(); expect(semNome.donor_hidden).toBe(true);
    expect((await get(ve, id)).entry.counterparty).toBeNull();
    expect((await list(ve, { q: "Silva" })).length).toBe(0);
    // quem só lança edita o valor sem apagar quem contribuiu
    expect((await entry(lanca, { kind: "income", description: "Dízimo identificado B", amount: 450, due_date: day(0), category_id: dizimo }, id)).data.ok).toBe(true);
    expect((await get(doador, id)).entry.counterparty).toBe("João Silva");
  });
});

describe("aprovação de despesas", () => {
  beforeAll(async () => { expect((await rpc(gerente, "fin_settings_save", { p_org: org, p: { approval_threshold: 100 } })).data.ok).toBe(true); });
  test("abaixo do limite não precisa; acima fica pendente e não pode ser baixada", async () => {
    const pouco = (await entry(lanca, { kind: "expense", description: "Pouco", amount: 99.99, due_date: day(2), category_id: agua })).data;
    expect(pouco.approval).toBe("none");
    const muito = (await entry(lanca, { kind: "expense", description: "Muito", amount: 100, due_date: day(2), category_id: agua })).data;
    expect(muito.approval).toBe("pending");
    expect(msg(await rpc(lanca, "fin_entry_settle", { p_id: muito.id, p_account: caixa }))).toBe("approval_required");
    expect(msg(await entry(lanca, { kind: "expense", description: "Muito", amount: 500, due_date: day(0), category_id: agua, account_id: caixa, paid_at: day(0) }))).toBe("approval_required");
    expect(await notifs(aprova, "fin_approval")).toBeGreaterThan(0);
    expect(await notifs(lanca, "fin_approval")).toBe(0);
  });
  test("quem lança não aprova; aprovador distinto aprova e a baixa libera", async () => {
    const id = (await entry(lanca, { kind: "expense", description: "Reforma", amount: 600, due_date: day(2), category_id: agua, account_id: caixa })).data.id;
    expect(msg(await rpc(lanca, "fin_entry_decide", { p_id: id, p_decision: "approve" }))).toBe("forbidden");
    expect(msg(await rpc(ve, "fin_entry_decide", { p_id: id, p_decision: "approve" }))).toBe("forbidden");
    expect((await get(aprova, id)).can_decide).toBe(true); expect((await get(lanca, id)).can_decide).toBe(false);
    expect((await rpc(aprova, "fin_entry_decide", { p_id: id, p_decision: "approve" })).data.ok).toBe(true);
    expect(await notifs(lanca, "fin_approval_result")).toBeGreaterThan(0);
    expect((await get(ve, id)).entry.approval).toBe("approved");
    expect((await rpc(lanca, "fin_entry_settle", { p_id: id })).data.ok).toBe(true);
    expect(msg(await rpc(aprova, "fin_entry_decide", { p_id: id, p_decision: "approve" }))).toBe("fin_not_pending");
  });
  test("ninguém aprova o que ele mesmo lançou — nem o administrador", async () => {
    const meu = (await entry(aprova, { kind: "expense", description: "Meu gasto", amount: 300, due_date: day(2), category_id: agua })).data.id;
    expect(msg(await rpc(aprova, "fin_entry_decide", { p_id: meu, p_decision: "approve" }))).toBe("fin_self_approval");
    const doAdmin = (await entry(admin, { kind: "expense", description: "Gasto do admin", amount: 300, due_date: day(2), category_id: agua })).data.id;
    expect(msg(await rpc(admin, "fin_entry_decide", { p_id: doAdmin, p_decision: "approve" }))).toBe("fin_self_approval");
    expect((await rpc(aprova, "fin_entry_decide", { p_id: doAdmin, p_decision: "approve" })).data.ok).toBe(true);
  });
  test("quem altera uma despesa pendente também não a aprova; mudar o valor reabre a aprovação", async () => {
    const id = (await entry(lanca, { kind: "expense", description: "Equipamento", amount: 400, due_date: day(2), category_id: material })).data.id;
    await entry(aprova, { kind: "expense", description: "Equipamento", amount: 400, due_date: day(2), category_id: material }, id);
    expect(msg(await rpc(aprova, "fin_entry_decide", { p_id: id, p_decision: "approve" }))).toBe("fin_self_approval");
    expect((await rpc(admin, "fin_entry_decide", { p_id: id, p_decision: "approve" })).data.ok).toBe(true);
    expect((await entry(lanca, { kind: "expense", description: "Equipamento", amount: 900, due_date: day(2), category_id: material }, id)).data.approval).toBe("pending");
    expect((await entry(lanca, { kind: "expense", description: "Equipamento", amount: 50, due_date: day(2), category_id: material }, id)).data.approval).toBe("none");
  });
  test("recusa exige motivo, cancela sem apagar e avisa quem lançou", async () => {
    const id = (await entry(lanca, { kind: "expense", description: "Churrasco", amount: 700, due_date: day(2), category_id: agua })).data.id;
    expect(msg(await rpc(aprova, "fin_entry_decide", { p_id: id, p_decision: "reject" }))).toBe("reason_required");
    expect((await rpc(aprova, "fin_entry_decide", { p_id: id, p_decision: "reject", p_reason: "Fora do orçamento" })).data.ok).toBe(true);
    const g = await get(ve, id);
    expect(g.entry.status).toBe("cancelled"); expect(g.entry.approval).toBe("rejected"); expect(g.entry.cancel_reason).toMatch(/Fora do orçamento/);
    expect(msg(await rpc(lanca, "fin_entry_settle", { p_id: id, p_account: caixa }))).toBe("entry_locked");
  });
  test("rótulos fora de ordem: decisão inválida e receita nunca pede aprovação", async () => {
    const id = (await entry(lanca, { kind: "expense", description: "Qualquer", amount: 800, due_date: day(2), category_id: agua })).data.id;
    expect(msg(await rpc(aprova, "fin_entry_decide", { p_id: id, p_decision: "talvez" }))).toBe("invalid_decision");
    expect((await entry(lanca, { kind: "income", description: "Grande", amount: 99999, due_date: day(2), category_id: oferta })).data.approval).toBe("none");
  });
});

describe("parcelas, recorrência e cancelamento", () => {
  test("parcelamento divide o total sem perder centavos", async () => {
    const r = (await entry(lanca, { kind: "expense", description: "Som", amount: 100, due_date: day(10), category_id: material, installments: 3, series_kind: "installment" })).data;
    expect(r.count).toBe(3);
    const ps = (await list(lanca, { q: "Som (" })).filter((x: any) => x.series_id).sort((a: any, b: any) => a.installment - b.installment);
    expect(ps.map((p: any) => Number(p.amount))).toEqual([33.34, 33.33, 33.33]);
    expect(ps.reduce((s: number, p: any) => s + Number(p.amount), 0)).toBeCloseTo(100, 2);
    expect(ps[1].description).toBe("Som (2/3)");
    expect(new Set(ps.map((p: any) => p.due_date)).size).toBe(3);
  });
  test("recorrência repete o mesmo valor; cancelar a série cancela só as seguintes em aberto", async () => {
    await entry(lanca, { kind: "expense", description: "Internet", amount: 40, due_date: day(1), category_id: agua, installments: 4, series_kind: "recurring" });
    const ps = (await list(lanca, { q: "Internet" })).sort((a: any, b: any) => a.installment - b.installment);
    expect(ps.length).toBe(4); expect(ps.every((p: any) => Number(p.amount) === 40 && p.description === "Internet")).toBe(true);
    await rpc(lanca, "fin_entry_settle", { p_id: ps[0].id, p_account: caixa });
    expect(msg(await rpc(lanca, "fin_entry_cancel", { p_id: ps[1].id, p_reason: "" }))).toBe("reason_required");
    expect((await rpc(lanca, "fin_entry_cancel", { p_id: ps[1].id, p_reason: "Trocou de provedor", p_series: true })).data.count).toBe(3);
    const depois = (await list(lanca, { q: "Internet" })).sort((a: any, b: any) => a.installment - b.installment);
    expect(depois.map((p: any) => p.status)).toEqual(["settled", "cancelled", "cancelled", "cancelled"]);
  });
  test("aprovação em série aprova todas as parcelas pendentes", async () => {
    await entry(lanca, { kind: "expense", description: "Palco", amount: 1200, due_date: day(5), category_id: material, installments: 3, series_kind: "recurring" });
    const ps = (await list(lanca, { q: "Palco" }));
    expect(ps.every((p: any) => p.approval === "pending")).toBe(true);
    expect((await rpc(aprova, "fin_entry_decide", { p_id: ps[0].id, p_decision: "approve", p_series: true })).data.count).toBe(3);
    expect((await list(lanca, { q: "Palco" })).every((p: any) => p.approval === "approved")).toBe(true);
  });
});

describe("estorno e histórico", () => {
  test("cancelar o que já foi baixado exige fin_manage, devolve o saldo e mantém o registro", async () => {
    const antes = await balance(caixa);
    const id = (await entry(lanca, { kind: "income", description: "Oferta errada", amount: 70, due_date: day(0), paid_at: day(0), account_id: caixa, category_id: oferta })).data.id;
    expect(await balance(caixa)).toBeCloseTo(antes + 70, 2);
    expect(msg(await rpc(lanca, "fin_entry_cancel", { p_id: id, p_reason: "Valor errado" }))).toBe("forbidden");
    expect((await rpc(gerente, "fin_entry_cancel", { p_id: id, p_reason: "Valor errado" })).data.ok).toBe(true);
    expect(await balance(caixa)).toBeCloseTo(antes, 2);
    const g = await get(gerente, id);
    expect(g.entry.status).toBe("cancelled"); expect(g.entry.cancel_reason).toBe("Valor errado");
    expect(g.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(["create_settled", "reverse"]));
    expect((await list(ve, { status: "cancelled", q: "Oferta errada" })).length).toBe(1);
    expect(msg(await rpc(gerente, "fin_entry_cancel", { p_id: id, p_reason: "de novo" }))).toBe("entry_locked");
  });
  test("auditoria registra as operações financeiras", async () => {
    const a = await rows(`mod_audit?org_id=eq.${org}&module=eq.finance&select=action,entity`);
    const acts = new Set(a.map((x) => x.action));
    for (const k of ["seed", "create", "create_settled", "update", "settle", "approve", "reject", "cancel", "reverse"]) expect(acts.has(k)).toBe(true);
    expect(a.some((x) => x.entity === "settings")).toBe(true);
  });
  test("lançamentos não têm exclusão: nenhuma função apaga e a tabela está fechada", async () => {
    const r = await fetch(`${REST}/rpc/fin_entry_delete`, { method: "POST", headers: await sk(), body: "{}" });
    expect(r.ok).toBe(false);
    expect((await rows(`fin_entries?org_id=eq.${org}&select=id`)).length).toBeGreaterThan(10);
  });
});

describe("relatórios e orçamento (igreja limpa)", () => {
  let c2 = "", i2 = "", e2 = "", cx2 = "", ip = "";
  beforeAll(async () => {
    await catalog(admin, org2);
    cx2 = await accId("Caixa", org2); i2 = await catId("income", "Ofertas", org2); e2 = await catId("expense", "Material e equipamentos", org2); ip = await catId("income", "Dízimos", org2);
    c2 = (await rpc(admin, "fin_catalog_save", { p_org: org2, p_type: "campaign", p_id: null, p: { name: "Reforma do templo", goal: 5000 } })).data.id;
    const mk = (p: any) => entry(admin, p, null, org2);
    await mk({ kind: "income", description: "Oferta 1", amount: 1000, due_date: day(-3), paid_at: day(-3), account_id: cx2, category_id: i2 });
    await mk({ kind: "income", description: "Dízimo 1", amount: 500, due_date: day(-2), paid_at: day(-2), account_id: cx2, category_id: ip, campaign_id: c2 });
    await mk({ kind: "expense", description: "Material 1", amount: 300, due_date: day(-1), paid_at: day(-1), account_id: cx2, category_id: e2 });
    await mk({ kind: "expense", description: "Atrasada", amount: 120, due_date: day(-10), category_id: e2 });
    await mk({ kind: "expense", description: "Futura", amount: 80, due_date: day(10), category_id: e2 });
    await mk({ kind: "income", description: "A receber", amount: 60, due_date: day(-4), category_id: i2 });
  });
  test("totais, categorias, saldo, campanha e pendências", async () => {
    const r = (await rpc(admin, "fin_reports", { p_org: org2, p_from: day(-30), p_to: day(0) })).data;
    expect(Number(r.totals.income)).toBe(1500); expect(Number(r.totals.expense)).toBe(300);
    expect(r.income_by_category.map((x: any) => x.name).sort()).toEqual(["Dízimos", "Ofertas"]);
    expect(Number(r.expense_by_category[0].total)).toBe(300);
    expect(Number(r.income_by_campaign[0].total)).toBe(500);
    expect(Number(r.balances.find((b: any) => b.name === "Caixa").balance)).toBe(1200);
    expect(Number(r.pending.payable)).toBe(200); expect(Number(r.pending.payable_overdue)).toBe(120);
    expect(Number(r.pending.receivable)).toBe(60); expect(Number(r.pending.receivable_overdue)).toBe(60);
    expect(r.flow.length).toBeGreaterThan(0);
    const so = (await rpc(admin, "fin_reports", { p_org: org2, p_from: day(-1), p_to: day(0) })).data;
    expect(Number(so.totals.income)).toBe(0);
    expect((await list(admin, { status: "overdue" }, org2)).map((x: any) => x.description).sort()).toEqual(["A receber", "Atrasada"]);
    expect((await catalog(admin, org2)).campaigns[0].raised).toBe(500);
  });
  test("período inválido", async () => {
    expect(msg(await rpc(admin, "fin_reports", { p_org: org2, p_from: day(0), p_to: day(-5) }))).toBe("invalid_period");
    expect(msg(await rpc(admin, "fin_reports", { p_org: org2, p_from: "2000-01-01", p_to: day(0) }))).toBe("invalid_period");
    expect(msg(await rpc(admin, "fin_budget_report", { p_org: org2, p_year: 1999 }))).toBe("invalid_period");
    expect(msg(await rpc(admin, "fin_budget_report", { p_org: org2, p_year: 2026, p_month: 13 }))).toBe("invalid_period");
  });
  test("orçado × realizado por categoria, por mês e remoção", async () => {
    const now = new Date(); const y = now.getUTCFullYear();
    const m = Number(day(-1).slice(5, 7)); const yy = Number(day(-1).slice(0, 4));
    expect((await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, category_id: e2, amount: 1000 } })).data.ok).toBe(true);
    expect((await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, month: m, category_id: e2, amount: 250 } })).data.ok).toBe(true);
    expect((await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, category_id: e2, amount: 1200 } })).data.ok).toBe(true); // atualiza a mesma linha
    const ano = (await rpc(admin, "fin_budget_report", { p_org: org2, p_year: yy })).data;
    expect(ano.length).toBe(1); expect(Number(ano[0].planned)).toBe(1200); expect(Number(ano[0].actual)).toBe(300);
    const mes = (await rpc(admin, "fin_budget_report", { p_org: org2, p_year: yy, p_month: m })).data;
    expect(mes.length).toBe(1); expect(Number(mes[0].planned)).toBe(250);
    expect(Number(mes[0].actual)).toBeGreaterThanOrEqual(300 * (day(-1).slice(0, 7) === `${yy}-${String(m).padStart(2, "0")}` ? 1 : 0));
    expect(msg(await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, amount: 5 } }))).toBe("category_required");
    expect(msg(await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, category_id: e2, amount: -1 } }))).toBe("invalid_amount");
    expect(msg(await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, category_id: dizimo, amount: 10 } }))).toBe("invalid_reference");
    expect((await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, month: m, category_id: e2, amount: null } })).data.removed).toBe(true);
    expect((await rpc(admin, "fin_budget_report", { p_org: org2, p_year: yy, p_month: m })).data.length).toBe(0);
    void y;
  });
  test("orçamento por centro de custo compara com despesas daquele centro", async () => {
    const cc = (await rpc(admin, "fin_catalog_save", { p_org: org2, p_type: "cost_center", p_id: null, p: { name: "Infantil" } })).data.id;
    await entry(admin, { kind: "expense", description: "Brinquedos", amount: 90, due_date: day(0), paid_at: day(0), account_id: cx2, category_id: e2, cost_center_id: cc }, null, org2);
    const yy = Number(day(0).slice(0, 4));
    await rpc(admin, "fin_budget_save", { p_org: org2, p: { year: yy, cost_center_id: cc, amount: 400 } });
    const r = (await rpc(admin, "fin_budget_report", { p_org: org2, p_year: yy })).data.find((x: any) => x.cost_center === "Infantil");
    expect(Number(r.planned)).toBe(400); expect(Number(r.actual)).toBe(90);
  });
  test("módulos novos entram nas permissões sem quebrar as antigas", async () => {
    const acts = (await rpc(admin, "my_modules", { p_org: org2 })).data.actions as string[];
    for (const a of ["fin_view", "fin_entry", "fin_approve", "fin_manage", "fin_donors", "ev_view", "cells_view"]) expect(acts).toContain(a);
    expect((await rpc(ana, "my_modules", { p_org: org })).data.actions.filter((a: string) => a.startsWith("fin_"))).toEqual([]);
  });
});
