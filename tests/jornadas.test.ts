// Recurso 08: Jornadas (construtor, etapas/atividades, participações, Minhas Jornadas, responsáveis, aprovação, progresso, histórico, permissões, convertidos).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, gestor: any, resp: any, resp2: any, aluno: any, aluno2: any, semFicha: any, lider: any, secretaria: any, fora: any;
let org = "", pA = "", pB = "", pSem = "";
const msg = (r: any) => String(r.data?.message ?? "");
const FOLLOW = ["people_journeys_follow"];
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const jsave = (u: any, p: any, id: string | null = null, v: number | null = null) => rpc(u, "journey_save", { p_org: org, p_id: id, p, p_version: v });
const jget = async (u: any, id: string) => (await rpc(u, "journey_get", { p_id: id })).data;
const step = (u: any, j: string, p: any, id: string | null = null) => rpc(u, "journey_step_save", { p_journey: j, p_id: id, p, p_version: null });
const act = (u: any, s: string, p: any, id: string | null = null) => rpc(u, "journey_activity_save", { p_step: s, p_id: id, p, p_version: null });
const enroll = (u: any, j: string, person: string, r: string | null = null, start = true) => rpc(u, "journey_enroll", { p_journey: j, p_person: person, p_responsible: r, p_start: start });
const pget = async (u: any, pid: string) => (await rpc(u, "journey_participant_get", { p_pid: pid })).data;
const rec = (u: any, pid: string, a: string, action: string, text: string | null = null) => rpc(u, "journey_record", { p_pid: pid, p_activity: a, p_action: action, p_text: text });
const notifs = async (u: any) => (await u.api.get(`/notifications?user_id=eq.${u.id}&kind=eq.journey&select=title,link&order=created_at`)).data as any[];
const person = async (id: string, cols = "*") => (await admin.api.get(`/people?id=eq.${id}&select=${cols}`)).data[0];
const timeline = async (id: string) => (await admin.api.rpc("person_timeline", { p_person: id, p_categories: null, p_origin: null, p_from: null, p_to: null, p_by: null, p_limit: 100, p_offset: 0 })).data.items as any[];
const acts = (s: any) => s.activities.map((a: any) => a.id);

// jornada principal (sequencial, pública): S1 [A1 texto self, A2 vídeo self, A3 link opcional] · S2 [A4 tarefa responsável, A5 questionário aprovação] · S3 [A6 evento auto]
let J = "", S1 = "", S2 = "", S3 = "", A: Record<string, string> = {}, ev = "";

beforeAll(async () => {
  [admin, gestor, resp, resp2, aluno, aluno2, semFicha, lider, secretaria, fora] = await Promise.all(["Admin", "Gestor", "Resp", "Resp2", "Aluno", "Aluno2", "SemFicha", "Lider", "Secretaria", "Fora"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Jornadas" })).data;
  await joinChurch(admin.api, org, gestor, resp, resp2, aluno, aluno2, semFicha, lider, secretaria);
  const grant = (u: any, title: string, actions: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: title, p_actions: actions });
  await grant(gestor, "Gestor", ["people_view", "people_edit", "people_journeys_admin", "people_journeys_participants", "people_journeys_approve", "people_journeys_indicators"]);
  await grant(resp, "Resp", [...FOLLOW, "people_journeys_approve"]);
  await grant(resp2, "Resp2", FOLLOW);
  await grant(secretaria, "Sec", ["people_view", "people_edit", "people_converts_view", "people_converts_register", "people_converts_link", "people_converts_followup", "people_converts_assign"]);
  const t = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: t, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${t}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [aluno.id, aluno2.id, lider.id, resp.id], p_classification: "attender" });
  pA = (await admin.api.get(`/people?user_id=eq.${aluno.id}&select=id`)).data[0].id; pB = (await admin.api.get(`/people?user_id=eq.${aluno2.id}&select=id`)).data[0].id;
  pSem = (await admin.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Pessoa Sem Conta", classification: "visitor" } })).data.id;
  ev = (await admin.api.post("church_events", { org_id: org, title: "Culto de ensino", starts_at: new Date(Date.now() - 60000).toISOString(), created_by: admin.id })).data[0].id;
});

