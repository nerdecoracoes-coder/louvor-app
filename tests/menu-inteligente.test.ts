// Menu inteligente e central de descoberta do SOMOS Um: matriz de perfis, regras no servidor, destaques e permissões.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, visSem: any, visCom: any, freqSem: any, freqCom: any, conv: any, membro: any, servo: any, lider: any, liderJ: any, acolh: any, arte: any, gestor: any, semFicha: any, fora: any;
let org = "", team = "", teamAc = "", J = "", pLiderJ = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const patch = async (q: string, b: any) => { const r = await fetch(`${REST}/${q}`, { method: "PATCH", headers: await sk(), body: JSON.stringify(b) }); if (!r.ok) throw new Error(q + (await r.text())); };
const menu = async (u: any) => (await u.api.rpc("my_menu", { p_org: org })).data;
const cards = async (u: any) => ((await u.api.rpc("home_discover", { p_org: org })).data?.cards ?? []) as any[];
const keys = async (u: any) => (await cards(u)).map((c) => c.key);
const LEAF = { op: "and", items: [{ field: "classification", cmp: "eq", value: "attender" }] };
const msg = (r: any) => String(r.data?.message ?? "");
const dsave = (u: any, p: any, id: string | null = null) => u.api.rpc("discover_save", { p_org: org, p_id: id, p });
const decide = (personId: string, extra: any = {}) => ins("faith_decisions", { org_id: org, person_id: personId, display_name: "x", decided_on: "2026-11-01", origin: "culto", ...extra });
const pid = async (u: any) => (await (await fetch(`${REST}/people?user_id=eq.${u.id}&select=id`, { headers: await sk() })).json())[0].id as string;

