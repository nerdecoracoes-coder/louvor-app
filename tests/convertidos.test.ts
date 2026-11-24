// Recurso 07: gestão de novos convertidos (decisão de fé como acontecimento, vínculo à ficha, acompanhamento, permissões, formulários, histórico restrito).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, anonKey, REST, Api } from "./helpers";

let admin: any, secretaria: any, resp: any, integrante: any, lider: any, fora: any, dev: any, semFicha: any, anon: Api;
let org = "", token = "", pInt = "";
const msg = (r: any) => String(r.data?.message ?? "");
const reg = (u: any, p: any, force = false) => u.api.rpc("convert_register", { p_org: org, p, p_force: force });
const list = async (u: any, f: any = {}) => (await u.api.rpc("convert_list", { p_org: org, p: f }));
const get = (u: any, id: string) => u.api.rpc("convert_get", { p_id: id });
const timeline = async (u: any, id: string) => (await u.api.rpc("person_timeline", { p_person: id, p_categories: null, p_origin: null, p_from: null, p_to: null, p_by: null, p_limit: 100, p_offset: 0 })).data?.items as any[];
const person = async (id: string, cols = "*") => (await admin.api.get(`/people?id=eq.${id}&select=${cols}`)).data[0];
const notifs = async (u: any) => (await u.api.get(`/notifications?user_id=eq.${u.id}&kind=eq.convert&select=title,body,link&order=created_at`)).data as any[];
const CONV = ["people_converts_view", "people_converts_register", "people_converts_edit", "people_converts_link", "people_converts_assign", "people_converts_followup", "people_converts_indicators"];

beforeAll(async () => {
  [admin, secretaria, resp, integrante, lider, fora, dev, semFicha] = await Promise.all(["Admin", "Secretaria", "Resp", "Integrante", "Lider", "Fora", "Dev", "SemFicha"].map(newUser));
  anon = new Api(await anonKey());
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Convertidos" })).data;
  await joinChurch(admin.api, org, secretaria, resp, integrante, lider, dev, semFicha);
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria", p_actions: ["people_view", "people_edit", ...CONV] });
  await admin.api.rpc("grant_set", { p_org: org, p_user: resp.id, p_role: "secretary", p_network: null, p_title: "Acompanhante", p_actions: ["people_converts_followup"] });
  const t = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: t, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${t}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [integrante.id, lider.id, resp.id], p_classification: "attender" });
  pInt = (await admin.api.get(`/people?user_id=eq.${integrante.id}&select=id`)).data[0].id;
});