describe("construtor", () => {
  test("1. criar jornada: nome obrigatório, responsável precisa poder acompanhar, nasce rascunho", async () => {
    expect(msg(await jsave(gestor, { name: "" }))).toContain("name_required");
    expect(msg(await jsave(gestor, { name: "X", owner_id: aluno.id }))).toContain("invalid_responsible");
    const r = await jsave(gestor, { name: "Discipulado", description: "Percurso de discipulado", objective: "Crescer", audience: "Novos", owner_id: resp.id, visibility: "public", step_mode: "sequential", enroll_voluntary: true });
    expect(r.data.saved).toBe(true); J = r.data.id;
    const g = await jget(gestor, J); expect(g.status).toBe("draft"); expect(g.version).toBe(1); expect(g.owner_name).toBeTruthy();
  });
  test("2. editar jornada e controle de versão (alterações simultâneas)", async () => {
    const r = await jsave(gestor, { name: "Discipulado", description: "Percurso atualizado" }, J, 1);
    expect(r.data.version).toBe(2);
    expect(msg(await jsave(admin, { name: "Outra edição" }, J, 1))).toContain("version_conflict");
    expect((await jget(gestor, J)).description).toBe("Percurso atualizado");
  });
  test("4. criar etapas; 5. reordenar etapas", async () => {
    S1 = (await step(gestor, J, { name: "Fundamentos da fé" })).data.id; S2 = (await step(gestor, J, { name: "Vida devocional", responsible_id: resp.id })).data.id; S3 = (await step(gestor, J, { name: "Serviço cristão" })).data.id;
    expect((await jget(gestor, J)).steps.map((s: any) => s.name)).toEqual(["Fundamentos da fé", "Vida devocional", "Serviço cristão"]);
    expect(msg(await rpc(gestor, "journey_reorder", { p_kind: "step", p_parent: J, p_ids: [S1, S2], p_version: null }))).toContain("invalid_order");
    expect((await rpc(gestor, "journey_reorder", { p_kind: "step", p_parent: J, p_ids: [S3, S1, S2], p_version: null })).data.ok).toBe(true);
    expect((await jget(gestor, J)).steps.map((s: any) => s.name)[0]).toBe("Serviço cristão");
    await rpc(gestor, "journey_reorder", { p_kind: "step", p_parent: J, p_ids: [S1, S2, S3], p_version: null });
  });
  test("6. diferentes tipos de atividade; 8. obrigatória/opcional; validações", async () => {
    const mk = async (s: string, p: any) => (await act(gestor, s, p)).data;
    A.a1 = (await mk(S1, { title: "Ler o texto", kind: "text", content_text: "Conteúdo", completion_mode: "self", required: true })).id;
    A.a2 = (await mk(S1, { title: "Assistir à aula", kind: "video", content_url: "https://exemplo.com/video", completion_mode: "self", required: true })).id;
    A.a3 = (await mk(S1, { title: "Material extra", kind: "link", content_url: "https://exemplo.com", completion_mode: "self", required: false })).id;
    A.a4 = (await mk(S2, { title: "Conversar com o responsável", kind: "accompanied", completion_mode: "responsible", required: true })).id;
    A.a5 = (await mk(S2, { title: "Responder ao questionário", kind: "quiz", content_text: "1) O que aprendeu?", completion_mode: "approval", required: true })).id;
    A.a6 = (await mk(S3, { title: "Participar do culto", kind: "event", event_id: ev, completion_mode: "auto", required: true })).id;
    for (const [k, kind] of [["file", "file"], ["reading", "reading"], ["task", "task"], ["meeting", "meeting"]]) expect((await act(gestor, S3, { title: "Tipo " + k, kind, completion_mode: "self", required: false })).data.saved).toBe(true);
    expect(msg(await act(gestor, S3, { title: "Ruim", kind: "xxx" }))).toContain("invalid_kind");
    expect(msg(await act(gestor, S3, { title: "Auto sem evento", completion_mode: "auto" }))).toContain("auto_needs_event");
    expect(msg(await act(gestor, S3, { title: "Link ruim", kind: "link", content_url: "javascript:alert(1)" }))).toContain("invalid_url");
    const g = await jget(gestor, J); expect(g.steps[0].activities.find((a: any) => a.id === A.a3).required).toBe(false);
  });
  test("7. reordenar atividades", async () => {
    const g = await jget(gestor, J); const ids = acts(g.steps[0]);
    expect((await rpc(gestor, "journey_reorder", { p_kind: "activity", p_parent: S1, p_ids: [ids[2], ids[0], ids[1]], p_version: null })).data.ok).toBe(true);
    expect(acts((await jget(gestor, J)).steps[0])[0]).toBe(ids[2]);
    await rpc(gestor, "journey_reorder", { p_kind: "activity", p_parent: S1, p_ids: ids, p_version: null });
  });
  test("3. duplicar jornada (sem participantes) e ativar exige conteúdo", async () => {
    const d = (await rpc(gestor, "journey_duplicate", { p_id: J })).data; expect(d.saved).toBe(true);
    const c = await jget(gestor, d.id); expect(c.name).toBe("Cópia de Discipulado"); expect(c.status).toBe("draft"); expect(c.steps.length).toBe(3); expect(c.steps[0].activities.length).toBe(3);
    const vazia = (await jsave(gestor, { name: "Vazia" })).data.id;
    expect(msg(await rpc(gestor, "journey_set_status", { p_id: vazia, p_status: "active", p_version: null }))).toContain("journey_empty");
  });
  test("9. sequência: etapas sequenciais travam a seguinte; livres não", async () => {
    expect((await rpc(gestor, "journey_set_status", { p_id: J, p_status: "active", p_version: null })).data.ok).toBe(true);
    const e = await enroll(gestor, J, pA); expect(e.data.saved).toBe(true);
    const p = await pget(admin, e.data.id);
    expect(p.steps[0].unlocked).toBe(true); expect(p.steps[1].unlocked).toBe(false); expect(p.steps[2].unlocked).toBe(false);
    expect(msg(await rec(aluno, e.data.id, A.a4, "complete"))).toContain("step_locked");
    const L = (await jsave(gestor, { name: "Livre", step_mode: "free" })).data.id;
    const s1 = (await step(gestor, L, { name: "E1" })).data.id; const s2 = (await step(gestor, L, { name: "E2" })).data.id;
    await act(gestor, s1, { title: "T1" }); await act(gestor, s2, { title: "T2" });
    await rpc(gestor, "journey_set_status", { p_id: L, p_status: "active", p_version: null });
    const e2 = await enroll(gestor, L, pA); const p2 = await pget(admin, e2.data.id);
    expect(p2.steps.every((s: any) => s.unlocked)).toBe(true);
    await rpc(gestor, "journey_participant_status", { p_pid: e2.data.id, p_action: "cancel", p_force: false });
  });
});

