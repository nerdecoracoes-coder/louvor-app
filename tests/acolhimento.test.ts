// Acolhimento e jornada de visitantes: cadastro mínimo, consentimento, retorno, etapas e permissões no servidor.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, secretaria: any, acolhedor: any, integrante: any, lider: any, dev: any, comum: any;
let org = "", louvor = "";
const reg = (u: any, a: any) => u.api.rpc("welcome_register", { p_org: org, ...a });
const get = async (u: any, id: string) => (await u.api.rpc("welcome_get", { p_person: id })).data;
const list = async (u: any, q?: string) => (await u.api.rpc("welcome_list", { p_org: org, p_q: q ?? null })).data;
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - 3 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  [admin, secretaria, acolhedor, integrante, lider, dev, comum] = await Promise.all(["Admin", "Secretaria", "Acolhedor", "Integrante", "Lider", "Dev", "Comum"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Acolhimento" })).data;
  await joinChurch(admin.api, org, secretaria, acolhedor, integrante, lider, dev);
  louvor = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [lider.id, integrante.id, acolhedor.id] });
  await admin.api.rpc("grant_set", { p_org: org, p_user: secretaria.id, p_role: "secretary", p_network: null, p_title: "Secretaria" });
  // acolhedor: só "registrar acolhimento" (sem ver a base de pessoas)
  const g = await admin.api.rpc("grant_set", { p_org: org, p_user: acolhedor.id, p_role: "general_leader", p_network: null, p_title: "Acolhimento", p_actions: ["people_welcome"] });
  expect(g.ok).toBe(true);
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${await serviceKey()}`, apikey: await serviceKey(), "Content-Type": "application/json" }, body: JSON.stringify({ is_developer: true }) });
});

describe("cadastro inicial", () => {
  let idSo = "", idTel = "";
  test("só com o nome: sem telefone, sem consentimento, primeira visita e responsável registrados", async () => {
    const r = await reg(acolhedor, { p_name: "Ana Souza" });
    expect(r.data.saved).toBe(true); idSo = r.data.id;
    const d = await get(acolhedor, idSo);
    expect(d.person.full_name).toBe("Ana Souza");
    expect(d.person.classification).toBe("visitor");
    expect(d.person.consent).toBe(false);
    expect(d.person.phone).toBeNull();
    expect(d.visits.length).toBe(1);
    expect(d.visits[0].kind).toBe("first");
    expect(d.visits[0].visited_on).toBe(today());
    expect(d.visits[0].welcomed_by_name).toBe("Acolhedor");
    expect(d.stage).toBe("first_visit");
  });
  test("telefone só com autorização; com autorização fica registrado", async () => {
    const sem = await reg(acolhedor, { p_name: "Bruno Lima", p_phone: "(21) 99999-1111", p_consent: false });
    expect(sem.ok).toBe(false); expect(sem.data.message).toContain("phone_needs_consent");
    expect((await reg(acolhedor, { p_name: "Bruno Lima", p_consent: true })).data.message).toContain("consent_needs_phone");
    expect((await reg(acolhedor, { p_name: "Bruno Lima", p_phone: "123", p_consent: true })).data.message).toContain("invalid_phone");
    const ok = await reg(acolhedor, { p_name: "Bruno Lima", p_phone: "(21) 99999-1111", p_consent: true, p_visited_on: daysAgo(3), p_welcomer: secretaria.id });
    expect(ok.data.saved).toBe(true); idTel = ok.data.id;
    const d = await get(acolhedor, idTel);
    expect(d.person.consent).toBe(true); expect(d.person.phone).toBe("(21) 99999-1111");
    expect(d.visits[0].visited_on).toBe(daysAgo(3));
    expect(d.visits[0].welcomed_by_name).toBe("Secretaria");
    expect(d.consents.length).toBe(1); expect(d.consents[0].value).toBe(true);
  });
  test("nome vazio, data futura e responsável de fora são recusados", async () => {
    expect((await reg(acolhedor, { p_name: "  " })).data.message).toContain("name_required");
    expect((await reg(acolhedor, { p_name: "Futuro", p_visited_on: "2099-01-01" })).data.message).toContain("invalid_date");
    expect((await reg(acolhedor, { p_name: "Fora", p_welcomer: comum.id })).data.message).toContain("invalid_welcomer");
  });
  test("não duplica pessoa: mesmo nome ou mesmo telefone avisam; só segue com confirmação", async () => {
    const d1 = await reg(secretaria, { p_name: "  ana   souza " });
    expect(d1.data.saved).toBe(false); expect(d1.data.duplicates[0].id).toBe(idSo);
    const d2 = await reg(secretaria, { p_name: "Outro Nome", p_phone: "21 99999-1111", p_consent: true });
    expect(d2.data.saved).toBe(false); expect(d2.data.duplicates[0].id).toBe(idTel);
    const f = await reg(secretaria, { p_name: "Ana Souza", p_force: true });
    expect(f.data.saved).toBe(true); expect(f.data.id).not.toBe(idSo);
  });
  test("a lista localiza o visitante e mostra o telefone só de quem autorizou", async () => {
    const l = await list(acolhedor, "bruno");
    expect(l.total).toBe(1); expect(l.rows[0].phone).toBe("(21) 99999-1111");
    const a = (await list(acolhedor, "ana")).rows.find((x: any) => x.id === idSo);
    expect(a.phone).toBeNull(); expect(a.visits).toBe(1); expect(a.stage).toBe("first_visit");
  });

  describe("retorno e jornada", () => {
    test("retorno usa o mesmo cadastro, preserva a primeira visita e muda a etapa", async () => {
      const v = await acolhedor.api.rpc("welcome_visit", { p_person: idTel, p_visited_on: daysAgo(1) });
      expect(v.data.kind).toBe("return"); expect(v.data.stage).toBe("returning");
      const d = await get(acolhedor, idTel);
      expect(d.visits.length).toBe(2);
      expect(d.visits.find((x: any) => x.kind === "first").visited_on).toBe(daysAgo(3));
      expect(d.person.full_name).toBe("Bruno Lima");
      const l = await list(acolhedor, "bruno"); expect(l.total).toBe(1); expect(l.rows[0].first_visit_on).toBe(daysAgo(3)); expect(l.rows[0].visits).toBe(2);
    });
    test("não registra o mesmo dia duas vezes nem visita antes da primeira", async () => {
      expect((await acolhedor.api.rpc("welcome_visit", { p_person: idTel, p_visited_on: daysAgo(1) })).data.message).toContain("already_registered");
      expect((await acolhedor.api.rpc("welcome_visit", { p_person: idTel, p_visited_on: daysAgo(9) })).data.message).toContain("before_first_visit");
    });
    test("sem registros novos a pessoa fica na primeira etapa (nada avança sozinho)", async () => {
      expect((await get(acolhedor, idSo)).stage).toBe("first_visit");
      expect((await list(acolhedor)).rows.every((r: any) => ["first_visit", "returning", "approach", "integration"].includes(r.stage))).toBe(true);
    });
    test("aproximação e integração só entram por registro; contato exige autorização", async () => {
      const n = await acolhedor.api.rpc("welcome_note", { p_person: idSo, p_kind: "interest", p_note: "Quer receber oração" });
      expect(n.data.stage).toBe("approach");
      expect((await acolhedor.api.rpc("welcome_note", { p_person: idSo, p_kind: "contact", p_note: "Ligação" })).data.message).toContain("no_contact_consent");
      expect((await acolhedor.api.rpc("welcome_note", { p_person: idSo, p_kind: "xyz", p_note: "a" })).data.message).toContain("invalid_kind");
      expect((await acolhedor.api.rpc("welcome_note", { p_person: idSo, p_kind: "family", p_note: " " })).data.message).toContain("note_required");
      const i = await acolhedor.api.rpc("welcome_note", { p_person: idSo, p_kind: "integration", p_note: "Conheceu os ministérios" });
      expect(i.data.stage).toBe("integration");
      const c = await acolhedor.api.rpc("welcome_note", { p_person: idTel, p_kind: "contact", p_note: "Mensagem de boas-vindas" });
      expect(c.data.stage).toBe("returning"); // contato autorizado não "avança" a pessoa
      const d = await get(acolhedor, idSo);
      expect(d.journey.map((j: any) => j.kind).sort()).toEqual(["integration", "interest"]);
      expect(d.journey[0].by).toBe("Acolhedor");
    });
    test("corrigir dados preserva o histórico; retirar a autorização apaga o telefone e fica registrado", async () => {
      expect((await acolhedor.api.rpc("welcome_update", { p_person: idTel, p: { full_name: "Bruno de Lima" } })).ok).toBe(true);
      expect((await acolhedor.api.rpc("welcome_update", { p_person: idTel, p: { phone: "21 98888-0000" } })).ok).toBe(true);
      expect((await get(acolhedor, idTel)).person.phone).toBe("21 98888-0000");
      expect((await acolhedor.api.rpc("welcome_update", { p_person: idSo, p: { phone: "21 97777-0000" } })).data.message).toContain("phone_needs_consent");
      expect((await acolhedor.api.rpc("welcome_update", { p_person: idTel, p: { consent: false } })).ok).toBe(true);
      const d = await get(acolhedor, idTel);
      expect(d.person.consent).toBe(false); expect(d.person.phone).toBeNull();
      expect(d.visits.length).toBe(2); expect(d.journey.length).toBe(1);
      expect(d.consents.map((c: any) => c.value)).toEqual([false, true]);
      expect((await acolhedor.api.rpc("welcome_update", { p_person: idTel, p: { consent: true } })).data.message).toContain("consent_needs_phone");
    });
    test("virar frequentador/membro mantém o mesmo registro e o histórico", async () => {
      expect((await secretaria.api.rpc("person_save", { p_org: org, p_id: idSo, p: { classification: "member", joined_at: today() } })).data.saved).toBe(true);
      const d = await get(secretaria, idSo);
      expect(d.person.classification).toBe("member"); expect(d.visits.length).toBe(1); expect(d.journey.length).toBe(2);
      const n = await secretaria.api.rpc("people_list", { p_org: org, p_q: "Ana Souza" });
      expect(n.data.rows.filter((r: any) => r.id === idSo).length).toBe(1);
    });
  });
});

describe("permissões no servidor", () => {
  let alvo = "";
  beforeAll(async () => { alvo = (await reg(admin, { p_name: "Visitante Reservado", p_phone: "21 91111-2222", p_consent: true })).data.id; });
  test("administrador, secretaria e quem tem people_welcome usam o acolhimento", async () => {
    for (const u of [admin, secretaria, acolhedor]) expect((await u.api.rpc("welcome_list", { p_org: org })).ok).toBe(true);
  });
  test("integrante, líder, usuário comum e desenvolvedor são barrados em todas as funções", async () => {
    for (const u of [integrante, lider, comum, dev]) {
      expect((await u.api.rpc("welcome_register", { p_org: org, p_name: "Intruso" })).data.message).toContain("forbidden");
      expect((await u.api.rpc("welcome_list", { p_org: org })).data.message).toContain("forbidden");
      expect((await u.api.rpc("welcome_get", { p_person: alvo })).data.message).toContain("forbidden");
      expect((await u.api.rpc("welcome_visit", { p_person: alvo })).data.message).toContain("forbidden");
      expect((await u.api.rpc("welcome_note", { p_person: alvo, p_kind: "approach", p_note: "x" })).data.message).toContain("forbidden");
      expect((await u.api.rpc("welcome_update", { p_person: alvo, p: { full_name: "x" } })).data.message).toContain("forbidden");
    }
  });
  test("quem só acolhe não lê a base de pessoas nem as tabelas de visitas e jornada", async () => {
    expect((await acolhedor.api.get("/people?select=id")).data).toEqual([]);
    expect((await acolhedor.api.get("/person_visits?select=id")).data).toEqual([]);
    expect((await acolhedor.api.get("/person_journey?select=id")).data).toEqual([]);
    expect((await acolhedor.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Direto" } })).ok).toBe(false);
  });
  test("ninguém escreve direto nas tabelas", async () => {
    for (const u of [admin, secretaria, acolhedor]) {
      expect((await u.api.post("person_visits", { org_id: org, person_id: alvo, visited_on: today(), kind: "return" })).ok).toBe(false);
      expect((await u.api.post("person_journey", { org_id: org, person_id: alvo, kind: "approach", note: "x" })).ok).toBe(false);
    }
  });
  test("a ação people_welcome aparece em my_access e o desenvolvedor não a recebe", async () => {
    expect((await acolhedor.api.rpc("my_access", { p_org: org })).data.people).toContain("people_welcome");
    expect((await secretaria.api.rpc("my_access", { p_org: org })).data.people).toContain("people_welcome");
    expect((await dev.api.rpc("my_access", { p_org: org })).data.people).toEqual([]);
    expect((await integrante.api.rpc("my_access", { p_org: org })).data.people).toEqual([]);
  });
  test("excluir a pessoa leva junto as visitas e a jornada", async () => {
    await admin.api.rpc("welcome_note", { p_person: alvo, p_kind: "approach", p_note: "Conversa" });
    expect((await admin.api.rpc("person_delete", { p_id: alvo })).ok).toBe(true);
    expect((await admin.api.get(`/person_visits?person_id=eq.${alvo}`)).data).toEqual([]);
    expect((await admin.api.get(`/person_journey?person_id=eq.${alvo}`)).data).toEqual([]);
  });
});