describe("registro e vínculo", () => {
  let awaiting = "", linked = "", created = "";
  test("1. nova decisão sem ficha fica aguardando associação, sem telefone e sem autorização", async () => {
    const r = await reg(secretaria, { name: "Maria da Silva", origin: "culto", place: "Culto de domingo" });
    expect(r.data.saved).toBe(true); awaiting = r.data.id;
    const d = (await get(secretaria, awaiting)).data;
    expect(d.awaiting_link).toBe(true); expect(d.consent).toBe("unknown"); expect(d.has_contact).toBe(false); expect(d.person).toBeNull();
    expect((await list(secretaria)).data.items.some((i: any) => i.id === awaiting && i.awaiting_link)).toBe(true);
  });
  test("2. decisão de pessoa já cadastrada vincula à ficha e não muda a classificação nem cria time/conta", async () => {
    const before = await person(pInt, "classification,user_id,status");
    const teamsBefore = (await admin.api.get(`/team_members?user_id=eq.${integrante.id}&select=team_id`)).data.length;
    const r = await reg(secretaria, { name: "Integrante", mode: "link", person_id: pInt, origin: "celula", decided_on: "2026-11-01" });
    expect(r.data.saved).toBe(true); linked = r.data.id;
    expect(await person(pInt, "classification,user_id,status")).toEqual(before);
    expect((await admin.api.get(`/team_members?user_id=eq.${integrante.id}&select=team_id`)).data.length).toBe(teamsBefore);
    expect((await get(secretaria, linked)).data.person.id).toBe(pInt);
  });
  test("3. pessoa sem conta de acesso pode ter decisão; ficha nova não cria usuário", async () => {
    const r = await reg(secretaria, { name: "João Sem Conta", mode: "create", origin: "evangelismo", place: "Praça central" });
    expect(r.data.saved).toBe(true); created = r.data.id;
    const d = (await get(secretaria, created)).data;
    expect(d.person.has_account).toBe(false);
    const p = await person(d.person.id, "user_id,classification,status,full_name");
    expect(p).toEqual({ user_id: null, classification: "none", status: "active", full_name: "João Sem Conta" });
  });
  test("4. sem telefone, sem e-mail e sem autorização de contato é válido; telefone sem autorização não é exibido e não permite contato", async () => {
    const r = await reg(secretaria, { name: "Pedro Tel", origin: "evento", phone: "11988887777", consent: "unknown" });
    const d = (await get(secretaria, r.data.id)).data;
    expect(d.has_contact).toBe(true); expect(d.phone).toBeNull(); expect(d.consent).toBe("unknown");
    const e = await admin.api.rpc("convert_entry_add", { p_id: r.data.id, p_kind: "contact", p_body: "Liguei", p_on: null, p_channel: "phone" });
    expect(msg(e)).toContain("contact_not_authorized");
  });
  test("5. vincular decisão aguardando a uma ficha existente (escolha explícita) e candidatos não vinculam sozinhos", async () => {
    const c = (await secretaria.api.rpc("convert_candidates", { p_org: org, p_name: "Integrante", p_phone: null, p_email: null })).data;
    expect(c.some((x: any) => x.id === pInt)).toBe(true);
    expect((await get(secretaria, awaiting)).data.awaiting_link).toBe(true);   // só buscar não associa
    const l = await secretaria.api.rpc("convert_link", { p_id: awaiting, p_person: pInt, p_create: false, p_force: false });
    expect(l.data.saved).toBe(true);
    expect((await get(secretaria, awaiting)).data.person.id).toBe(pInt);
    expect(msg(await secretaria.api.rpc("convert_link", { p_id: awaiting, p_person: pInt, p_create: false, p_force: false }))).toContain("already_linked");
  });
  test("6. criar nova ficha a partir de decisão aguardando", async () => {
    const r = await reg(secretaria, { name: "Ana Nova Ficha", origin: "transmissao" });
    const l = await secretaria.api.rpc("convert_link", { p_id: r.data.id, p_person: null, p_create: true, p_force: false });
    expect(l.data.saved).toBe(true);
    expect((await person(l.data.person_id, "classification,user_id"))).toEqual({ classification: "none", user_id: null });
  });
  test("7. associação ambígua é bloqueada: nome igual exige escolha ou confirmação", async () => {
    const n0 = (await admin.api.get(`/people?org_id=eq.${org}&full_name=eq.João Sem Conta&select=id`)).data.length;
    const r = await reg(secretaria, { name: "João Sem Conta", mode: "create", origin: "culto", decided_on: "2026-11-02" });
    expect(r.data.saved).toBe(false); expect(r.data.candidates.length).toBeGreaterThan(0);
    expect((await admin.api.get(`/people?org_id=eq.${org}&full_name=eq.João Sem Conta&select=id`)).data.length).toBe(n0);
    const f = await reg(secretaria, { name: "João Sem Conta", mode: "create", origin: "culto", decided_on: "2026-11-02" }, true);
    expect(f.data.saved).toBe(true);
  });
  test("8. data retroativa aceita; data futura recusada", async () => {
    expect((await reg(secretaria, { name: "Retro Ativo", origin: "culto", decided_on: "2023-05-14" })).data.saved).toBe(true);
    expect(msg(await reg(secretaria, { name: "Futuro", origin: "culto", decided_on: "2999-01-01" }))).toContain("invalid_date");
    expect(msg(await reg(secretaria, { name: "Origem", origin: "xyz" }))).toContain("invalid_origin");
    expect(msg(await reg(secretaria, { name: "", origin: "culto" }))).toContain("name_required");
  });
  test("9. várias decisões da mesma pessoa são preservadas; mesmo dia é bloqueado; chave evita duplicidade", async () => {
    const a = await reg(secretaria, { name: "Integrante", mode: "link", person_id: pInt, origin: "culto", decided_on: "2025-03-03" });
    expect(a.data.saved).toBe(true);
    expect(msg(await reg(secretaria, { name: "Integrante", mode: "link", person_id: pInt, origin: "culto", decided_on: "2025-03-03" }))).toContain("duplicate_decision");
    const k1 = await reg(secretaria, { name: "Chave Um", origin: "culto", key: "k-1" });
    const k2 = await reg(secretaria, { name: "Chave Um", origin: "culto", key: "k-1" });
    expect(k2.data.id).toBe(k1.data.id); expect(k2.data.repeated).toBe(true);
    const f = (await admin.api.rpc("convert_for_person", { p_person: pInt })).data;
    expect(f.items.length).toBeGreaterThanOrEqual(3);
  });
});