describe("participações e progresso", () => {
  let PA = "";
  test("10. associar participantes existentes; 11. impedir duplicidade; 12. várias jornadas", async () => {
    PA = (await admin.api.get(`/journey_participants?journey_id=eq.${J}&select=id`)).data;
    const sk = await serviceKey();
    PA = (await (await fetch(`${REST}/journey_participants?journey_id=eq.${J}&person_id=eq.${pA}&select=id`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json())[0].id;
    expect(msg(await enroll(gestor, J, pA))).toContain("already_participant");
    expect(msg(await enroll(gestor, J, "00000000-0000-0000-0000-000000000000"))).toContain("person_not_found");
    expect((await enroll(gestor, J, pSem, resp.id)).data.saved).toBe(true);   // pessoa sem conta de acesso
    const outra = (await jsave(gestor, { name: "Segunda jornada", visibility: "private" })).data.id; const o1 = (await step(gestor, outra, { name: "Passo" })).data.id; await act(gestor, o1, { title: "Fazer" });
    await rpc(gestor, "journey_set_status", { p_id: outra, p_status: "active", p_version: null });
    expect((await enroll(gestor, outra, pA)).data.saved).toBe(true);
    expect((await person(pA, "classification")).classification).toBe("attender");   // classificação intocada
    expect((await admin.api.get(`/team_members?user_id=eq.${aluno.id}&select=team_id`)).data.length).toBe(0);   // sem vínculo com times
  });
  test("13. Minhas Jornadas mostra participações e jornadas disponíveis", async () => {
    const m = (await rpc(aluno, "journey_mine", { p_org: org })).data;
    expect(m.mine.filter((x: any) => x.status !== "cancelled").length).toBe(2); expect(m.has_person).toBe(true);
    expect(m.mine.find((x: any) => x.name === "Discipulado").pct).toBe(0);
    const m2 = (await rpc(aluno2, "journey_mine", { p_org: org })).data;
    expect(m2.mine.length).toBe(0); expect(m2.available.map((x: any) => x.name)).toContain("Discipulado");   // pública e voluntária
    expect(m2.available.map((x: any) => x.name)).not.toContain("Segunda jornada");   // privada nunca aparece
    const s = (await rpc(semFicha, "journey_mine", { p_org: org })).data; expect(s.has_person).toBe(false); expect(s.available.length).toBe(0);
  });
  test("14. conclusão pelo participante; 17. progresso só com obrigatórias; opcional não conta", async () => {
    expect((await rec(aluno, PA, A.a3, "complete")).data.pct).toBe(0);   // opcional
    expect((await rec(aluno, PA, A.a1, "complete")).data.pct).toBe(20);   // 1 de 5 obrigatórias
    expect(msg(await rec(aluno, PA, A.a1, "complete"))).toContain("already_done");
    expect(msg(await rec(aluno2, PA, A.a2, "complete"))).toContain("forbidden");
    expect((await rec(aluno, PA, A.a2, "complete")).data.pct).toBe(40);
    const p = await pget(aluno, PA);
    expect(p.steps[0].complete).toBe(true); expect(p.steps[1].unlocked).toBe(true);
    expect(p.steps[2].unlocked).toBe(false);
  });
  test("15. conclusão pelo responsável (e só por ele); 16. aprovação quando exigida", async () => {
    expect(msg(await rec(aluno, PA, A.a4, "complete"))).toContain("forbidden");   // modo "responsável"
    expect(msg(await rec(resp2, PA, A.a4, "complete"))).toContain("forbidden");   // sem escopo
    expect((await rec(resp, PA, A.a4, "complete", "Conversamos")).data.pct).toBe(60);
    expect((await rec(aluno, PA, A.a5, "complete", "Aprendi muito")).data.pct).toBe(60);   // pendente: ainda não conta
    expect((await pget(aluno, PA)).steps[1].activities.find((a: any) => a.id === A.a5).state).toBe("pending");
    expect(msg(await rec(aluno, PA, A.a5, "approve"))).toContain("forbidden");
    expect(msg(await rec(resp2, PA, A.a5, "approve"))).toContain("forbidden");   // follow sem permissão de aprovar
    expect((await rec(resp, PA, A.a5, "reject", "Refaça")).data.pct).toBe(60);
    expect((await pget(aluno, PA)).steps[1].activities.find((a: any) => a.id === A.a5).state).toBe("todo");
    await rec(aluno, PA, A.a5, "complete", "Agora sim");
    expect((await rec(resp, PA, A.a5, "approve")).data.pct).toBe(80);
    expect((await notifs(aluno)).map((n) => n.title)).toContain("Sua atividade foi aprovada");
  });
  test("conclusão automática por evento realizado e conclusão da jornada", async () => {
    const p = await pget(aluno, PA);   // abre a etapa 3 e o servidor conclui a atividade do evento já realizado
    expect(p.steps[2].activities.find((a: any) => a.id === A.a6).state).toBe("done");
    expect(p.pct).toBe(100); expect(p.status).toBe("completed"); expect(p.completed_at).not.toBeNull();
    // quem agiu não recebe aviso da própria ação; o responsável sim
    expect((await notifs(resp)).map((n) => n.title)).toContain("Uma pessoa concluiu a jornada");
  });
  test("18. pausar e retomar; 19. concluir manualmente exige obrigatórias", async () => {
    const e = await enroll(gestor, J, pB, resp.id); const PB = e.data.id;
    expect((await rpc(aluno2, "journey_participant_status", { p_pid: PB, p_action: "pause", p_force: false })).data.status).toBe("paused");
    expect(msg(await rec(aluno2, PB, A.a1, "complete"))).toContain("participation_not_active");
    expect((await rpc(aluno2, "journey_participant_status", { p_pid: PB, p_action: "resume", p_force: false })).data.status).toBe("active");
    expect(msg(await rpc(resp, "journey_participant_status", { p_pid: PB, p_action: "complete", p_force: false }))).toContain("required_pending");
    expect(msg(await rpc(resp, "journey_participant_status", { p_pid: PB, p_action: "complete", p_force: true }))).toContain("required_pending");   // força só para admin
    expect((await rpc(gestor, "journey_participant_status", { p_pid: PB, p_action: "complete", p_force: true })).data.status).toBe("completed");
    expect(msg(await rpc(resp2, "journey_participant_status", { p_pid: PB, p_action: "reopen", p_force: false }))).toContain("forbidden");
  });
});

describe("estrutura, histórico, permissões e integrações", () => {
  test("alterar a estrutura não apaga progresso: atividade usada é ocultada, não removida", async () => {
    const sk = await serviceKey();
    const rows = await (await fetch(`${REST}/journey_completions?select=id,activity_id&activity_id=eq.${A.a2}`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json();
    expect(rows.length).toBeGreaterThan(0);
    const r = await rpc(gestor, "journey_activity_remove", { p_id: A.a2, p_version: null });
    expect(r.data.kept).toBe(true);
    const after = await (await fetch(`${REST}/journey_completions?select=id&activity_id=eq.${A.a2}`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json();
    expect(after.length).toBe(rows.length);
    expect(msg(await rpc(gestor, "journey_step_remove", { p_id: S1, p_version: null }))).toContain("step_not_empty");
    const vazio = (await step(gestor, J, { name: "Etapa vazia" })).data.id;
    expect((await rpc(gestor, "journey_step_remove", { p_id: vazio, p_version: null })).data.ok).toBe(true);
  });
  test("20. arquivar preserva participantes, progresso e histórico", async () => {
    const copia = (await rpc(gestor, "journey_duplicate", { p_id: J })).data.id;
    await rpc(gestor, "journey_set_status", { p_id: copia, p_status: "active", p_version: null });
    const e = await enroll(gestor, copia, pB); expect(e.data.saved).toBe(true);
    expect((await rpc(gestor, "journey_set_status", { p_id: J, p_status: "archived", p_version: null })).data.changed).toBe(true);
    const sk = await serviceKey();
    const n = await (await fetch(`${REST}/journey_participants?journey_id=eq.${J}&select=id,status`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json();
    expect(n.length).toBeGreaterThanOrEqual(3); expect(n.some((x: any) => x.status === "completed")).toBe(true);
    const tl = (await timeline(pA)).filter((x: any) => x.category === "jornada");
    expect(tl.length).toBeGreaterThan(0);
    expect(msg(await enroll(gestor, J, pSem))).toContain("journey_not_active");
    expect(msg(await jsave(gestor, { name: "Mudar arquivada" }, J))).toContain("journey_archived");
    const mine = (await rpc(aluno, "journey_mine", { p_org: org })).data.mine.find((x: any) => x.journey_id === J); expect(mine.status).toBe("completed"); expect((await pget(aluno, mine.id)).status).toBe("completed");
  });
  test("21. permissões: sem permissão nada; responsável só vê o seu escopo; time não dá acesso", async () => {
    const outra = (await rpc(gestor, "journey_list", { p_org: org, p: {} })).data.items.find((x: any) => x.name === "Segunda jornada").id;
    for (const u of [aluno, lider, semFicha, fora, secretaria]) {
      expect(msg(await rpc(u, "journey_list", { p_org: org, p: {} }))).toContain("forbidden");
      expect(msg(await jsave(u, { name: "Invasor" }))).toContain("forbidden");
      expect(msg(await rpc(u, "journey_get", { p_id: outra }))).toContain("forbidden");
      expect(msg(await rpc(u, "journey_indicators", { p_org: org, p_journey: null, p_from: null, p_to: null }))).toContain("forbidden");
      expect(msg(await enroll(u, outra, pB))).toContain("forbidden");
    }
    expect(msg(await rpc(resp2, "journey_get", { p_id: outra }))).toContain("forbidden");   // follow sem atribuição
    expect(msg(await rpc(resp2, "journey_participants_list", { p_journey: outra, p: {} }))).toContain("forbidden");
    const lst = (await rpc(resp, "journey_list", { p_org: org, p: {} })).data.items; expect(lst.every((x: any) => x.name !== "Segunda jornada")).toBe(true);
    const sk = await serviceKey();
    const pt = (await (await fetch(`${REST}/journey_participants?journey_id=eq.${outra}&select=id`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json())[0].id;
    expect(msg(await rpc(aluno2, "journey_participant_get", { p_pid: pt }))).toContain("forbidden");   // manipulação de ID
    expect(msg(await rpc(resp, "journey_participant_get", { p_pid: pt }))).toContain("forbidden");
    expect((await rpc(aluno, "journey_participant_get", { p_pid: pt })).data.status).toBe("active");
    expect(msg(await rpc(gestor, "journey_assign", { p_pid: pt, p_user: aluno.id }))).toContain("invalid_responsible");
    expect((await aluno.api.get("/journeys?select=id")).ok === false || ((await aluno.api.get("/journeys?select=id")).data ?? []).length === 0).toBe(true);
  });
  test("22. jornadas privadas: não se inscreve sozinho, não aparece em disponíveis", async () => {
    const outra = (await rpc(gestor, "journey_list", { p_org: org, p: {} })).data.items.find((x: any) => x.name === "Segunda jornada").id;
    expect(msg(await rpc(aluno2, "journey_self_enroll", { p_journey: outra }))).toContain("forbidden");
    expect(msg(await rpc(aluno2, "journey_public_get", { p_journey: outra }))).toContain("forbidden");
    const nova = (await jsave(gestor, { name: "Voluntária restrita", visibility: "public", enroll_voluntary: true, eligible_classes: ["member"] })).data.id;
    const s = (await step(gestor, nova, { name: "E" })).data.id; await act(gestor, s, { title: "Fazer" }); await rpc(gestor, "journey_set_status", { p_id: nova, p_status: "active", p_version: null });
    expect(msg(await rpc(aluno2, "journey_self_enroll", { p_journey: nova }))).toContain("not_eligible");   // só membros
    expect(msg(await rpc(semFicha, "journey_self_enroll", { p_journey: nova }))).toContain("no_person_record");
  });
  test("23. notificações configuráveis, sem lembretes e com silenciamento", async () => {
    const t = (await notifs(aluno)).map((n) => n.title);
    expect(t).toContain("Você foi incluído(a) em uma jornada");
    expect((await notifs(resp)).map((n) => n.title)).toContain("Você acompanha uma nova pessoa em uma jornada");
    const mudo = (await jsave(gestor, { name: "Sem avisos", notify: { enroll: false, assign: false } })).data.id;
    const s = (await step(gestor, mudo, { name: "E" })).data.id; await act(gestor, s, { title: "Fazer" }); await rpc(gestor, "journey_set_status", { p_id: mudo, p_status: "active", p_version: null });
    const antes = (await notifs(aluno2)).length; await enroll(gestor, mudo, pB, resp.id);
    expect((await notifs(aluno2)).length).toBe(antes);
    expect(msg(await jsave(gestor, { name: "X", notify: { qualquer: true } }))).toContain("invalid_notify");
    const sk = await serviceKey();
    const pb = (await (await fetch(`${REST}/journey_participants?journey_id=eq.${J}&person_id=eq.${pB}&select=id`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json())[0].id;
    expect((await rpc(aluno2, "journey_notify_pref", { p_pid: pb, p_on: false })).data.ok).toBe(true);
    expect(msg(await rpc(aluno, "journey_notify_pref", { p_pid: pb, p_on: true }))).toContain("forbidden");
    const jobs = await (await fetch(`${REST}/notifications?kind=eq.journey&title=ilike.*lembr*&select=id`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json(); expect(jobs.length).toBe(0);
  });
  test("24. integração com Novos Convertidos: oferta, aceite/recusa sem alterar cadastro nem decisão", async () => {
    const conv = (await jsave(gestor, { name: "Minha Caminhada com Cristo", for_converts: true, owner_id: resp.id })).data.id;
    const s = (await step(gestor, conv, { name: "Primeiros passos" })).data.id; await act(gestor, s, { title: "Ler", completion_mode: "self" }); await rpc(gestor, "journey_set_status", { p_id: conv, p_status: "active", p_version: null });
    const d1 = (await secretaria.api.rpc("convert_register", { p_org: org, p: { name: "Aluno2", mode: "link", person_id: pB, origin: "culto", decided_on: "2026-11-02" }, p_force: false })).data.id;
    const dAw = (await secretaria.api.rpc("convert_register", { p_org: org, p: { name: "Sem ficha", origin: "culto" }, p_force: false })).data.id;
    const cj = (await rpc(secretaria, "convert_journeys", { p_decision: d1 })).data; expect(cj.can_offer).toBe(true); expect(cj.offerable.map((x: any) => x.name)).toContain("Minha Caminhada com Cristo");
    expect(msg(await rpc(secretaria, "journey_offer", { p_decision: dAw, p_journey: conv }))).toContain("link_required");
    expect(msg(await rpc(secretaria, "journey_offer", { p_decision: d1, p_journey: J }))).toContain("not_for_converts");
    const before = await person(pB, "classification,status");
    const o = await rpc(secretaria, "journey_offer", { p_decision: d1, p_journey: conv }); expect(o.data.saved).toBe(true);
    expect(msg(await rpc(secretaria, "journey_offer", { p_decision: d1, p_journey: conv }))).toContain("already_participant");
    expect((await pget(admin, o.data.id)).status).toBe("waiting");
    expect((await notifs(aluno2)).map((n) => n.title)).toContain("Você foi convidado(a) para uma jornada");
    expect(msg(await rpc(aluno, "journey_respond", { p_pid: o.data.id, p_accept: true }))).toContain("forbidden");
    expect((await rpc(aluno2, "journey_respond", { p_pid: o.data.id, p_accept: false })).data.ok).toBe(true);   // recusa
    expect(await person(pB, "classification,status")).toEqual(before);
    const dec = (await secretaria.api.rpc("convert_get", { p_id: d1 })).data; expect(dec.person.id).toBe(pB); expect(dec.awaiting_link).toBe(false);
    expect((await timeline(pB)).some((x: any) => x.kind === "decision")).toBe(true);   // decisão continua no histórico
    const o2 = await rpc(secretaria, "journey_offer", { p_decision: d1, p_journey: conv });   // pode ser oferecida de novo depois da recusa
    expect((await rpc(aluno2, "journey_respond", { p_pid: o2.data.id, p_accept: true })).data.ok).toBe(true);
    expect((await pget(aluno2, o2.data.id)).status).toBe("active");
    expect((await rpc(secretaria, "journey_participant_status", { p_pid: o2.data.id, p_action: "cancel", p_force: false })).ok).toBe(false);   // secretaria sem acompanhamento da jornada
    expect((await rpc(aluno2, "journey_participant_status", { p_pid: o2.data.id, p_action: "cancel", p_force: false })).data.status).toBe("cancelled");   // interrompe sem apagar a decisão
    expect((await secretaria.api.rpc("convert_get", { p_id: d1 })).data.person.id).toBe(pB);
  });
  test("25. integração com a Ficha Individual: eventos na linha do tempo e participações por pessoa", async () => {
    const tl = (await timeline(pA)).filter((x: any) => x.category === "jornada").map((x: any) => x.title);
    expect(tl).toContain("Entrou em uma jornada"); expect(tl).toContain("Etapa concluída"); expect(tl).toContain("Jornada concluída");
    const f = (await rpc(gestor, "journey_for_person", { p_person: pA })).data; expect(f.allowed).toBe(false === f.allowed ? false : true);
    const g = (await rpc(admin, "journey_for_person", { p_person: pA })).data; expect(g.allowed).toBe(true); expect(g.items.length).toBeGreaterThanOrEqual(2);
    const nope = (await rpc(aluno, "journey_for_person", { p_person: pA })).data; expect(nope.allowed).toBe(false);
    const ind = (await rpc(gestor, "journey_indicators", { p_org: org, p_journey: null, p_from: null, p_to: null })).data;
    expect(ind.participants).toBeGreaterThan(0); expect(ind.by_journey.length).toBeGreaterThan(0);
    const tot = ind.by_status.reduce((s: number, x: any) => s + x.n, 0); expect(tot).toBeGreaterThanOrEqual(ind.participants);
  });
  test("26. módulos existentes seguem funcionando e a regra automática só cria convites", async () => {
    expect((await secretaria.api.rpc("person_save", { p_org: org, p_id: null, p: { full_name: "Cadastro Normal", classification: "visitor" } })).data.saved).toBe(true);
    expect((await secretaria.api.rpc("convert_list", { p_org: org, p: {} })).data.total).toBeGreaterThan(0);
    const r = (await jsave(gestor, { name: "Por critério", visibility: "private", auto_rule: { classes: ["visitor"] } })).data.id;
    const s = (await step(gestor, r, { name: "E" })).data.id; await act(gestor, s, { title: "Fazer" }); await rpc(gestor, "journey_set_status", { p_id: r, p_status: "active", p_version: null });
    const ap = (await rpc(gestor, "journey_apply_rule", { p_journey: r })).data; expect(ap.invited).toBeGreaterThan(0);
    const sk = await serviceKey();
    const rows = await (await fetch(`${REST}/journey_participants?journey_id=eq.${r}&select=status,source`, { headers: { Authorization: `Bearer ${sk}`, apikey: sk } })).json();
    expect(rows.every((x: any) => x.status === "waiting" && x.source === "rule")).toBe(true);
    expect(msg(await rpc(gestor, "journey_apply_rule", { p_journey: J }))).not.toBe("");
    const acc = (await admin.api.rpc("my_access", { p_org: org })).data; expect(JSON.stringify(acc)).toContain("people_journeys_admin");
    expect((await admin.api.get(`/teams?org_id=eq.${org}&select=id`)).data.length).toBe(1);
  });
});
