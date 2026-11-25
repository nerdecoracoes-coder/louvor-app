// Recurso 09: Solicitações de contato (formulário, central, status, encaminhamento, interações, confidencialidade, ficha, permissões).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, anonKey, REST, Api } from "./helpers";

let admin: any, gestor: any, atend: any, pastor: any, semPerm: any, lider: any, membro: any, visitante: any, fora: any, anon: Api;
let org = "", pM = "", pOther = "", cats: any[] = [], tok = "";
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const body = (o: any = {}) => ({ name: "Maria Teste", phone: "(21) 99999-1111", email: "maria@teste.com", category_id: cats[0].id, message: "Gostaria de conversar com um pastor.", pref: "whatsapp", consent: true, ...o });
const send = (u: any, o: any = {}) => rpc(u, "contact_submit", { p_org: org, p: body(o) });
const get = async (u: any, id: string) => (await rpc(u, "contact_get", { p_id: id })).data;
const list = async (u: any, p: any = {}) => (await rpc(u, "contact_list", { p_org: org, p })).data;
const st = (u: any, id: string, s: string, r: string | null = null) => rpc(u, "contact_status", { p_id: id, p_status: s, p_reason: r });
const notifs = async (u: any) => (await u.api.get(`/notifications?user_id=eq.${u.id}&kind=eq.contact&select=title,body,link&order=created_at`)).data as any[];
const timeline = async (u: any, id: string) => (await u.api.rpc("person_timeline", { p_person: id, p_categories: null, p_origin: null, p_from: null, p_to: null, p_by: null, p_limit: 100, p_offset: 0 })).data;
let R1 = "", R2 = "", R3 = "";

