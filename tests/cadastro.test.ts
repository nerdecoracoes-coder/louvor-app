// Recurso 06: atualização cadastral pelo aplicativo (Meu Cadastro): campo direto, solicitação com aprovação por campo, conflito, histórico, notificações e permissões.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, secretaria: any, integrante: any, outro: any, lider: any, responsavel: any, estranho: any, aprovador: any, dev: any, fora: any;
let org = "", pInt = "", pOutro = "", pResp = "", filho = "";
const msg = (r: any) => String(r.data?.message ?? "");
const sub = (u: any, person: string, p: any, send = true) => u.api.rpc("registration_submit", { p_person: person, p, p_send: send });
const mine = async (u: any, person: string | null = null) => (await u.api.rpc("my_registration", { p_org: org, p_person: person })).data;
const list = async (u: any, f: any = {}) => (await u.api.rpc("registration_requests", { p_org: org, p_status: null, p_person: null, p_from: null, p_to: null, p_reviewer: null, p_limit: 50, p_offset: 0, ...f }));
const decide = (u: any, id: string, d: any[]) => u.api.rpc("registration_decide", { p_id: id, p_decisions: d });
const notifs = async (u: any) => (await u.api.get(`/notifications?user_id=eq.${u.id}&select=title,body,kind&order=created_at`)).data as any[];
const pid = async (u: any) => (await admin.api.get(`/people?user_id=eq.${u.id}&select=id`)).data[0].id;
const official = async (id: string, cols = "*") => (await admin.api.get(`/people?id=eq.${id}&select=${cols}`)).data[0];
const timeline = async (id: string) => (await admin.api.rpc("person_timeline", { p_person: id, p_categories: null, p_origin: null, p_from: null, p_to: null, p_by: null, p_limit: 100, p_offset: 0 })).data.items as any[];