beforeAll(async () => {
  [admin, visSem, visCom, freqSem, freqCom, conv, membro, servo, lider, liderJ, acolh, arte, gestor, semFicha, fora] = await Promise.all(["Adm", "VisSem", "VisCom", "FreqSem", "FreqCom", "Conv", "Membro", "Servo", "Lider", "LiderJ", "Acolh", "Arte", "Gestor", "SemFicha", "Fora"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Menu Inteligente" })).data;
  await joinChurch(admin.api, org, visSem, visCom, freqSem, freqCom, conv, membro, servo, lider, liderJ, acolh, arte, gestor, semFicha);
  for (const [u, c] of [[visSem, "visitor"], [visCom, "visitor"], [freqSem, "attender"], [freqCom, "attender"], [conv, "visitor"], [membro, "member"], [servo, "member"], [lider, "member"], [liderJ, "member"], [acolh, "member"], [arte, "member"]] as any)
    await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [u.id], p_classification: c });
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor MI", team_type: "louvor" })).data[0].id;
  teamAc = (await admin.api.post("teams", { org_id: org, name: "Recepção MI", team_type: "outro", features: ["visitantes", "eventos"] })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [servo.id, lider.id, liderJ.id] });
  await admin.api.rpc("add_team_members", { p_team: teamAc, p_users: [acolh.id] });
  await patch(`team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { is_leader: true });
  await patch(`team_members?team_id=eq.${team}&user_id=eq.${liderJ.id}`, { is_leader: true });
  await admin.api.rpc("grant_set", { p_org: org, p_user: arte.id, p_role: "secretary", p_network: null, p_title: "Pede arte", p_actions: ["media_request"] });
  await admin.api.rpc("grant_set", { p_org: org, p_user: gestor.id, p_role: "secretary", p_network: null, p_title: "Destaques", p_actions: ["discover_manage"] });
  await decide(await pid(visCom)); await decide(await pid(freqCom)); await decide(await pid(conv));
  // jornada com atividade, para "Continue sua jornada"
  const jr = (p: any) => admin.api.rpc("journey_save", { p_org: org, p_id: null, p, p_version: null });
  J = (await jr({ name: "Primeiros passos", description: "Comece aqui", visibility: "public", enroll_voluntary: true, eligible_classes: ["visitor", "attender"] })).data.id;
  const S = (await admin.api.rpc("journey_step_save", { p_journey: J, p_id: null, p: { name: "Etapa 1" }, p_version: null })).data.id;
  await admin.api.rpc("journey_activity_save", { p_step: S, p_id: null, p: { title: "Leia o texto", kind: "text", content_text: "Olá", completion_mode: "self", required: true }, p_version: null });
  await admin.api.rpc("journey_set_status", { p_id: J, p_status: "active", p_version: null });
  pLiderJ = await pid(liderJ);
});

describe("menu: Decidi seguir a Jesus (consulta o histórico permanente)", () => {
  test("visitante e frequentador sem decisão veem; com decisão registrada não veem", async () => {
    expect((await menu(visSem)).decision).toBe(true);
    expect((await menu(freqSem)).decision).toBe(true);
    expect((await menu(visCom)).decision).toBe(false);
    expect((await menu(freqCom)).decision).toBe(false);
    expect((await menu(visCom)).has_decision).toBe(true);
  });
  test("novo convertido com decisão, membro e conta sem classificação não recebem o convite", async () => {
    expect((await menu(conv)).decision).toBe(false);
    expect((await menu(membro)).decision).toBe(false);
    expect((await menu(semFicha)).decision).toBe(false); // sem ficha não há classificação de visitante/frequentador
  });
  test("atualiza na hora: depois de registrar a decisão, o convite some; decisão anulada volta a mostrar", async () => {
    const id = await pid(visSem);
    const d = (await decide(id))[0];
    expect((await menu(visSem)).decision).toBe(false);
    expect((await keys(visSem))).not.toContain("decision");
    await patch(`faith_decisions?id=eq.${d.id}`, { voided_at: new Date().toISOString() });
    expect((await menu(visSem)).decision).toBe(true);
  });
});

describe("menu: escalas, acolhimento, arte/vídeo", () => {
  test("Minhas escalas e Indisponibilidades só para quem tem vínculo com time", async () => {
    expect((await menu(servo)).scales).toBe(true);
    expect((await menu(membro)).scales).toBe(false);
    expect((await menu(visSem)).scales).toBe(false);
    await admin.api.rpc("add_team_members", { p_team: team, p_users: [membro.id] });
    expect((await menu(membro)).scales).toBe(true);
    await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${membro.id}`, { method: "DELETE", headers: await sk() });
    expect((await menu(membro)).scales).toBe(false);   // saiu de todos os times: o item desaparece
  });
  test("Como acolher: integrante do Louvor NÃO vê; equipe com 'Visitantes' e administrador veem", async () => {
    expect((await menu(servo)).welcome).toBe(false);
    expect((await menu(lider)).welcome).toBe(false);
    expect((await menu(acolh)).welcome).toBe(true);
    expect((await menu(admin)).welcome).toBe(true);
  });
  test("Pedir arte ou vídeo: administrador, líder de time e quem recebeu a permissão; os demais não (no menu e no banco)", async () => {
    expect((await menu(admin)).media).toBe(true);
    expect((await menu(lider)).media).toBe(true);
    expect((await menu(arte)).media).toBe(true);
    expect((await menu(servo)).media).toBe(false);
    expect((await menu(membro)).media).toBe(false);
    const mid = (await admin.api.post("teams", { org_id: org, name: "Mídia MI", team_type: "multimidia" })).data[0].id;
    const body = (u: any) => ({ org_id: org, team_id: mid, requested_by: u.id, title: "Arte", kind: "arte" });
    expect((await membro.api.post("media_requests", body(membro))).ok).toBe(false);
    expect((await servo.api.post("media_requests", body(servo))).ok).toBe(false);
    expect((await arte.api.post("media_requests", body(arte))).ok).toBe(true);
    expect((await lider.api.post("media_requests", body(lider))).ok).toBe(true);
  });
  test("liderança de time não ganha acesso administrativo nem aos destaques", async () => {
    expect(msg(await lider.api.rpc("discover_list", { p_org: org }))).toBe("forbidden");
    expect(msg(await dsave(lider, { title: "X" }))).toBe("forbidden");
    expect(msg(await dsave(servo, { title: "X" }))).toBe("forbidden");
  });
});

describe("menu: Minhas jornadas", () => {
  test("aparece para quem pode entrar em jornada aberta; não aparece para quem não é elegível", async () => {
    expect((await menu(visSem)).journeys).toBe(true);
    expect((await menu(membro)).journeys).toBe(false);   // jornada só para visitante/frequentador
  });
  test("depois de inscrito, o participante acompanha; ao concluir mantém o histórico", async () => {
    expect((await liderJ.api.rpc("journey_self_enroll", { p_journey: J })).ok).toBe(false);   // membro não é elegível
    const enr = await admin.api.rpc("journey_enroll", { p_journey: J, p_person: pLiderJ, p_responsible: null, p_start: true });
    expect(enr.data?.id ?? enr.data?.saved).toBeTruthy();
    expect((await menu(liderJ)).journeys).toBe(true);   // líder que também participa de uma jornada
    expect((await menu(liderJ)).leader).toBe(true);
    expect((await liderJ.api.rpc("journey_mine", { p_org: org })).data.mine.length).toBe(1);
  });
});