beforeAll(async () => {
  [admin, gestor, atend, pastor, semPerm, lider, membro, visitante, fora] = await Promise.all(["Admin", "Gestor", "Atend", "Pastor", "SemPerm", "Lider", "Membro", "Visitante", "Fora"].map(newUser));
  anon = new Api(await anonKey());
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Contatos" })).data;
  await joinChurch(admin.api, org, gestor, atend, pastor, semPerm, lider, membro, visitante);
  const grant = (u: any, title: string, actions: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: title, p_actions: actions });
  await grant(gestor, "Gestor", ["people_view", "people_edit", "people_care", "people_contacts_view", "people_contacts_manage", "people_contacts_assign", "people_contacts_categories", "people_contacts_reopen", "people_contacts_cancel"]);
  await grant(atend, "Atend", ["people_contacts_assigned", "people_contacts_manage"]);
  await grant(pastor, "Pastor", ["people_contacts_view", "people_contacts_manage", "people_contacts_confidential"]);
  const t = (await admin.api.post("teams", { org_id: org, name: "Acolhimento", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: t, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${t}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [membro.id], p_classification: "member" });
  pM = (await admin.api.get(`/people?user_id=eq.${membro.id}&select=id`)).data[0].id;
  pOther = (await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Pessoa Sem Conta", classification: "visitor" } })).data.id;
  cats = (await rpc(visitante, "contact_self_get", { p_org: org })).data.categories;
});

describe("formulário (SOMOS Um)", () => {
  test("categorias iniciais vêm do banco e o formulário vem preenchido", async () => {
    expect(cats.map((c) => c.name)).toEqual(["Conversar com um pastor", "Orientação espiritual", "Aconselhamento familiar", "Dificuldades pessoais", "Informações sobre a igreja", "Quero participar de um ministério", "Quero conhecer melhor a igreja", "Outros assuntos"]);
    const g = (await rpc(membro, "contact_self_get", { p_org: org })).data;
    expect(g.has_person).toBe(true); expect(g.name).toBeTruthy(); expect(g.consent_text.length).toBeGreaterThan(10); expect(g.intro).toContain("caminhar com você");
    expect((await rpc(visitante, "contact_self_get", { p_org: org })).data.has_person).toBe(false);
  });
  test("envio autenticado com ficha: vincula a pessoa, gera código e confirma por notificação", async () => {
    const r = await send(membro); expect(r.data.code).toMatch(/^CT-\d{5}$/); expect(r.data.repeated).toBe(false); R1 = r.data.id;
    const g = await get(admin, R1); expect(g.status).toBe("received"); expect(g.person.id).toBe(pM); expect(g.has_account).toBe(true); expect(g.consent_version).toBe(1); expect(g.consent_purpose).toBeTruthy(); expect(g.consent_at).toBeTruthy();
    const n = await notifs(membro); expect(n.length).toBe(1); expect(n[0].title).toContain(r.data.code);
  });
  test("envio sem cadastro completo (conta sem ficha) e envio de outra pessoa pela equipe", async () => {
    const r = await send(visitante, { name: "Visitante Sem Ficha", message: "Quero conhecer a igreja", category_id: cats[6].id, pref: "email", phone: "" }); R2 = r.data.id;
    const g = await get(admin, R2); expect(g.person).toBeNull(); expect(g.pref).toBe("email"); expect(g.phone).toBeNull();
    const c = await rpc(gestor, "contact_create", { p_org: org, p: body({ name: "Por telefone", category_id: cats[4].id }) }); expect(c.data.code).toBeTruthy();
    expect((await get(admin, c.data.id)).source).toBe("admin");
    expect(msg(await rpc(semPerm, "contact_create", { p_org: org, p: body() }))).toContain("forbidden");
  });
  test("validação dos campos e consentimento", async () => {
    expect(msg(await send(membro, { name: "" }))).toContain("name_required");
    expect(msg(await send(membro, { phone: "", email: "" }))).toContain("contact_required");
    expect(msg(await send(membro, { phone: "12" }))).toContain("invalid_phone");
    expect(msg(await send(membro, { email: "x@" }))).toContain("invalid_email");
    expect(msg(await send(membro, { phone: "", pref: "whatsapp" }))).toContain("pref_needs_phone");
    expect(msg(await send(membro, { email: "", pref: "email" }))).toContain("pref_needs_email");
    expect(msg(await send(membro, { pref: "other", pref_other: "x" }))).toContain("pref_other_required");
    expect(msg(await send(membro, { message: "  " }))).toContain("message_required");
    expect(msg(await send(membro, { message: "x".repeat(2001) }))).toContain("message_too_long");
    expect(msg(await send(membro, { consent: false }))).toContain("consent_required");
    expect(msg(await send(membro, { consent: undefined }))).toContain("consent_required");
    expect(msg(await send(membro, { category_id: "00000000-0000-0000-0000-000000000000" }))).toContain("invalid_category");
    expect(msg(await rpc(fora, "contact_submit", { p_org: org, p: body() }))).toContain("forbidden");
    expect(msg(await rpc(fora, "contact_self_get", { p_org: org }))).toContain("forbidden");
  });
  test("envio duplicado (mesma chave ou mesmo conteúdo) não cria outra solicitação", async () => {
    const a = await send(visitante, { key: "k-1", message: "Pedido com chave" }); const b = await send(visitante, { key: "k-1", message: "Pedido com chave" });
    expect(b.data.repeated).toBe(true); expect(b.data.id).toBe(a.data.id);
    const c = await send(visitante, { message: "Mesmo texto repetido" }); const d = await send(visitante, { message: "Mesmo texto repetido" }); expect(d.data.repeated).toBe(true); expect(d.data.id).toBe(c.data.id);
    expect((await rows(`contact_requests?org_id=eq.${org}&message=eq.Pedido%20com%20chave&select=id`)).length).toBe(1);
    const par = await Promise.all([send(visitante, { key: "k-2", message: "Corrida" }), send(visitante, { key: "k-2", message: "Corrida" })]);
    expect(par[0].data.id).toBe(par[1].data.id); expect((await rows(`contact_requests?org_id=eq.${org}&op_key=eq.k-2&select=id`)).length).toBe(1);
  });
  test("link público: fechado por padrão, aberto pelo administrador, anônimo envia, robô é ignorado", async () => {
    const s = (await rpc(gestor, "contact_settings_get", { p_org: org })).data; tok = s.form_token; expect(s.form_active).toBe(false);
    expect(msg(await anon.rpc("contact_public_submit", { p_token: tok, p: body() }))).toContain("form_closed");
    expect((await anon.rpc("contact_public_get", { p_token: tok })).data).toBeNull();
    await rpc(gestor, "contact_settings_save", { p_org: org, p: { form_active: true } });
    const pg = (await anon.rpc("contact_public_get", { p_token: tok })).data; expect(pg.categories.length).toBe(8); expect(pg.org_name).toBe("Igreja Contatos");
    const r = await anon.rpc("contact_public_submit", { p_token: tok, p: body({ name: "Anônimo Link", message: "Pelo link público" }) }); expect(r.data.ok).toBe(true);
    const row = (await rows(`contact_requests?org_id=eq.${org}&code=eq.${r.data.code}&select=source,user_id,person_id`))[0]; expect(row.source).toBe("public_form"); expect(row.user_id).toBeNull(); R3 = (await rows(`contact_requests?org_id=eq.${org}&code=eq.${r.data.code}&select=id`))[0].id;
    const bot = await anon.rpc("contact_public_submit", { p_token: tok, p: body({ website: "http://spam" }) }); expect(bot.data.ok).toBe(true);
    expect((await rows(`contact_requests?org_id=eq.${org}&name=eq.Maria%20Teste&source=eq.public_form&select=id`)).length).toBe(0);
    expect(msg(await anon.rpc("contact_public_submit", { p_token: "errado", p: body() }))).toContain("form_closed");
    expect(msg(await anon.rpc("contact_list", { p_org: org, p: {} }))).not.toBe("");
  });
});

describe("central (SOMOS Chamados)", () => {
  test("listagem, indicadores reais, pesquisa, filtros, ordenação e paginação", async () => {
    const l = await list(gestor); expect(l.total).toBe(l.indicators.total); expect(l.indicators.received).toBe(l.total); expect(l.items.length).toBeGreaterThan(3);
    expect((await list(gestor, { q: "Anônimo" })).items.map((i: any) => i.name)).toEqual(["Anônimo Link"]);
    const code = (await get(admin, R1)).code; expect((await list(gestor, { q: code })).items[0].id).toBe(R1);
    expect((await list(gestor, { category: cats[6].id })).items.every((i: any) => i.category === cats[6].name)).toBe(true);
    expect((await list(gestor, { status: "completed" })).total).toBe(0);
    expect((await list(gestor, { responsible: "none" })).total).toBe(l.total);
    expect((await list(gestor, { from: "2099-01-01" })).total).toBe(0);
    const a = await list(gestor, { order: "asc", limit: 2 }); const d = await list(gestor, { order: "desc", limit: 2 });
    expect(a.items.length).toBe(2); expect(new Date(a.items[0].created_at) <= new Date(a.items[1].created_at)).toBe(true); expect(a.items[0].id).not.toBe(d.items[0].id);
    expect((await list(gestor, { limit: 2, offset: 2 })).items[0].id).not.toBe((await list(gestor, { limit: 2 })).items[0].id);
    expect(msg(await rpc(gestor, "contact_list", { p_org: org, p: { status: "zzz" } }))).toContain("invalid_filter");
  });
  test("segurança: sem permissão, líder de time e outra igreja não veem nada; ID alheio é recusado", async () => {
    for (const u of [semPerm, lider, membro, fora]) { expect(msg(await rpc(u, "contact_list", { p_org: org, p: {} }))).toContain("forbidden"); expect(msg(await rpc(u, "contact_get", { p_id: R1 }))).toContain("forbidden"); }
    expect(msg(await rpc(membro, "contact_status", { p_id: R1, p_status: "review" }))).toContain("forbidden");
    expect(msg(await rpc(membro, "contact_interaction_add", { p_id: R1, p: { kind: "call", description: "x" } }))).toContain("forbidden");
    expect(msg(await rpc(membro, "contact_note_add", { p_id: R1, p_body: "x" }))).toContain("forbidden");
    expect(msg(await rpc(membro, "contact_assign", { p_id: R1, p: { user_id: atend.id } }))).toContain("forbidden");
    expect(msg(await rpc(gestor, "contact_get", { p_id: "00000000-0000-0000-0000-000000000000" }))).toContain("not_found");
    expect((await rows(`contact_requests?select=id`)).length).toBeGreaterThan(0);
    expect((await membro.api.get("/contact_requests?select=id")).status).toBeGreaterThanOrEqual(400);   // tabela só por função
  });
  test("o próprio solicitante vê só os seus pedidos, sem dados da equipe", async () => {
    const m = (await rpc(membro, "contact_mine", { p_org: org })).data; expect(m.length).toBe(1); expect(m[0].status).toBe("received"); expect(m[0].status_label).toBe("Recebida");
    expect(Object.keys(m[0])).not.toContain("responsible_id"); expect(Object.keys(m[0])).not.toContain("message");
    expect((await rpc(visitante, "contact_mine", { p_org: org })).data.every((x: any) => x.code !== m[0].code)).toBe(true);
  });
  test("fluxo de status: transições, justificativa, cancelamento, conclusão sem alteração silenciosa e reabertura autorizada", async () => {
    expect(msg(await st(gestor, R1, "received"))).toContain("same_status");
    expect(msg(await st(gestor, R1, "zzz"))).toContain("invalid_status");
    expect((await st(gestor, R1, "review")).data.status).toBe("review");
    expect(msg(await st(gestor, R1, "received"))).toContain("invalid_transition");
    expect(msg(await st(gestor, R1, "cancelled"))).toContain("reason_required");
    expect(msg(await st(pastor, R1, "cancelled", "motivo válido"))).toContain("forbidden");   // sem permissão de cancelar
    expect((await st(gestor, R1, "in_progress")).data.status).toBe("in_progress");
    expect((await st(gestor, R1, "waiting", "aguardando a pessoa")).data.status).toBe("waiting");
    const done = await st(gestor, R1, "completed"); expect(done.data.status).toBe("completed");
    let g = await get(gestor, R1); expect(g.completed_at).toBeTruthy(); expect(g.next).toEqual([]);
    expect(msg(await st(gestor, R1, "in_progress"))).toContain("reopen_first");
    expect(msg(await st(pastor, R1, "review", "reabrir"))).toContain("forbidden");
    expect(msg(await rpc(gestor, "contact_interaction_add", { p_id: R1, p: { kind: "call", description: "x" } }))).toContain("request_closed");
    expect(msg(await rpc(gestor, "contact_update", { p_id: R1, p: { name: "Outro" } }))).toContain("request_closed");
    expect(msg(await rpc(gestor, "contact_assign", { p_id: R1, p: { user_id: atend.id } }))).toContain("request_closed");
    expect(msg(await st(gestor, R1, "review"))).toContain("reason_required");
    expect((await st(gestor, R1, "review", "pessoa voltou a pedir")).data.status).toBe("review");
    g = await get(gestor, R1); expect(g.completed_at).toBeNull();
    expect(g.log.filter((l: any) => l.action === "status").map((l: any) => `${l.from}>${l.to}`).reverse()).toEqual(["received>review", "review>in_progress", "in_progress>waiting", "waiting>completed"]);
    expect(g.log.some((l: any) => l.action === "reopen" && l.detail.reason === "pessoa voltou a pedir" && l.by === "Gestor")).toBe(true);
    const c = await st(gestor, R2, "cancelled", "pedido duplicado"); expect(c.data.status).toBe("cancelled");
    g = await get(gestor, R2); expect(g.cancel_reason).toBe("pedido duplicado"); expect((await list(gestor, { status: "cancelled" })).total).toBe(1);   // cancelada continua registrada
    expect(msg(await st(gestor, R2, "review", "x"))).toContain("reason_required");
    const n = await notifs(visitante); expect(n.some((x: any) => x.title.includes("encerrada"))).toBe(true);
    expect((await notifs(membro)).some((x: any) => x.title.includes("concluída"))).toBe(true);
  });
  test("responsável, encaminhamento a equipe, transferência, retirada e histórico", async () => {
    const rr = (await rpc(gestor, "contact_responsibles", { p_org: org })).data; expect(rr.users.map((u: any) => u.user_id)).toContain(atend.id); expect(rr.users.map((u: any) => u.user_id)).not.toContain(semPerm.id); expect(rr.teams.length).toBe(1);
    expect(msg(await rpc(gestor, "contact_assign", { p_id: R3, p: { user_id: semPerm.id } }))).toContain("invalid_responsible");
    expect(msg(await rpc(gestor, "contact_assign", { p_id: R3, p: {} }))).toContain("no_change");
    expect(msg(await rpc(atend, "contact_assign", { p_id: R3, p: { user_id: pastor.id } }))).toContain("forbidden");
    expect(msg(await rpc(pastor, "contact_assign", { p_id: R3, p: { user_id: pastor.id } }))).toContain("forbidden");   // sem permissão de atribuir
    await rpc(gestor, "contact_assign", { p_id: R3, p: { user_id: atend.id, note: "cuide, por favor" } });
    let g = await get(gestor, R3); expect(g.responsible_id).toBe(atend.id); expect(g.status).toBe("forwarded");
    expect((await notifs(atend)).some((x: any) => x.title.includes("atribuída"))).toBe(true);
    expect((await notifs(atend))[0].body).toBeNull();   // o aviso nunca leva o conteúdo
    const team = (await rpc(gestor, "contact_responsibles", { p_org: org })).data.teams[0].id;
    await rpc(gestor, "contact_assign", { p_id: R3, p: { team_id: team } });
    await rpc(gestor, "contact_assign", { p_id: R3, p: { user_id: pastor.id } });
    expect((await notifs(pastor)).some((x: any) => x.title.includes("transferida"))).toBe(true);
    g = await get(gestor, R3); expect(g.team_name).toBe("Acolhimento");
    expect(g.log.filter((l: any) => ["assign", "transfer", "team"].includes(l.action)).map((l: any) => l.action).reverse()).toEqual(["assign", "team", "transfer"]);
    await rpc(gestor, "contact_assign", { p_id: R3, p: { user_id: null, team_id: null } });
    g = await get(gestor, R3); expect(g.responsible_id).toBeNull(); expect(g.team_id).toBeNull(); expect(g.log.some((l: any) => l.action === "unassign")).toBe(true);
  });
  test("escopo limitado: quem só vê as atribuídas enxerga apenas as suas", async () => {
    expect((await list(atend)).total).toBe(0); expect(msg(await rpc(atend, "contact_get", { p_id: R3 }))).toContain("forbidden");
    await rpc(gestor, "contact_assign", { p_id: R3, p: { user_id: atend.id } });
    const l = await list(atend); expect(l.total).toBe(1); expect(l.view_all).toBe(false); expect(l.indicators.total).toBe(1);
    expect((await get(atend, R3)).id).toBe(R3); expect(msg(await rpc(atend, "contact_get", { p_id: R1 }))).toContain("forbidden");
    expect(msg(await st(atend, R1, "review", "x"))).toContain("forbidden");
  });
  test("registro de interações e edição operacional (a mensagem original não muda)", async () => {
    const r = await rpc(atend, "contact_interaction_add", { p_id: R3, p: { kind: "call", description: "Liguei, não atendeu", result: "Sem resposta" } }); expect(r.data.saved).toBe(true);
    await rpc(atend, "contact_interaction_add", { p_id: R3, p: { kind: "reply", description: "Retornou por mensagem" } });
    expect(msg(await rpc(atend, "contact_interaction_add", { p_id: R3, p: { kind: "xx", description: "x" } }))).toContain("invalid_kind");
    expect(msg(await rpc(atend, "contact_interaction_add", { p_id: R3, p: { kind: "call", description: " " } }))).toContain("description_required");
    expect(msg(await rpc(atend, "contact_interaction_add", { p_id: R3, p: { kind: "call", description: "x", at: "2099-01-01T00:00:00Z" } }))).toContain("invalid_date");
    const g = await get(atend, R3); expect(g.interactions.map((i: any) => i.kind)).toEqual(expect.arrayContaining(["call", "reply"])); expect(g.interactions.find((i: any) => i.kind === "call").by).toBe("Atend");
    { const u = await rpc(atend, "contact_update", { p_id: R3, p: { phone: "(21) 98888-2222" } }); if (!u.data?.saved) console.log("UPD", JSON.stringify(u.data)); expect(u.data.saved).toBe(true); }
    const g2 = await get(atend, R3); expect(g2.phone).toBe("(21) 98888-2222"); expect(g2.message).toBe(g.message);
    expect(JSON.stringify(g2.log.find((l: any) => l.action === "edit").detail)).toContain("telefone"); expect(JSON.stringify(g2.log)).not.toContain("98888");
    expect(msg(await rpc(atend, "contact_update", { p_id: R3, p: { phone: "1" } }))).toContain("invalid_phone");
    expect((await rpc(atend, "contact_update", { p_id: R3, p: { name: g2.name } })).data.saved).toBe(false);
  });
  test("observações confidenciais: só com permissão específica, fora do histórico geral", async () => {
    expect(msg(await rpc(gestor, "contact_note_add", { p_id: R3, p_body: "segredo" }))).toContain("forbidden");
    expect(msg(await rpc(admin, "contact_note_add", { p_id: R3, p_body: " " }))).toContain("note_required");
    expect((await rpc(pastor, "contact_note_add", { p_id: R3, p_body: "Situação delicada na família" })).data.saved).toBe(true);
    const gp = await get(pastor, R3); expect(gp.notes.length).toBe(1); expect(gp.can_confidential).toBe(true); expect(gp.log.some((l: any) => l.action === "notes_read")).toBe(true);
    for (const u of [gestor, atend]) { const g = await get(u, R3); expect(g.notes).toEqual([]); expect(g.can_confidential).toBe(false); expect(JSON.stringify(g)).not.toContain("delicada"); expect(g.log.some((l: any) => l.restricted)).toBe(false); }
    const ga = await get(admin, R3); expect(ga.notes.length).toBe(1);
    expect(JSON.stringify((await rows(`contact_log?request_id=eq.${R3}&select=detail`)))).not.toContain("delicada");
  });
});

describe("integrações", () => {
  test("associação posterior à ficha: mantém histórico, aparece na linha do tempo só para quem pode ver, sem vazar a mensagem", async () => {
    expect(msg(await rpc(semPerm, "contact_link", { p_id: R3, p_person: pOther }))).toContain("forbidden");
    expect(msg(await rpc(atend, "contact_link", { p_id: R3, p_person: "00000000-0000-0000-0000-000000000000" }))).toContain("person_not_found");
    const before = await get(gestor, R3);
    expect((await rpc(atend, "contact_link", { p_id: R3, p_person: pOther })).data.saved).toBe(true);
    expect(msg(await rpc(atend, "contact_link", { p_id: R3, p_person: pOther }))).toContain("already_linked");
    const g = await get(gestor, R3); expect(g.person.id).toBe(pOther); expect(g.message).toBe(before.message); expect(g.created_at).toBe(before.created_at);
    const tl = await timeline(gestor, pOther); const it = tl.items.find((i: any) => i.category === "contato"); expect(it).toBeTruthy(); expect(it.title).toContain("Solicitação de contato"); expect(JSON.stringify(it)).not.toContain("Pelo link público");
    const sec = await newUser("SecSemContato"); await joinChurch(admin.api, org, sec);
    await admin.api.rpc("grant_set", { p_org: org, p_user: sec.id, p_role: "secretary", p_network: null, p_title: "S", p_actions: ["people_view"] });
    expect((await timeline(sec, pOther)).items.some((i: any) => i.category === "contato")).toBe(false);
    const fp = (await rpc(gestor, "contact_for_person", { p_person: pOther })).data; expect(fp.allowed).toBe(true); expect(fp.items[0].id).toBe(R3);
    expect((await rpc(sec, "contact_for_person", { p_person: pOther })).data.allowed).toBe(false);
    expect((await rpc(atend, "contact_for_person", { p_person: pM })).data.items).toEqual([]);   // escopo: R1 não é dele
  });
  test("criar ficha a partir da solicitação só com permissão e sem duplicar quem já existe", async () => {
    const a = (await rpc(gestor, "contact_create", { p_org: org, p: body({ name: "Novo Contato", phone: "(21) 97777-0000", email: "novo@x.com", message: "Primeira vez" }) })).data.id;
    expect(msg(await rpc(atend, "contact_link", { p_id: a, p_person: null, p_create: true }))).toContain("forbidden");
    const r = await rpc(gestor, "contact_link", { p_id: a, p_person: null, p_create: true }); expect(r.data.saved).toBe(true);
    const pe = (await admin.api.get(`/people?id=eq.${r.data.person_id}&select=full_name,classification,user_id`)).data[0]; expect(pe.full_name).toBe("Novo Contato"); expect(pe.classification).toBe("none"); expect(pe.user_id).toBeNull();
    const b = (await rpc(gestor, "contact_create", { p_org: org, p: body({ name: "Novo Contato", phone: "(21) 97777-0000", message: "Outra vez" }) })).data.id;
    const d = await rpc(gestor, "contact_link", { p_id: b, p_person: null, p_create: true }); expect(d.data.saved).toBe(false); expect(d.data.candidates.length).toBe(1);
    expect((await admin.api.get(`/people?org_id=eq.${org}&full_name=eq.Novo%20Contato&select=id`)).data.length).toBe(1);
    const s = (await rpc(gestor, "contact_people_search", { p_org: org, p_q: "Novo" })).data; expect(s.length).toBe(1);
    expect(msg(await rpc(semPerm, "contact_people_search", { p_org: org, p_q: "Novo" }))).toContain("forbidden");
  });
  test("atendimento pastoral: reaproveita o registro existente, sem copiar a mensagem e sem duplicar", async () => {
    expect(msg(await rpc(gestor, "contact_to_care", { p_id: R2 }))).toContain("link_required");
    expect(msg(await rpc(atend, "contact_to_care", { p_id: R3 }))).toContain("forbidden");   // sem permissão pastoral
    expect((await rpc(gestor, "contact_to_care", { p_id: R3 })).data.saved).toBe(true);
    expect(msg(await rpc(gestor, "contact_to_care", { p_id: R3 }))).toContain("already_started");
    const care = (await admin.api.rpc("care_list", { p_person: pOther })).data; expect(care.length).toBe(1); expect(care[0].note).toContain((await get(gestor, R3)).code); expect(care[0].note).not.toContain("Pelo link público");
    expect((await get(gestor, R3)).can_care).toBe(false);
  });
  test("categorias configuráveis: criar, editar, ordenar, desativar e encaminhar por categoria", async () => {
    expect(msg(await rpc(atend, "contact_settings_get", { p_org: org }))).toContain("forbidden");
    expect(msg(await rpc(gestor, "contact_category_save", { p_org: org, p_id: null, p: { name: "" } }))).toContain("name_required");
    expect(msg(await rpc(gestor, "contact_category_save", { p_org: org, p_id: null, p: { name: "X", default_user_id: semPerm.id } }))).toContain("invalid_responsible");
    const c = (await rpc(gestor, "contact_category_save", { p_org: org, p_id: null, p: { name: "Pedido de oração", description: "Intercessão", default_user_id: atend.id } })).data.id;
    let s = (await rpc(gestor, "contact_settings_get", { p_org: org })).data; expect(s.categories.at(-1).name).toBe("Pedido de oração");
    await rpc(gestor, "contact_category_move", { p_id: c, p_dir: -1 }); s = (await rpc(gestor, "contact_settings_get", { p_org: org })).data; expect(s.categories.at(-2).name).toBe("Pedido de oração");
    const r = await send(visitante, { category_id: c, message: "Orem por mim" }); const g = await get(admin, r.data.id); expect(g.responsible_id).toBe(atend.id); expect(g.status).toBe("received"); expect(g.log.some((l: any) => l.action === "route_default")).toBe(true);
    expect((await notifs(atend)).some((x: any) => x.title.includes("encaminhada a você"))).toBe(true);
    await rpc(gestor, "contact_category_save", { p_org: org, p_id: c, p: { name: "Oração", active: false } });
    expect((await rpc(visitante, "contact_self_get", { p_org: org })).data.categories.some((x: any) => x.id === c)).toBe(false);
    expect(msg(await send(visitante, { category_id: c, message: "Outra" }))).toContain("invalid_category");
    expect((await get(admin, r.data.id)).category).toBe("Pedido de oração");   // a solicitação guarda o nome da época
  });
  test("consentimento versionado e textos configuráveis", async () => {
    await rpc(gestor, "contact_settings_save", { p_org: org, p: { consent_text: "Novo texto de consentimento claro.", intro: "Nova apresentação", other_channel: "Instagram" } });
    const g = (await rpc(membro, "contact_self_get", { p_org: org })).data; expect(g.consent_version).toBe(2); expect(g.intro).toBe("Nova apresentação"); expect(g.other_channel).toBe("Instagram");
    const r = await send(membro, { pref: "other", pref_other: "@maria", message: "Canal alternativo" }); expect((await get(admin, r.data.id)).consent_version).toBe(2);
    expect((await get(admin, r.data.id)).pref_other).toBe("@maria");
    const old = await get(admin, R1); expect(old.consent_version).toBe(1);
    expect(msg(await rpc(semPerm, "contact_settings_save", { p_org: org, p: { intro: "x" } }))).toContain("forbidden");
  });
  test("notificações: equipe é avisada sem conteúdo, quem enviou não é avisado do próprio envio e nada é externo", async () => {
    const n = await notifs(pastor); expect(n.length).toBeGreaterThan(0); expect(n.every((x: any) => x.body === null)).toBe(true); expect(JSON.stringify(n)).not.toContain("conversar com um pastor");
    expect((await notifs(semPerm)).length).toBe(0); expect((await notifs(lider)).length).toBe(0);
  });
  test("módulos existentes continuam respondendo", async () => {
    expect((await admin.api.rpc("people_list", { p_org: org })).ok).toBe(true);
    expect((await admin.api.rpc("convert_list", { p_org: org, p: {} })).ok).toBe(true);
    expect((await admin.api.rpc("journey_list", { p_org: org, p: {} })).ok).toBe(true);
  });
});
