// Menu por público: o servidor decide quais atalhos pessoais aparecem para cada pessoa.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, vis: any, cong: any, mem: any, semFicha: any, outro: any, org = "";
const P: Record<string, string> = {};
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const menu = async (u: any) => (await u.api.rpc("my_menu", { p_org: org })).data;
const msg = (r: any) => String(r.data?.message ?? "");

beforeAll(async () => {
  [admin, vis, cong, mem, semFicha, outro] = await Promise.all(["Adm", "Vis", "Cong", "Mem", "SemFicha", "Outro"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Menu" })).data;
  await joinChurch(admin.api, org, vis, cong, mem, semFicha);
  for (const [k, u, c] of [["vis", vis, "visitor"], ["cong", cong, "attender"], ["mem", mem, "member"]] as any) P[k] = (await ins("people", { org_id: org, full_name: k, classification: c, status: "active", user_id: u.id }))[0].id;
});

describe("menu por público", () => {
  test("Decidi seguir a Jesus: visitante, congregado e sem ficha veem; membro não", async () => {
    expect((await menu(vis)).decision).toBe(true);
    expect((await menu(cong)).decision).toBe(true);
    expect((await menu(semFicha)).decision).toBe(true);
    expect((await menu(mem)).decision).toBe(false);
  });
  test("a liderança libera e retira o atalho de um membro; quem não tem permissão não consegue", async () => {
    expect(msg(await mem.api.rpc("person_menu_decision_set", { p_person: P.mem, p_on: true }))).toBe("forbidden");
    expect(msg(await vis.api.rpc("person_menu_decision_set", { p_person: P.mem, p_on: true }))).toBe("forbidden");
    expect(msg(await outro.api.rpc("person_menu_decision_set", { p_person: P.mem, p_on: true }))).toBe("forbidden");
    expect((await admin.api.rpc("person_menu_decision_set", { p_person: P.mem, p_on: true })).ok).toBe(true);
    expect((await menu(mem)).decision).toBe(true);
    expect((await admin.api.rpc("person_menu_decision_set", { p_person: P.mem, p_on: false })).ok).toBe(true);
    expect((await menu(mem)).decision).toBe(false);
    expect((await rows(`mod_audit?org_id=eq.${org}&entity_id=eq.${P.mem}&select=action`)).map((a) => a.action)).toEqual(expect.arrayContaining(["menu_decision_on", "menu_decision_off"]));
  });
  test("quem não pertence à igreja não consulta o menu", async () => {
    expect(msg(await outro.api.rpc("my_menu", { p_org: org }))).toBe("forbidden");
  });
  test("Minhas jornadas só aparece com jornada para a pessoa", async () => {
    expect((await menu(vis)).journeys).toBe(false);
    const j = await ins("journeys", { org_id: org, name: "Primeiros passos", status: "active", visibility: "public", enroll_voluntary: true, eligible_classes: ["visitor"] });
    expect((await menu(vis)).journeys).toBe(true);
    expect((await menu(cong)).journeys).toBe(false);
    expect((await menu(mem)).journeys).toBe(false);
    void j;
  });
  test("Minhas escalas só aparece para quem está numa escala publicada", async () => {
    expect((await menu(vis)).rosters).toBe(false);
    const r = (await ins("rosters", { org_id: org, title: "Recepção", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "draft" }))[0];
    await ins("roster_assignments", { roster_id: r.id, org_id: org, person_id: P.vis });
    expect((await menu(vis)).rosters).toBe(false);
    await fetch(`${REST}/rosters?id=eq.${r.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ status: "awaiting" }) });
    expect((await menu(vis)).rosters).toBe(true);
    expect((await menu(cong)).rosters).toBe(false);
  });
});