describe("cards do SOMOS Um", () => {
  test("visitante sem decisão: decisão, contato e ministérios; nada de carteira/cadastro vazio", async () => {
    const k = await keys(visSem);
    expect(k).toEqual(expect.arrayContaining(["decision", "contact", "ministries", "journeys"]));
    expect(k).not.toContain("wallet");
    expect(k).not.toContain("study"); expect(k).not.toContain("sermon"); expect(k).not.toContain("events"); expect(k).not.toContain("notices");   // sem conteúdo real, sem card
  });
  test("membro: sem decisão nem contato; sem carteira emitida não mostra carteira", async () => {
    const k = await keys(membro);
    expect(k).not.toContain("decision"); expect(k).not.toContain("contact"); expect(k).not.toContain("wallet"); expect(k).toContain("ministries");
  });
  test("carteira só para membro com carteira ativa", async () => {
    await admin.api.rpc("wallet_issue", { p_org: org, p_person: await pid(membro), p_reason: "teste" });
    expect(await keys(membro)).toContain("wallet");
    expect(await keys(visSem)).not.toContain("wallet");
  });
  test("continue sua jornada aparece para quem tem atividade pendente e não para os demais", async () => {
    const c = (await cards(liderJ)).find((x) => x.key === "continue");
    expect(c).toBeTruthy(); expect(c.route).toMatch(/^#\/jornadas\//); expect(c.action).toBe("Continuar");
    expect(await keys(servo)).not.toContain("continue");
  });
  test("eventos e comunicados reais viram cards; sem eles, nenhum card", async () => {
    await ins("church_events", { org_id: org, title: "Culto de celebração", starts_at: new Date(Date.now() + 3 * 864e5).toISOString() });
    await ins("announcements", { org_id: org, title: "Retiro de jovens" });
    const k = await keys(membro);
    expect(k).toContain("events"); expect(k).toContain("notices");
    expect((await cards(membro)).find((c) => c.key === "events").body).toContain("Culto de celebração");
  });
  test("cadastro: só aparece com ficha antiga (mais de 180 dias) e sem pedido em andamento", async () => {
    expect(await keys(servo)).not.toContain("cadastro");
    await patch(`people?id=eq.${await pid(servo)}`, { updated_at: new Date(Date.now() - 200 * 864e5).toISOString() });
    expect(await keys(servo)).toContain("cadastro");
  });
  test("todo card tem destino funcional (rota interna ou link externo)", async () => {
    for (const u of [visSem, membro, liderJ, servo]) for (const c of await cards(u)) expect(!!(c.route || c.url)).toBe(true);
  });
  test("quem não pertence à igreja não consulta cards nem menu", async () => {
    expect(msg(await fora.api.rpc("home_discover", { p_org: org }))).toBe("forbidden");
    expect(msg(await fora.api.rpc("my_menu", { p_org: org }))).toBe("forbidden");
  });
});

describe("destaques (campanhas, estudos, pregações)", () => {
  let st = "", ca = "", cm = "", cj = "", cs = "";
  test("só quem tem permissão cadastra; dados inválidos são recusados", async () => {
    expect(msg(await dsave(gestor, { title: "" }))).toBe("title_required");
    expect(msg(await dsave(gestor, { title: "X", url: "javascript:alert(1)" }))).toBe("invalid_data");
    expect(msg(await dsave(gestor, { title: "X", audience: "journey" }))).toBe("invalid_journey");
    expect(msg(await dsave(gestor, { title: "X", audience: "segment" }))).toBe("invalid_segment");
    expect(msg(await dsave(gestor, { title: "X", starts_at: "2026-12-10T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" }))).toBe("invalid_period");
  });
  test("estudo e pregação publicados viram cards com o título real", async () => {
    st = (await dsave(gestor, { kind: "study", title: "Conhecendo a Bíblia", body: "Um estudo para começar.", url: "https://exemplo.org/estudo" })).data.id;
    const sm = (await dsave(gestor, { kind: "sermon", title: "A graça que nos alcança", url: "#/avisos" })).data.id;
    const k = await cards(visSem);
    const e = k.find((c) => c.key === "study"); expect(e.title).toBe("Conhecendo a Bíblia"); expect(e.url).toBe("https://exemplo.org/estudo"); expect(e.action).toBe("Assistir agora");
    expect(k.find((c) => c.key === "sermon").route).toBe("#/avisos");
    await gestor.api.rpc("discover_set_active", { p_id: sm, p_active: false });
    expect(await keys(visSem)).not.toContain("sermon");
  });
  test("público: visitante, membro e jornada", async () => {
    ca = (await dsave(gestor, { kind: "campaign", title: "Só visitantes", audience: "visitor", url: "#/contato" })).data.id;
    cm = (await dsave(gestor, { kind: "campaign", title: "Só membros", audience: "member", url: "#/times" })).data.id;
    cj = (await dsave(gestor, { kind: "campaign", title: "Quem está na jornada", audience: "journey", journey_id: J, url: "#/jornadas" })).data.id;
    const t = async (u: any) => (await cards(u)).filter((c) => c.key === "campaign").map((c) => c.title);
    expect(await t(visSem)).toContain("Só visitantes"); expect(await t(visSem)).not.toContain("Só membros"); expect(await t(visSem)).not.toContain("Quem está na jornada");
    expect(await t(membro)).toContain("Só membros"); expect(await t(membro)).not.toContain("Só visitantes");
    expect(await t(liderJ)).toContain("Quem está na jornada");
  });
  test("segmentação existente: o destaque vale só para quem está no segmento", async () => {
    const seg = await admin.api.rpc("segment_save", { p_org: org, p_id: null, p: { name: "Frequentadores", kind: "dynamic", criteria: LEAF } });
    const sid = seg.data?.saved ?? seg.data?.id; expect(sid).toBeTruthy();
    cs = (await dsave(gestor, { kind: "campaign", title: "Para frequentadores", audience: "segment", segment_id: sid, url: "#/times" })).data.id;
    const t = async (u: any) => (await cards(u)).filter((c) => c.key === "campaign").map((c) => c.title);
    expect(await t(freqSem)).toContain("Para frequentadores");
    expect(await t(visSem)).not.toContain("Para frequentadores");
    expect(await t(membro)).not.toContain("Para frequentadores");
  });
  test("período: campanha futura ou vencida não aparece; urgente vai na frente", async () => {
    const fut = (await dsave(gestor, { kind: "campaign", title: "Futura", starts_at: new Date(Date.now() + 864e5).toISOString() })).data.id;
    const old = (await dsave(gestor, { kind: "campaign", title: "Vencida", ends_at: new Date(Date.now() - 864e5).toISOString() })).data.id;
    const urg = (await dsave(gestor, { kind: "campaign", title: "Aviso urgente", urgent: true, url: "#/avisos" })).data.id;
    const k = await cards(visSem); const titles = k.map((c) => c.title);
    expect(titles).not.toContain("Futura"); expect(titles).not.toContain("Vencida");
    expect(k[0].title).toBe("Aviso urgente"); expect(k[0].label).toBe("Comunicado importante");
    void fut; void old; void urg;
  });
  test("arquivar some da lista e nada é apagado; auditoria registra", async () => {
    expect((await gestor.api.rpc("discover_archive", { p_id: ca })).data.ok).toBe(true);
    expect(((await gestor.api.rpc("discover_list", { p_org: org })).data.items as any[]).some((i) => i.id === ca)).toBe(false);
    const raw = await (await fetch(`${REST}/discover_items?id=eq.${ca}&select=archived_at`, { headers: await sk() })).json();
    expect(raw[0].archived_at).toBeTruthy();
    const aud = await (await fetch(`${REST}/mod_audit?org_id=eq.${org}&module=eq.discover&select=action`, { headers: await sk() })).json();
    expect(aud.map((a: any) => a.action)).toEqual(expect.arrayContaining(["create", "update", "deactivate", "archive"].filter((a) => a !== "update")));
    void cm; void cj; void cs; void st;
  });
  test("ordem configurável e limite de cards", async () => {
    expect(msg(await gestor.api.rpc("discover_settings_save", { p_org: org, p_order: ["inexistente"], p_max: 8 }))).toBe("invalid_order");
    expect(msg(await gestor.api.rpc("discover_settings_save", { p_org: org, p_order: ["contact"], p_max: 1 }))).toBe("invalid_max");
    expect((await gestor.api.rpc("discover_settings_save", { p_org: org, p_order: ["contact", "ministries", "decision"], p_max: 3 })).data.ok).toBe(true);
    const k = await cards(visSem);
    expect(k.length).toBeLessThanOrEqual(3);
    expect(msg(await semFicha.api.rpc("discover_settings_save", { p_org: org, p_order: ["contact"], p_max: 5 }))).toBe("forbidden");
  });
  test("cada pessoa só enxerga o que lhe cabe: tabelas fechadas para leitura direta", async () => {
    expect((await visSem.api.get(`/discover_items?org_id=eq.${org}`)).ok).toBe(false);
  });
});