beforeAll(async () => {
  [admin, secretaria, integrante, outro, lider, responsavel, estranho, aprovador, dev, fora] = await Promise.all(["Admin", "Secretaria", "Integrante", "Outro", "Lider", "Responsavel", "Estranho", "Aprovador", "Dev", "Fora"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Cadastro" })).data;
  await joinChurch(admin.api, org, secretaria, integrante, outro, lider, responsavel, estranho, aprovador, dev);
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria" });
  await admin.api.rpc("grant_set", { p_org: org, p_user: aprovador.id, p_role: "general_leader", p_network: null, p_title: "Aprovador", p_actions: ["people_view", "people_approve"] });
  const t = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: t, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${t}&user_id=eq.${lider.id}`, { is_leader: true });
  await secretaria.api.rpc("people_link_users", { p_org: org, p_user_ids: [integrante.id, outro.id, lider.id, responsavel.id, estranho.id, aprovador.id], p_classification: "member" });
  [pInt, pOutro, pResp] = await Promise.all([pid(integrante), pid(outro), pid(responsavel)]);
  filho = (await secretaria.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Filho Dependente", classification: "attender", birth_date: "2015-05-05" } })).data.id;
  await secretaria.api.rpc("guardian_add", { p_ward: filho, p_guardian: pResp, p_kind: "parental", p_note: null });
  const sk = await serviceKey();
  await fetch(`${REST}/people?id=eq.${pInt}`, { method: "PATCH", headers: { Authorization: `Bearer ${sk}`, apikey: sk, "Content-Type": "application/json" }, body: JSON.stringify({ admin_notes: "NOTA-INTERNA-SECRETA", phone: "11900000000", marital_status: "solteiro", address: "Rua Velha" }) });
});

describe("consulta e atualização direta", () => {
  test("1. a pessoa consulta o próprio cadastro, sem notas internas nem dados pastorais", async () => {
    const m = await mine(integrante);
    expect(m.role).toBe("self");
    expect(m.person.id).toBe(pInt); expect(m.person.phone).toBe("11900000000");
    expect(JSON.stringify(m)).not.toContain("NOTA-INTERNA-SECRETA");
    expect(Object.keys(m.person)).not.toContain("classification"); expect(Object.keys(m.person)).not.toContain("admin_notes");
    expect(m.policy.phone).toBe("direct"); expect(m.policy.marital_status).toBe("approval");
  });
  test("2. campo direto é salvo na hora, aparece no histórico e confirma o que foi aplicado", async () => {
    const r = (await sub(integrante, pInt, { phone: "11911112222", social_name: "Teté" })).data;
    expect(r.applied.sort()).toEqual(["phone", "social_name"]); expect(r.request_id).toBeNull();
    expect(await official(pInt, "phone,social_name")).toEqual({ phone: "11911112222", social_name: "Teté" });
    const h = (await timeline(pInt)).filter((x: any) => x.kind === "self_update");
    expect(h.length).toBeGreaterThan(0);
  });
  test("campos inválidos e bloqueados são recusados", async () => {
    expect(msg(await sub(integrante, pInt, { classification: "member" }))).toContain("field_locked");
    expect(msg(await sub(integrante, pInt, { admin_notes: "x" }))).toContain("field_locked");
    expect(msg(await sub(integrante, pInt, { email: "isso-nao-e-email" }))).toMatch(/email|invalid/);
    expect(msg(await sub(integrante, pInt, { state: "XYZ" }))).toMatch(/state|invalid|field_too_long/);
  });
});

let req1 = "", itens: any[] = [];
describe("solicitação com aprovação por campo", () => {
  test("3. campo com aprovação vira solicitação e o oficial não muda", async () => {
    const r = (await sub(integrante, pInt, { address: "Rua Nova", marital_status: "casado", city: "Santos" })).data;
    expect(r.pending.sort()).toEqual(["address", "city", "marital_status"]); req1 = r.request_id;
    expect(await official(pInt, "address,marital_status,city")).toMatchObject({ address: "Rua Velha", marital_status: "solteiro" });
    const m = await mine(integrante);
    expect(m.pending_fields.sort()).toEqual(["address", "city", "marital_status"]);
    expect(m.requests[0]).toMatchObject({ id: req1, status: "pending" });
  });
  test("não dá para pedir de novo o mesmo campo enquanto aguarda", async () => {
    expect(msg(await sub(integrante, pInt, { city: "Campinas" }))).toContain("already_pending");
  });
  test("4. aparece no painel com valor anterior, novo valor, pessoa e filtros", async () => {
    const r = (await list(secretaria)).data;
    const it = r.items.find((x: any) => x.id === req1);
    expect(it.person.id).toBe(pInt); expect(it.status).toBe("pending");
    itens = it.items;
    expect(itens.find((x: any) => x.field === "address")).toMatchObject({ old: "Rua Velha", new: "Rua Nova", decision: "pending", conflict: false });
    expect((await list(secretaria, { p_status: "pending" })).data.items.some((x: any) => x.id === req1)).toBe(true);
    expect((await list(secretaria, { p_status: "approved" })).data.items.some((x: any) => x.id === req1)).toBe(false);
    expect((await list(secretaria, { p_person: pOutro })).data.items.length).toBe(0);
    expect((await list(secretaria, { p_from: "2999-01-01" })).data.items.length).toBe(0);
    expect(msg(await list(secretaria, { p_status: "xx" }))).toContain("invalid_filter");
    expect((await secretaria.api.rpc("registration_pending_count", { p_org: org })).data).toBeGreaterThan(0);
  });
  test("começar a analisar notifica a pessoa", async () => {
    expect((await secretaria.api.rpc("registration_start", { p_id: req1 })).ok).toBe(true);
    expect((await list(secretaria)).data.items.find((x: any) => x.id === req1).status).toBe("in_review");
    expect((await notifs(integrante)).map((n) => n.title)).toContain("Solicitação em análise");
  });
  test("recusar exige justificativa", async () => {
    const m = itens.find((x: any) => x.field === "marital_status");
    expect(msg(await decide(secretaria, req1, [{ item_id: m.id, decision: "refuse", reason: "" }]))).toContain("reason_required");
  });
  test("5-8. aprova endereço e cidade, recusa estado civil com motivo: parcial, oficial só muda no aprovado, histórico e notificação", async () => {
    const f = (n: string) => itens.find((x: any) => x.field === n).id;
    const r = (await decide(secretaria, req1, [{ item_id: f("address"), decision: "approve" }, { item_id: f("city"), decision: "approve" }, { item_id: f("marital_status"), decision: "refuse", reason: "Falta a certidão" }])).data;
    expect(r).toMatchObject({ ok: true, status: "partial" });
    expect(await official(pInt, "address,city,marital_status")).toEqual({ address: "Rua Nova", city: "Santos", marital_status: "solteiro" });
    const it = (await list(secretaria)).data.items.find((x: any) => x.id === req1);
    expect(it.items.find((x: any) => x.field === "marital_status")).toMatchObject({ decision: "refused", reason: "Falta a certidão" });
    expect(it.reviewer).not.toBeNull();
    const t = (await timeline(pInt)).map((x: any) => x.title);
    expect(t).toContain("Alteração cadastral aprovada: Logradouro"); expect(t).toContain("Alteração cadastral recusada: Estado civil");
    const m = await mine(integrante);
    expect(m.requests[0].status).toBe("partial"); expect(m.requests[0].items.find((x: any) => x.field === "marital_status").reason).toBe("Falta a certidão");
    expect(m.pending_fields).toEqual([]);
  });
  test("10. notificações: recebida, em análise, parcial; revisores avisados; sem valores sensíveis no texto", async () => {
    const n = await notifs(integrante);
    const titulos = n.map((x) => x.title);
    expect(titulos).toEqual(expect.arrayContaining(["Solicitação recebida", "Solicitação em análise", "Alteração parcialmente aprovada"]));
    expect(JSON.stringify(n)).not.toContain("Rua Nova"); expect(JSON.stringify(n)).not.toContain("casado");
    expect((await notifs(secretaria)).map((x) => x.title)).toContain("Atualização cadastral para analisar");
    expect((await notifs(lider)).filter((x) => x.kind === "registration").length).toBe(0);
  });
  test("decidir de novo uma solicitação já concluída é recusado", async () => {
    expect(msg(await decide(secretaria, req1, [{ item_id: itens[0].id, decision: "approve" }]))).toContain("already_decided");
  });
  test("aprovada e recusada integralmente", async () => {
    const a = (await sub(outro, pOutro, { full_name: "Outro Nome Completo" })).data.request_id;
    const ia = (await list(secretaria, { p_person: pOutro })).data.items[0].items[0].id;
    expect((await decide(secretaria, a, [{ item_id: ia, decision: "approve" }])).data.status).toBe("approved");
    expect((await official(pOutro, "full_name")).full_name).toBe("Outro Nome Completo");
    const b = (await sub(outro, pOutro, { sex: "F" })).data.request_id;
    const ib = (await list(secretaria, { p_person: pOutro, p_status: "pending" })).data.items[0].items[0].id;
    expect((await decide(secretaria, b, [{ item_id: ib, decision: "refuse", reason: "Dado inconsistente" }])).data.status).toBe("refused");
    expect((await official(pOutro, "sex")).sex).toBeNull();
    expect((await notifs(outro)).map((x) => x.title)).toEqual(expect.arrayContaining(["Alteração aprovada", "Alteração recusada"]));
  });
});

describe("conflitos e simultaneidade", () => {
  test("14. dado oficial alterado durante a espera exige decisão explícita", async () => {
    const r = (await sub(integrante, pInt, { marital_status: "casado" })).data.request_id;
    await secretaria.api.rpc("person_save", { p_org: org, p_id: pInt, p: { marital_status: "viuvo" } });
    const lst = (await list(secretaria, { p_status: "pending" })).data.items.find((x: any) => x.id === r);
    expect(lst.items[0]).toMatchObject({ conflict: true, current: "viuvo", old: "solteiro" });
    const iid = lst.items[0].id;
    const c = (await decide(secretaria, r, [{ item_id: iid, decision: "approve" }])).data;
    expect(c).toMatchObject({ ok: false, conflicts: [iid] });
    expect((await official(pInt, "marital_status")).marital_status).toBe("viuvo");   // nada foi sobrescrito
    const f = (await decide(secretaria, r, [{ item_id: iid, decision: "approve", force: true }])).data;
    expect(f.status).toBe("approved"); expect((await official(pInt, "marital_status")).marital_status).toBe("casado");
    expect((await list(secretaria, { p_person: pInt, p_status: "approved" })).data.items[0].items.some((x: any) => x.overridden)).toBe(true);
  });
});

describe("permissões e privacidade", () => {
  test("11. ninguém consulta nem altera cadastro de terceiros", async () => {
    for (const [u, alvo] of [[outro, pInt], [estranho, pInt], [lider, pInt], [integrante, pOutro]] as any[]) {
      expect((await u.api.rpc("my_registration", { p_org: org, p_person: alvo })).ok).toBe(false);
      expect((await sub(u, alvo, { phone: "11977776666" })).ok).toBe(false);
    }
    expect((await official(pInt, "phone")).phone).toBe("11911112222");
    expect((await fora.api.rpc("my_registration", { p_org: org, p_person: null })).ok).toBe(false);
  });
  test("pessoa não vê solicitações dos outros e não cancela a de outro", async () => {
    const r = (await sub(estranho, await pid(estranho), { zip: "01001000" })).data.request_id;
    expect(msg(await outro.api.rpc("registration_cancel", { p_id: r }))).toContain("not_found");
    expect((await mine(outro)).requests.some((x: any) => x.id === r)).toBe(false);
  });
  test("integrante de time, líder de time, desenvolvedor e quem não aprova não entram no painel", async () => {
    for (const u of [lider, integrante, dev, estranho, outro]) {
      expect((await list(u)).ok).toBe(false);
      expect((await u.api.rpc("registration_start", { p_id: req1 })).ok).toBe(false);
      expect((await decide(u, req1, [{ item_id: 1, decision: "approve" }])).ok).toBe(false);
    }
    expect((await lider.api.rpc("registration_pending_count", { p_org: org })).data).toBe(0);
  });
  test("12. quem aprova não aprova a própria solicitação (só o administrador pode)", async () => {
    const pa = await pid(aprovador);
    const r = (await sub(aprovador, pa, { full_name: "Aprovador Renomeado" })).data.request_id;
    const it = (await list(aprovador, { p_person: pa })).data.items[0].items[0].id;
    expect(msg(await decide(aprovador, r, [{ item_id: it, decision: "approve" }]))).toContain("self_approval");
    expect((await decide(secretaria, r, [{ item_id: it, decision: "approve" }])).data.status).toBe("approved");
    expect((await official(pa, "full_name")).full_name).toBe("Aprovador Renomeado");
  });
  test("tabelas de solicitações não têm acesso direto nem exclusão", async () => {
    for (const t of ["person_update_requests", "person_update_items", "person_field_policy"]) {
      const r = await secretaria.api.get(`/${t}?select=*`); expect(!r.ok || (Array.isArray(r.data) && r.data.length === 0)).toBe(true);
      const d = await admin.api.del(`${t}?id=not.is.null`); expect(d.ok === false || (Array.isArray(d.data) && d.data.length === 0)).toBe(true);
    }
  });
  test("cancelar: pendente pode, depois de analisada não", async () => {
    const pe = await pid(estranho);
    const pend = (await mine(estranho)).requests.find((x: any) => x.status === "pending");
    expect((await estranho.api.rpc("registration_cancel", { p_id: pend.id })).ok).toBe(true);
    expect((await mine(estranho)).requests.find((x: any) => x.id === pend.id).status).toBe("cancelled");
    expect(msg(await estranho.api.rpc("registration_cancel", { p_id: req1 }))).toMatch(/not_found|cannot_cancel/);
    expect(msg(await integrante.api.rpc("registration_cancel", { p_id: req1 }))).toContain("cannot_cancel");
    expect((await sub(estranho, pe, { zip: "01001000" })).ok).toBe(true);   // pode pedir de novo
  });
});

describe("responsável legal e dependentes", () => {
  test("13. responsável legal administra o dependente autorizado, com origem registrada", async () => {
    const m = await mine(responsavel);
    expect(m.dependents.map((d: any) => d.id)).toEqual([filho]);
    const d = await mine(responsavel, filho);
    expect(d.role).toBe("guardian"); expect(d.person.id).toBe(filho);
    const r = (await sub(responsavel, filho, { phone: "11955554444", address: "Rua do Filho" })).data;
    expect(r.applied).toEqual(["phone"]); expect(r.pending).toEqual(["address"]);
    expect((await list(secretaria, { p_person: filho })).data.items[0]).toMatchObject({ on_behalf: true });
  });
  test("outro adulto, ainda que da família, não administra o dependente nem o adulto vinculado", async () => {
    await secretaria.api.rpc("person_relation_add", { p_person: pInt, p_relative: filho, p_relation: "other" });
    expect((await sub(integrante, filho, { phone: "11900001111" })).ok).toBe(false);
    expect((await integrante.api.rpc("my_registration", { p_org: org, p_person: filho })).ok).toBe(false);
    await secretaria.api.rpc("person_relation_add", { p_person: pResp, p_relative: pOutro, p_relation: "sibling" });
    expect((await sub(responsavel, pOutro, { phone: "11900002222" })).ok).toBe(false);   // vínculo familiar não dá poder sobre adulto
  });
});

describe("política por campo", () => {
  test("administrador muda a regra; os demais não; bloqueado impede; mudança fica registrada", async () => {
    expect((await admin.api.rpc("registration_policy_list", { p_org: org })).data.find((x: any) => x.field === "phone").mode).toBe("direct");
    for (const u of [secretaria, aprovador, integrante]) expect((await u.api.rpc("registration_policy_save", { p_org: org, p_field: "phone", p_mode: "approval" })).ok).toBe(false);
    expect((await admin.api.rpc("registration_policy_save", { p_org: org, p_field: "phone", p_mode: "approval" })).ok).toBe(true);
    expect((await sub(outro, pOutro, { phone: "11933334444" })).data.pending).toEqual(["phone"]);
    expect((await admin.api.rpc("registration_policy_save", { p_org: org, p_field: "photo_url", p_mode: "locked" })).ok).toBe(true);
    expect(msg(await sub(outro, pOutro, { photo_url: "https://x/y.jpg" }))).toContain("field_locked");
    expect(msg(await admin.api.rpc("registration_policy_save", { p_org: org, p_field: "classification", p_mode: "direct" }))).toContain("invalid_field");
    expect(msg(await admin.api.rpc("registration_policy_save", { p_org: org, p_field: "phone", p_mode: "xx" }))).toContain("invalid_mode");
    await admin.api.rpc("registration_policy_save", { p_org: org, p_field: "phone", p_mode: "direct" });
  });
});

describe("rascunho, duplicidade e preservação", () => {
  test("rascunho é guardado e consumido no envio", async () => {
    expect((await sub(outro, pOutro, { city: "Niterói" }, false)).data.draft).toBeTruthy();
    expect((await mine(outro)).draft).toEqual({ city: "Niterói" });
    expect((await official(pOutro, "city")).city).toBeNull();
    await sub(outro, pOutro, { city: "Niterói" }, true);
    expect((await mine(outro)).draft).toBeNull();
  });
  test("15. nada de pessoa nova, conta nova, classificação ou vínculos alterados", async () => {
    const antes = (await admin.api.get(`/people?org_id=eq.${org}&select=id`)).data.length;
    await sub(integrante, pInt, { neighborhood: "Centro" });
    expect((await admin.api.get(`/people?org_id=eq.${org}&select=id`)).data.length).toBe(antes);
    expect((await official(pInt, "classification,user_id"))).toMatchObject({ classification: "member", user_id: integrante.id });
    expect((await admin.api.get(`/team_members?user_id=eq.${lider.id}&select=is_leader`)).data[0].is_leader).toBe(true);
  });
  test("o fluxo antigo 'meus dados' (my_person_update) segue a mesma política", async () => {
    const r = (await integrante.api.rpc("my_person_update", { p_org: org, p: { phone2: "21988887777", full_name: "Integrante Novo Nome" } })).data;
    expect(r.applied).toEqual(["phone2"]); expect(r.pending).toEqual(["full_name"]);
    expect((await official(pInt, "full_name")).full_name).not.toBe("Integrante Novo Nome");
  });
  test("quem ainda não tem ficha cria a própria (primeiro preenchimento) sem duplicar", async () => {
    const novo = await newUser("Novato"); await joinChurch(admin.api, org, novo);
    expect((await mine(novo)).person).toBeNull();
    const a = (await novo.api.rpc("my_person_update", { p_org: org, p: { full_name: "Novato da Silva", phone: "11944443333" } })).data;
    expect(a.id).toBeTruthy();
    const b = (await novo.api.rpc("my_person_update", { p_org: org, p: { phone: "11944443333" } })).data;
    expect((await admin.api.get(`/people?user_id=eq.${novo.id}&select=id`)).data.length).toBe(1);
    expect((await mine(novo)).person.full_name).toBe("Novato da Silva");
    expect(b).toBeTruthy();
  });
  test("família no autoatendimento mostra só nome e parentesco, sem classificação nem contatos", async () => {
    const m = await mine(integrante);
    expect(m.family.length).toBeGreaterThan(0);
    expect(Object.keys(m.family[0]).sort()).toEqual(["label", "name", "photo_url"]);
  });
});