describe("histórico, acompanhamento e permissões", () => {
  let dec = "", dec2 = "";
  test("10. a decisão aparece no histórico da pessoa como acontecimento restrito, só para quem vê convertidos", async () => {
    const r = await reg(secretaria, { name: "Integrante", mode: "link", person_id: pInt, origin: "evento", place: "Congresso", decided_on: "2026-10-10" });
    dec = r.data.id;
    const t = (await timeline(admin, pInt)).filter((x: any) => x.kind === "decision");
    expect(t.length).toBeGreaterThan(0); expect(t[0].category).toBe("decisao"); expect(t[0].title).toBe("Decisão de fé registrada");
    expect((await timeline(secretaria, pInt)).some((x: any) => x.kind === "decision")).toBe(true);
    // grant só de pessoas (sem convertidos): não vê a decisão
    await admin.api.rpc("grant_set", { p_org: org, p_user: dev.id, p_role: "secretary", p_network: null, p_title: "Sec", p_actions: ["people_view", "people_edit"] });
    expect((await timeline(dev, pInt)).some((x: any) => x.kind === "decision")).toBe(false);
    const direct = await dev.api.get(`/person_history?person_id=eq.${pInt}&kind=eq.decision&select=id`);
    expect((direct.data ?? []).length).toBe(0);
  });
  test("11. atribuir responsável autorizado; responsável sem permissão é recusado; avisa o responsável sem expor nome", async () => {
    expect(msg(await secretaria.api.rpc("convert_assign", { p_id: dec, p_user: integrante.id }))).toContain("invalid_responsible");
    expect((await secretaria.api.rpc("convert_assign", { p_id: dec, p_user: resp.id })).data.ok).toBe(true);
    const n = await notifs(resp);
    expect(n.some((x) => x.link === `#/novos-convertidos/${dec}`)).toBe(true);
    expect(JSON.stringify(n)).not.toContain("Integrante");
    expect((await get(resp, dec)).data.responsible_id).toBe(resp.id);
  });
  test("12. responsável registra acompanhamento só com contato autorizado; sem etapas obrigatórias", async () => {
    expect((await resp.api.rpc("convert_followup_status", { p_id: dec, p_action: "start", p_note: null })).data.fu_status).toBe("in_progress");
    expect(msg(await resp.api.rpc("convert_entry_add", { p_id: dec, p_kind: "contact", p_body: "Liguei", p_on: null, p_channel: "phone" }))).toContain("contact_not_authorized");
    expect((await resp.api.rpc("convert_entry_add", { p_id: dec, p_kind: "note", p_body: "Pediu um estudo bíblico", p_on: null, p_channel: null })).data.ok).toBe(true);
    expect((await resp.api.rpc("convert_entry_add", { p_id: dec, p_kind: "interest", p_body: "Interesse em célula", p_on: null, p_channel: null })).data.ok).toBe(true);
    await secretaria.api.rpc("convert_update", { p_id: dec, p: { consent: "authorized", phone: "11977776666" }, p_reason: null });
    expect((await resp.api.rpc("convert_entry_add", { p_id: dec, p_kind: "contact", p_body: "Conversamos", p_on: null, p_channel: "whatsapp" })).data.ok).toBe(true);
    const d = (await get(resp, dec)).data;
    expect(d.entries.length).toBe(3); expect(d.phone).toBe("11977776666");
  });
  test("13. encerrar ou suspender o acompanhamento não apaga a decisão nem o histórico", async () => {
    expect((await resp.api.rpc("convert_followup_status", { p_id: dec, p_action: "suspend", p_note: null })).data.fu_status).toBe("suspended");
    expect((await resp.api.rpc("convert_followup_status", { p_id: dec, p_action: "end", p_note: "Concluído" })).data.fu_status).toBe("ended");
    const d = (await get(admin, dec)).data;
    expect(d.fu_status).toBe("ended"); expect(d.entries.length).toBe(3);
    expect((await timeline(admin, pInt)).some((x: any) => x.kind === "decision")).toBe(true);
    expect((await list(admin)).data.items.some((i: any) => i.id === dec)).toBe(true);
    expect(msg(await resp.api.rpc("convert_followup_status", { p_id: dec, p_action: "bogus", p_note: null }))).toContain("invalid_action");
  });
  test("14. quem não tem permissão é bloqueado; ser de time não dá acesso; acompanhante só vê o que é seu", async () => {
    for (const u of [integrante, lider, semFicha, fora]) {
      expect(msg(await list(u))).toContain("forbidden");
      expect(msg(await reg(u, { name: "X", origin: "culto" }))).toContain("forbidden");
      expect(msg(await get(u, dec))).toContain("forbidden");
      expect(msg(await u.api.rpc("convert_indicators", { p_org: org, p_from: null, p_to: null }))).toContain("forbidden");
      expect(msg(await u.api.rpc("convert_void", { p_id: dec, p_reason: "tentativa" }))).toContain("forbidden");
    }
    const mine = (await list(resp)).data;
    expect(mine.scope).toBe("mine"); expect(mine.items.every((i: any) => i.responsible_id === resp.id)).toBe(true);
    const other = await reg(secretaria, { name: "Não Atribuída", origin: "culto" }); dec2 = other.data.id;
    expect(msg(await get(resp, dec2))).toContain("forbidden");
    expect(msg(await resp.api.rpc("convert_assign", { p_id: dec2, p_user: resp.id }))).toContain("forbidden");
    expect(msg(await resp.api.rpc("convert_entry_add", { p_id: dec2, p_kind: "note", p_body: "x", p_on: null, p_channel: null }))).toContain("forbidden");
    expect(msg(await secretaria.api.rpc("convert_void", { p_id: dec2, p_reason: "sem permissão admin" }))).toContain("forbidden");
    expect(msg(await anon.rpc("convert_list", { p_org: org, p: {} }))).not.toBe("");
    const raw = await secretaria.api.get("/faith_decisions?select=id");
    expect(raw.ok === false || (raw.data ?? []).length === 0).toBe(true);
  });
  test("15. correção exige motivo para data/nome, guarda auditoria; exclusão só administrativa e justificada", async () => {
    expect(msg(await secretaria.api.rpc("convert_update", { p_id: dec2, p: { decided_on: "2026-01-05" }, p_reason: null }))).toContain("reason_required");
    expect((await secretaria.api.rpc("convert_update", { p_id: dec2, p: { decided_on: "2026-01-05", place: "Retificado" }, p_reason: "Data informada errada" })).data.changed).toBe(true);
    const d = (await get(admin, dec2)).data;
    expect(d.log.some((l: any) => l.action === "update" && l.detail.reason === "Data informada errada")).toBe(true);
    expect(msg(await admin.api.rpc("convert_void", { p_id: dec2, p_reason: "x" }))).toContain("reason_required");
    expect((await admin.api.rpc("convert_void", { p_id: dec2, p_reason: "Registro duplicado por engano" })).data.ok).toBe(true);
    expect((await list(admin)).data.items.some((i: any) => i.id === dec2)).toBe(false);
    const sk = await serviceKey();
    const lg = await (await fetch(`${REST}/faith_decision_log?decision_id=eq.${dec2}&select=action,detail&order=id`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json();
    expect(lg.map((x: any) => x.action)).toEqual(["register", "update", "void"]);
  });
  test("16. listagem filtra e busca, e indicadores contam registros reais", async () => {
    const q = (await list(secretaria, { q: "joão" })).data.items;
    expect(q.length).toBeGreaterThan(0); expect(q.every((i: any) => i.name.toLowerCase().includes("joão"))).toBe(true);
    expect((await list(secretaria, { origin: "evangelismo" })).data.items.every((i: any) => i.origin === "evangelismo")).toBe(true);
    expect((await list(secretaria, { status: "awaiting" })).data.items.every((i: any) => i.awaiting_link)).toBe(true);
    expect((await list(secretaria, { from: "2026-10-01", to: "2026-11-30" })).data.items.every((i: any) => i.decided_on >= "2026-10-01" && i.decided_on <= "2026-11-30")).toBe(true);
    expect((await list(secretaria, { no_contact: true })).data.items.every((i: any) => !i.has_contact)).toBe(true);
    expect((await list(secretaria, { responsible: resp.id })).data.items.every((i: any) => i.responsible_id === resp.id)).toBe(true);
    const ind = (await secretaria.api.rpc("convert_indicators", { p_org: org, p_from: null, p_to: null })).data;
    const all = (await list(secretaria, { limit: 100 })).data;
    expect(ind.total).toBe(all.total);
    expect(ind.people).toBeLessThan(ind.total);   // Integrante tem várias decisões: pessoas distintas < decisões
    expect(ind.by_origin.reduce((s: number, x: any) => s + x.n, 0)).toBe(ind.total);
    expect(ind.by_month.reduce((s: number, x: any) => s + x.n, 0)).toBe(ind.total);
    expect(ind.awaiting_link).toBe(all.items.filter((i: any) => i.awaiting_link).length);
    expect(ind.followup_accepted).toBeGreaterThan(0);
    expect(msg(await admin.api.rpc("convert_indicators", { p_org: org, p_from: null, p_to: null }))).toBe("");
  });
});

describe("formulários, notificações e integridade", () => {
  test("17. formulário no app: confirma identidade, vincula à ficha, sem duplicar e sem conta nova", async () => {
    expect(msg(await integrante.api.rpc("convert_self_submit", { p_org: org, p: { origin: "culto", decided_on: "2026-11-20", consent: "authorized", phone: "11955554444" } }))).toContain("confirm_identity");
    const info = (await integrante.api.rpc("convert_self_get", { p_org: org })).data;
    expect(info.person.id).toBe(pInt);
    const r = await integrante.api.rpc("convert_self_submit", { p_org: org, p: { origin: "culto", decided_on: "2026-11-20", consent: "authorized", phone: "11955554444", confirm_identity: true, wants_followup: true } });
    expect(r.data.ok).toBe(true);
    const again = await integrante.api.rpc("convert_self_submit", { p_org: org, p: { origin: "culto", decided_on: "2026-11-20", confirm_identity: true } });
    expect(again.data.repeated).toBe(true);
    const d = (await get(secretaria, r.data.id)).data;
    expect(d.source).toBe("app"); expect(d.person.id).toBe(pInt); expect(d.fu_status).toBe("offered");
    // sem ficha: aguarda associação, não cria ficha nem vincula sozinho
    const s = await semFicha.api.rpc("convert_self_submit", { p_org: org, p: { origin: "outro", decided_on: "2026-11-21" } });
    expect(s.data.ok).toBe(true);
    expect((await get(secretaria, s.data.id)).data.awaiting_link).toBe(true);
    expect(msg(await fora.api.rpc("convert_self_submit", { p_org: org, p: { origin: "culto" } }))).toContain("forbidden");
  });
  test("18. formulário público: só ativo com token, não devolve nada, honeypot, sem duplicar, aguarda associação", async () => {
    expect(msg(await secretaria.api.rpc("convert_settings_get", { p_org: org }))).toContain("forbidden");
    const s = (await admin.api.rpc("convert_settings_get", { p_org: org })).data; token = s.form_token;
    expect((await anon.rpc("convert_public_get", { p_token: token })).data).toBeNull();
    expect(msg(await anon.rpc("convert_public_submit", { p_token: token, p: { name: "Visitante Online", origin: "transmissao" } }))).toContain("form_closed");
    await admin.api.rpc("convert_settings_save", { p_org: org, p: { form_active: true, form_title: "Decidi seguir a Jesus" } });
    expect((await anon.rpc("convert_public_get", { p_token: token })).data.title).toBe("Decidi seguir a Jesus");
    const before = (await list(secretaria, { limit: 100 })).data.total;
    const r = await anon.rpc("convert_public_submit", { p_token: token, p: { name: "Visitante Online", origin: "transmissao", phone: "21966665555", consent: "authorized", wants_followup: true, place: "Casa" } });
    expect(r.data).toEqual({ ok: true });
    const again = await anon.rpc("convert_public_submit", { p_token: token, p: { name: "Visitante Online", origin: "transmissao" } });
    expect(again.data).toEqual({ ok: true });
    expect((await anon.rpc("convert_public_submit", { p_token: token, p: { name: "Robô", website: "x" } })).data).toEqual({ ok: true });
    expect((await list(secretaria, { limit: 100 })).data.total).toBe(before + 1);
    const it = (await list(secretaria, { q: "Visitante Online" })).data.items[0];
    expect(it.awaiting_link).toBe(true); expect(it.source).toBe("public_form");
    expect(msg(await anon.rpc("convert_public_submit", { p_token: token, p: { name: "A", origin: "culto", decided_on: "2999-01-01" } }))).toContain("invalid_date");
    expect(msg(await anon.rpc("convert_public_submit", { p_token: token, p: { name: "A", email: "ruim" } }))).toContain("invalid_email");
    expect(msg(await anon.rpc("convert_public_submit", { p_token: "token-errado", p: { name: "A" } }))).toContain("form_closed");
    expect(msg(await anon.rpc("convert_candidates", { p_org: org, p_name: "x", p_phone: null, p_email: null }))).not.toBe("");
    await admin.api.rpc("convert_settings_save", { p_org: org, p: { form_active: false } });
    expect(msg(await anon.rpc("convert_public_submit", { p_token: token, p: { name: "Fechado" } }))).toContain("form_closed");
  });
  test("19. notificações: nova decisão, aguardando associação, pedido de acompanhamento; sem nomes e sem avisar quem registrou", async () => {
    const n = await notifs(admin);
    const titles = n.map((x) => x.title);
    expect(titles).toContain("Decisão de fé aguardando associação");
    expect(titles).toContain("Nova decisão de fé registrada");
    expect(titles).toContain("Uma pessoa pediu acompanhamento");
    expect(JSON.stringify(n)).not.toMatch(/Maria da Silva|João|Visitante Online/);
    const mineSec = (await notifs(secretaria)).map((x) => x.title);
    expect(mineSec.length).toBeGreaterThan(0);   // recebe as que outros geraram (formulários)
  });
  test("20. integridade: nenhuma duplicidade criada, classificações intactas e demais módulos funcionando", async () => {
    const dupe = (await admin.api.get(`/people?org_id=eq.${org}&full_name=eq.Maria da Silva&select=id`)).data;
    expect(dupe.length).toBe(0);                                   // decisão aguardando nunca cria ficha sozinha
    const cls = (await admin.api.get(`/people?org_id=eq.${org}&select=classification,source`)).data as any[];
    expect(cls.filter((p) => p.classification === "none").length).toBeGreaterThan(0);
    expect((await person(pInt, "classification")).classification).toBe("attender");
    const sv = await secretaria.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Cadastro Normal", classification: "visitor" } }, false);
    expect(sv.data.saved).toBe(true);
    expect((await secretaria.api.rpc("person_timeline", { p_person: sv.data.id, p_categories: null, p_origin: null, p_from: null, p_to: null, p_by: null, p_limit: 20, p_offset: 0 })).data.items.length).toBeGreaterThan(0);
    const acc = (await admin.api.rpc("my_access", { p_org: org })).data;
    expect(JSON.stringify(acc)).toContain("people_converts_view");
    expect((await admin.api.get(`/teams?org_id=eq.${org}&select=id`)).data.length).toBe(1);
    const sk = await serviceKey();
    const j = await (await fetch(`${REST}/rpc/all_actions`, { method: "POST", headers: { Authorization: `Bearer ${sk}`, apikey: sk, "Content-Type": "application/json" }, body: "{}" })).json();
    expect(j).toContain("people_converts_admin");
  });
});
