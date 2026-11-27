// Correção: "Decidi seguir a Jesus" só para visitante/frequentador sem decisão. Membro nunca vê (menu, card da Home e backend).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, visSem: any, freqSem: any, visCom: any, freqCom: any, conv: any, membro: any, membroCom: any, liderLouvor: any, voluntario: any, semFicha: any, anulada: any;
let org = "", team = "";
const P: Record<string, string> = {};
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const patch = async (q: string, b: any) => fetch(`${REST}/${q}`, { method: "PATCH", headers: await sk(), body: JSON.stringify(b) });
const menu = async (u: any) => (await u.api.rpc("my_menu", { p_org: org })).data;
const cards = async (u: any) => ((await u.api.rpc("home_discover", { p_org: org })).data?.cards ?? []) as any[];
const hasCard = async (u: any) => (await cards(u)).some((c) => c.key === "decision");
const msg = (r: any) => String(r.data?.message ?? "");
const decide = (personId: string, extra: any = {}) => ins("faith_decisions", { org_id: org, person_id: personId, display_name: "x", decided_on: "2026-11-01", origin: "culto", ...extra });
const total = async () => (await rows(`faith_decisions?org_id=eq.${org}&select=id,voided_at`)).length;

beforeAll(async () => {
  [admin, visSem, freqSem, visCom, freqCom, conv, membro, membroCom, liderLouvor, voluntario, semFicha, anulada] = await Promise.all(["Adm", "VisSem", "FreqSem", "VisCom", "FreqCom", "Conv", "Membro", "MembroCom", "LiderLouvor", "Voluntario", "SemFicha", "Anulada"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Decisão" })).data;
  await joinChurch(admin.api, org, visSem, freqSem, visCom, freqCom, conv, membro, membroCom, liderLouvor, voluntario, semFicha, anulada);
  const defs: any = { visSem: [visSem, "visitor"], freqSem: [freqSem, "attender"], visCom: [visCom, "visitor"], freqCom: [freqCom, "attender"], conv: [conv, "visitor"], membro: [membro, "member"], membroCom: [membroCom, "member"], liderLouvor: [liderLouvor, "member"], voluntario: [voluntario, "member"], anulada: [anulada, "visitor"] };
  for (const [k, [u, c]] of Object.entries(defs) as any) P[k] = (await ins("people", { org_id: org, full_name: k, classification: c, status: "active", user_id: u.id }))[0].id;
  for (const k of ["visCom", "freqCom", "conv", "membroCom"]) await decide(P[k]);
  await decide(P.anulada, { voided_at: new Date().toISOString() });
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Dec", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [liderLouvor.id, voluntario.id] });
  await patch(`team_members?team_id=eq.${team}&user_id=eq.${liderLouvor.id}`, { is_leader: true });
});

describe("menu e card da Home", () => {
  test("visitante e frequentador sem decisão: EXIBIR", async () => {
    for (const u of [visSem, freqSem]) { expect((await menu(u)).decision).toBe(true); expect(await hasCard(u)).toBe(true); }
  });
  test("visitante e frequentador com decisão registrada, e novo convertido: OCULTAR", async () => {
    for (const u of [visCom, freqCom, conv]) { expect((await menu(u)).decision).toBe(false); expect(await hasCard(u)).toBe(false); }
  });
  test("membro, com ou sem decisão: OCULTAR", async () => {
    for (const u of [membro, membroCom]) { expect((await menu(u)).decision).toBe(false); expect(await hasCard(u)).toBe(false); }
  });
  test("líder do Ministério de Louvor que é membro, e voluntário membro: OCULTAR (permissão ministerial não decide)", async () => {
    const m = await menu(liderLouvor);
    expect(m.decision).toBe(false); expect(await hasCard(liderLouvor)).toBe(false);
    expect((await menu(voluntario)).decision).toBe(false);
    expect((await menu(admin)).decision).toBe(false);
  });
  test("decisão anulada não conta como decisão; conta sem ficha não tem classificação e não vê", async () => {
    expect((await menu(anulada)).decision).toBe(true);
    expect((await menu(semFicha)).decision).toBe(false);
  });
});

describe("backend", () => {
  test("membro e líder membro não abrem nem enviam o formulário, mesmo chamando direto", async () => {
    const antes = await total();
    for (const u of [membro, membroCom, liderLouvor, voluntario, admin, semFicha, visCom, freqCom, conv]) {
      expect(msg(await u.api.rpc("convert_self_get", { p_org: org }))).toBe("decision_unavailable");
      expect(msg(await u.api.rpc("convert_self_submit", { p_org: org, p: { confirm_identity: true, decided_on: "2026-11-20", origin: "culto" } }))).toBe("decision_unavailable");
    }
    expect(await total()).toBe(antes); // histórico intacto
  });
  test("elegível abre e registra; o menu e o card somem na hora, sem apagar nada", async () => {
    expect((await visSem.api.rpc("convert_self_get", { p_org: org })).data.person.id).toBe(P.visSem);
    const antes = await total();
    const r = await visSem.api.rpc("convert_self_submit", { p_org: org, p: { confirm_identity: true, decided_on: "2026-11-20", origin: "culto", consent: "authorized" } });
    expect(r.data.ok).toBe(true);
    expect(await total()).toBe(antes + 1);
    expect((await menu(visSem)).decision).toBe(false); expect((await menu(visSem)).has_decision).toBe(true);
    expect(await hasCard(visSem)).toBe(false);
    expect(msg(await visSem.api.rpc("convert_self_submit", { p_org: org, p: { confirm_identity: true, decided_on: "2026-11-21" } }))).toBe("decision_unavailable");
  });
  test("quem vira membro deixa de ver; quem deixa de ser membro e não tem decisão passa a ver", async () => {
    expect((await menu(freqSem)).decision).toBe(true);
    await patch(`people?id=eq.${P.freqSem}`, { classification: "member" });
    expect((await menu(freqSem)).decision).toBe(false); expect(await hasCard(freqSem)).toBe(false);
    await patch(`people?id=eq.${P.freqSem}`, { classification: "attender" });
    expect((await menu(freqSem)).decision).toBe(true);
  });
  test("o atalho manual não existe mais: ninguém libera a opção para membro", async () => {
    expect(msg(await admin.api.rpc("person_menu_decision_set", { p_person: P.membro, p_on: true }))).toBe("decision_rule_fixed");
    expect((await menu(membro)).decision).toBe(false);
    await patch(`people?id=eq.${P.membro}`, { menu_decision: true }); // mesmo forçando a marca antiga
    expect((await menu(membro)).decision).toBe(false); expect(await hasCard(membro)).toBe(false);
  });
  test("solicitar contato e oração continuam disponíveis para membro (outros canais)", async () => {
    const m = await menu(membro);
    expect(msg(await membro.api.rpc("care_overview", { p_org: org }))).toBe("");
    expect(m).toBeDefined();
  });
});
