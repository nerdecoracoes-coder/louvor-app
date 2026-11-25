// Recurso 10: Relatórios de Pessoas (indicadores, perfil, histórico, família, ministérios, filtros, listas/exportações, permissões).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, geral: any, supervisor: any, lider: any, semPerm: any, dash: any, dev: any, fora: any;
let org = "", teamA = "", teamB = "", netA = "";
const ids: Record<string, string> = {};
const msg = (r: any) => String(r.data?.message ?? "");
const rep = (u: any, area: string, f: any = {}) => u.api.rpc("rp_report", { p_org: org, p_area: area, f });
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const day = (n: number) => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const born = (age: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - age); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };
const grant = (u: any, title: string, actions: string[], role = "secretary", network: string | null = null) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: role, p_network: network, p_title: title, p_actions: actions });
const ALL = ["people_reports_dashboard", "people_reports_membership", "people_reports_demographics", "people_reports_family", "people_reports_ministry", "people_reports_church"];

async function person(key: string, o: any) {
  const r = await ins("people", { org_id: org, full_name: key, ...o });
  ids[key] = r[0].id; return r[0].id;
}
async function hist(key: string, kind: string, o: any) { await ins("person_history", { org_id: org, person_id: ids[key], kind, ...o }); }

beforeAll(async () => {
  [admin, geral, supervisor, lider, semPerm, dash, dev, fora] = await Promise.all(["Admin", "Geral", "Super", "Lider", "SemPerm", "Dash", "Dev", "Fora"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Relatórios" })).data;
  await joinChurch(admin.api, org, geral, supervisor, lider, semPerm, dash, dev);
  await grant(geral, "Geral", [...ALL, "people_reports_individual", "people_reports_export", "people_reports_export_lists", "people_view"]);
  await grant(dash, "Dash", ["people_reports_dashboard", "people_reports_church"]);
  teamA = (await admin.api.post("teams", { org_id: org, name: "Louvor Rel", team_type: "louvor" })).data[0].id;
  teamB = (await admin.api.post("teams", { org_id: org, name: "Recepção Rel", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: teamA, p_users: [lider.id, semPerm.id] });
  await admin.api.rpc("add_team_members", { p_team: teamB, p_users: [semPerm.id] });
  await admin.api.patch(`team_members?team_id=eq.${teamA}&user_id=eq.${lider.id}`, { is_leader: true });
  await grant(lider, "Líder", ["people_reports_dashboard", "people_reports_demographics", "people_reports_ministry", "people_reports_own", "people_reports_individual", "people_reports_export"]);
  // população controlada
  await person("Ana", { classification: "member", registered_at: day(400), joined_at: day(300), birth_date: born(30), sex: "F", marital_status: "casado", city: "Rio", user_id: lider.id });
  await person("Bruno", { classification: "member", registered_at: day(200), joined_at: day(20), birth_date: born(40), sex: "M", marital_status: "casado", city: "Rio", user_id: semPerm.id });
  await person("Carla", { classification: "attender", registered_at: day(50), birth_date: born(15), sex: "F", city: "Niterói" });
  await person("Davi", { classification: "visitor", registered_at: day(10), birth_date: born(8), sex: "M" });
  await person("Eva", { classification: "visitor", registered_at: day(5), status: "inactive" });
  await person("Fabio", { classification: "member", registered_at: day(100), joined_at: day(90), birth_date: born(70), sex: "M", marital_status: "viuvo", city: "Rio", status: "active" });
  await hist("Ana", "create", { new_value: "visitor", at: new Date(Date.now() - 400 * 864e5).toISOString() });
  await hist("Ana", "classification", { old_value: "visitor", new_value: "member", at: new Date(Date.now() - 300 * 864e5).toISOString() });
  await hist("Bruno", "create", { new_value: "visitor", at: new Date(Date.now() - 200 * 864e5).toISOString() });
  await hist("Bruno", "classification", { old_value: "visitor", new_value: "member", at: new Date(Date.now() - 20 * 864e5).toISOString() });
  await hist("Carla", "create", { new_value: "attender", at: new Date(Date.now() - 50 * 864e5).toISOString() });
  await hist("Davi", "create", { new_value: "visitor", at: new Date(Date.now() - 10 * 864e5).toISOString() });
  await hist("Eva", "create", { new_value: "visitor", at: new Date(Date.now() - 5 * 864e5).toISOString() });
  await hist("Eva", "field", { field: "status", old_value: "active", new_value: "inactive", at: new Date(Date.now() - 2 * 864e5).toISOString() });
  // Fabio sem histórico de propósito (cobertura < 100%)
  await ins("person_relations", { org_id: org, person_id: ids.Ana, relative_id: ids.Bruno, relation: "spouse" }).catch(() => null);
  await ins("faith_decisions", { org_id: org, person_id: ids.Davi, decided_on: day(3), full_name: "Davi" }).catch(() => null);
});

describe("indicadores", () => {
  test("visão geral conta cada pessoa uma vez e separa classificação e situação", async () => {
    const r = await rep(geral, "overview"); expect(r.ok).toBe(true);
    const p = r.data.pop;
    expect(p.total).toBe(6); expect(p.member).toBe(3); expect(p.attender).toBe(1); expect(p.visitor).toBe(2);
    expect(p.active).toBe(5); expect(p.inactive).toBe(1);
    expect(p.member + p.attender + p.visitor + p.none).toBe(p.total);
  });
  test("usuário do app sem ficha não vira membro", async () => {
    const r = await rep(geral, "overview"); expect(r.data.pop.total).toBe(6); // admin, geral, etc. não têm ficha
  });
  test("variação absoluta e percentual; percentual nulo quando o anterior é zero", async () => {
    const r = await rep(geral, "overview", { from: day(29), to: day(0) });
    const v = r.data.variation.new_registrations; expect(v.cur).toBeGreaterThanOrEqual(2);
    expect(v.abs).toBe(v.cur - v.prev);
    const z = await rep(geral, "overview", { from: day(3), to: day(0), compare: "custom", cfrom: day(2000), cto: day(1990) });
    expect(z.data.variation.new_registrations.prev).toBe(0); expect(z.data.variation.new_registrations.pct).toBeNull();
  });
  test("cadastros incompletos são contados pela ausência de dado, sem presumir", async () => {
    const p = (await rep(geral, "overview")).data.pop; expect(p.incomplete).toBeGreaterThan(0); expect(p.incomplete).toBeLessThanOrEqual(p.total);
  });
});

describe("perfil demográfico", () => {
  test("faixas padrão com 'não informado' e soma igual ao total", async () => {
    const r = (await rep(geral, "profile")).data;
    expect(r.bands.reduce((s: number, b: any) => s + b.n, 0)).toBe(r.total);
    expect(r.bands.find((b: any) => b.label === "Não informado").n).toBe(1);
    expect(r.bands.find((b: any) => b.label === "0–12" || b.label.startsWith("0")).n).toBeGreaterThanOrEqual(1);
    expect(r.sex.find((s: any) => s.k === "none").n).toBe(1);
    expect(r.marital.reduce((s: number, x: any) => s + x.n, 0)).toBe(r.total);
  });
  test("faixas configuráveis: validação e persistência", async () => {
    expect(msg(await geral.api.rpc("rp_settings_save", { p_org: org, p_bands: [] }))).toContain("forbidden");
    expect(msg(await admin.api.rpc("rp_settings_save", { p_org: org, p_bands: [{ label: "A", min: 0, max: 10 }, { label: "B", min: 12, max: null }] }))).toContain("invalid_bands");
    expect((await admin.api.rpc("rp_settings_save", { p_org: org, p_bands: [{ label: "Jovens", min: 0, max: 29 }, { label: "Adultos", min: 30, max: null }] })).data.saved).toBe(true);
    const r = (await rep(geral, "profile")).data; expect(r.bands.map((b: any) => b.label)).toEqual(["Jovens", "Adultos", "Não informado"]);
    expect(r.bands.reduce((s: number, b: any) => s + b.n, 0)).toBe(r.total);
  });
});

describe("evolução histórica", () => {
  test("reconstrói pela data de ocorrência, não pela classificação atual", async () => {
    const r = (await rep(geral, "evolution", { from: day(30), to: day(0) })).data;
    expect(r.current.new_members).toBe(1); // Bruno virou membro há 20 dias
    expect(r.current.new_visitors).toBe(2); // Davi e Eva
    expect(r.current.inactivations).toBe(1);
    const retro = (await rep(geral, "evolution", { from: day(320), to: day(280) })).data; expect(retro.current.new_members).toBe(1); // Ana
  });
  test("informa cobertura do histórico incompleta", async () => {
    const r = (await rep(geral, "evolution", { from: day(30), to: day(0) })).data;
    expect(r.history_coverage).toBeLessThan(1); expect(r.limitations.length).toBeGreaterThan(0);
  });
  test("granularidade e limites do período", async () => {
    const d = (await rep(geral, "evolution", { from: day(6), to: day(0), granularity: "day" })).data; expect(d.series.length).toBe(7);
    expect(msg(await rep(geral, "evolution", { from: day(900), to: day(0), granularity: "day" }))).toContain("too_many_points");
    expect(msg(await rep(geral, "evolution", { from: day(0), to: day(10) }))).toContain("invalid_period");
    expect(msg(await rep(geral, "evolution", { granularity: "hora" }))).toContain("invalid_granularity");
  });
  test("comparações: mês, ano e período anterior", async () => {
    for (const c of ["previous", "month", "year"]) { const r = await rep(geral, "evolution", { compare: c }); expect(r.ok).toBe(true); expect(r.data.delta.new_members.abs).toBe(r.data.delta.new_members.cur - r.data.delta.new_members.prev); }
  });
});

describe("família e ministérios", () => {
  test("família conta grupo uma vez e não expõe nomes", async () => {
    const r = (await rep(geral, "family")).data; expect(r.families).toBeGreaterThanOrEqual(0); expect(r.with_link + r.without_link).toBe(r.total);
    expect(JSON.stringify(r)).not.toContain("Davi");
  });
  test("ministério separa pessoas únicas, vínculos e participações; quem está em 2 times conta uma vez", async () => {
    const r = (await rep(geral, "ministry")).data;
    expect(r.unique_linked).toBe(2); expect(r.links).toBe(3); expect(r.multi_team).toBe(1); expect(r.unlinked).toBe(r.total - 2);
    expect(r.teams.find((t: any) => t.name === "Louvor Rel").people).toBe(2);
  });
});

describe("filtros", () => {
  test("combináveis, afetam todos os indicadores e rejeitam valor inválido", async () => {
    const r = (await rep(geral, "overview", { classification: ["member"], city: ["Rio"] })).data; expect(r.pop.total).toBe(3); expect(r.pop.member).toBe(3);
    const s = (await rep(geral, "profile", { sex: ["F"] })).data; expect(s.total).toBe(2);
    expect((await rep(geral, "overview", { classification: ["member"], sex: ["F"], marital: ["casado"] })).data.pop.total).toBe(1);
    expect((await rep(geral, "overview", { team: teamA })).data.pop.total).toBe(2); expect((await rep(geral, "overview", { team: teamB })).data.pop.total).toBe(1);
  });
  test("opções só trazem valores existentes", async () => {
    const o = (await geral.api.rpc("rp_options", { p_org: org })).data;
    expect(o.classification.sort()).toEqual(["attender", "member", "visitor"]); expect(o.teams.length).toBe(2); expect(o.can.export_lists).toBe(true);
  });
});

describe("listas, exportações e auditoria", () => {
  test("lista exige permissão individual; menores têm nome abreviado e não vazam contato", async () => {
    expect(msg(await dash.api.rpc("rp_list", { p_org: org, f: {}, p_limit: 50, p_offset: 0, p_export: false, p_format: null }))).toContain("forbidden");
    const l = (await geral.api.rpc("rp_list", { p_org: org, f: {}, p_limit: 50, p_offset: 0, p_export: false, p_format: null })).data;
    expect(l.total).toBe(6); const davi = l.items.find((i: any) => i.minor && i.classification === "visitor"); expect(davi.name).not.toBe("Davi");
    expect(JSON.stringify(l)).not.toMatch(/cpf|phone|email|admin_notes/);
  });
  test("exportar lista exige permissão própria, formato válido e fica auditado", async () => {
    expect(msg(await lider.api.rpc("rp_list", { p_org: org, f: {}, p_limit: 50, p_offset: 0, p_export: true, p_format: "csv" }))).toContain("forbidden");
    expect(msg(await geral.api.rpc("rp_list", { p_org: org, f: {}, p_limit: 50, p_offset: 0, p_export: true, p_format: "doc" }))).toContain("invalid_format");
    expect((await geral.api.rpc("rp_list", { p_org: org, f: { city: ["Rio"] }, p_limit: 50, p_offset: 0, p_export: true, p_format: "xlsx" })).data.items.length).toBe(3);
    const lg = await rows(`report_exports?org_id=eq.${org}&kind=eq.list&select=format,row_count,filters`); expect(lg.length).toBe(1); expect(lg[0].row_count).toBe(3); expect(lg[0].filters.city).toEqual(["Rio"]);
  });
  test("exportação de indicadores é auditada e exige permissão", async () => {
    expect(msg(await dash.api.rpc("report_export_log", { p_org: org, p_area: "overview", p_format: "pdf", p_filters: {}, p_rows: 5 }))).toContain("forbidden");
    expect((await geral.api.rpc("report_export_log", { p_org: org, p_area: "overview", p_format: "pdf", p_filters: {}, p_rows: 5 })).data.saved).toBe(true);
    expect(msg(await geral.api.rpc("report_export_log", { p_org: org, p_area: "x", p_format: "pdf", p_filters: {}, p_rows: 1 }))).toContain("invalid_area");
    expect(msg(await geral.api.rpc("rp_export_audit", { p_org: org }))).toContain("forbidden");
    expect((await admin.api.rpc("rp_export_audit", { p_org: org })).data.length).toBe(2);
  });
  test("tabelas de apoio não são acessíveis diretamente", async () => {
    for (const t of ["report_exports", "report_settings"]) { const r = await geral.api.get(`/${t}?select=*`); expect(r.ok === false || (r.data ?? []).length === 0).toBe(true); }
  });
});

describe("permissões e escopo", () => {
  test("sem permissão e fora da igreja não acessam nada", async () => {
    for (const u of [semPerm, fora]) { expect(msg(await rep(u, "overview"))).toContain("forbidden"); expect(msg(await u.api.rpc("rp_options", { p_org: org }))).toContain("forbidden"); }
  });
  test("cada área exige a sua permissão", async () => {
    expect((await rep(dash, "overview")).ok).toBe(true);
    for (const a of ["profile", "evolution", "family", "ministry"]) expect(msg(await rep(dash, a))).toContain("forbidden");
  });
  test("líder de ministério vê só o próprio time, sem acesso geral", async () => {
    const o = (await rep(lider, "overview")).data; expect(o.pop.total).toBe(2);
    const m = (await rep(lider, "ministry")).data; expect(m.teams.length).toBe(1); expect(m.teams[0].name).toBe("Louvor Rel");
    expect(msg(await rep(lider, "evolution"))).toContain("forbidden");
  });
  test("supervisor só enxerga a rede supervisionada", async () => {
    netA = (await ins("church_networks", { org_id: org, name: "Rede Rel" }))[0].id;
    await ins("network_teams", { network_id: netA, team_id: teamB, org_id: org });
    await grant(supervisor, "Supervisor", ["people_reports_dashboard", "people_reports_own"], "network_supervisor", netA);
    const o = (await rep(supervisor, "overview")).data; expect(o.pop.total).toBe(1); // Bruno (time B)
  });
  test("desenvolvedor/administrador da igreja vê tudo e a configuração é só administrativa", async () => {
    expect((await rep(admin, "overview")).data.pop.total).toBe(6);
    expect((await admin.api.rpc("rp_settings_get", { p_org: org })).data.can_admin).toBe(true);
    expect((await geral.api.rpc("rp_settings_get", { p_org: org })).data.can_admin).toBe(false);
  });
  test("outra igreja não vaza dados", async () => {
    const o2 = (await fora.api.rpc("create_organization", { p_name: "Outra" })).data;
    const r = await fora.api.rpc("rp_report", { p_org: o2, p_area: "overview", f: {} }); expect(r.data.pop.total).toBe(0);
    expect(msg(await fora.api.rpc("rp_report", { p_org: org, p_area: "overview", f: {} }))).toContain("forbidden");
  });
});
