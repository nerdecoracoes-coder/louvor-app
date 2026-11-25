// Expansão, Fase 1: Células, Programações e Escalas gerais (nada do Louvor é alterado).
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, anonKey, REST, Api } from "./helpers";

let admin: any, sec: any, semPerm: any, lider: any, lider2: any, sup: any, supPai: any, membro: any, convidado: any, dev: any, outro: any, anon: Api;
let org = "", org2 = "", team = "", cA = "", cB = "", cC = "", supId = "", supPaiId = "";
const P: Record<string, string> = {};
const msg = (r: any) => String(r.data?.message ?? "");
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const patch = async (q: string, b: any) => { const r = await fetch(`${REST}/${q}`, { method: "PATCH", headers: await sk(), body: JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (n: number, h = 19) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); d.setUTCHours(h + 3, 0, 0, 0); return d.toISOString(); };
const rpc = (u: any, fn: string, a: any = {}) => u.api.rpc(fn, a);
const ACT = ["cells_view", "cells_manage", "cells_members", "cells_meetings", "cells_supervision", "cells_reports", "prog_view", "prog_manage", "prog_publish", "prog_run", "roster_view", "roster_manage", "roster_approve"];
const grant = (u: any, title: string, actions: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: title, p_actions: actions });
async function person(key: string, o: any = {}, o_org = org) { const r = await ins("people", { org_id: o_org, full_name: key, classification: "member", status: "active", ...o }); P[key] = r[0].id; return r[0].id; }
const cellOf = async (u: any, id: string) => (await rpc(u, "cell_get", { p_cell: id }));
const occ = async (u: any, from: string, to: string) => (await rpc(u, "prog_occurrences", { p_org: org, p_from: from, p_to: to })).data as any[];

beforeAll(async () => {
  [admin, sec, semPerm, lider, lider2, sup, supPai, membro, convidado, dev, outro] = await Promise.all(["Admin", "Sec", "SemPerm", "Lider", "Lider2", "Sup", "SupPai", "Membro", "Convidado", "Dev", "Outro"].map(newUser));
  anon = new Api(await anonKey());
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Fase1" })).data;
  org2 = (await outro.api.rpc("create_organization", { p_name: "Outra Igreja" })).data;
  await joinChurch(admin.api, org, sec, semPerm, lider, lider2, sup, supPai, membro, dev);
  await ins("org_members", { org_id: org, user_id: convidado.id, role: "guest" });
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor F1", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [dev.id] });
  await grant(sec, "Secretaria", ACT);
  for (const [k, u] of [["Lider", lider], ["Lider2", lider2], ["Sup", sup], ["SupPai", supPai], ["Membro", membro], ["SemPerm", semPerm], ["Dev", dev]] as any) await person(k, { user_id: u.id });
  for (const k of ["Ana", "Bia", "Caio", "Duda", "Edu", "Fabi"]) await person(k);
  await person("Rejeitada", { status: "rejected" });
  await person("Estranha", {}, org2);
  await patch(`profiles?id=eq.${dev.id}`, { is_developer: true });
});

describe("infraestrutura de permissões", () => {
  test("novas ações são aceitas pelas concessões e as antigas continuam valendo", async () => {
    const r = await rows(`access_grants?org_id=eq.${org}&user_id=eq.${sec.id}`);
    expect(r[0].actions).toContain("cells_manage");
    const bad = await admin.api.rpc("grant_set", { p_org: org, p_user: sec.id, p_role: "secretary", p_network: null, p_title: "x", p_actions: ["inventada"] });
    expect(bad.ok).toBe(false);
    expect((await ins("people", { org_id: org, full_name: "Teste Antigo" })).length).toBe(1);
  });
  test("tabelas novas ficam fechadas para acesso direto", async () => {
    for (const t of ["cells", "cell_members", "prog_items", "rosters", "roster_assignments", "mod_audit"]) {
      const r = await sec.api.get(`/${t}?select=id`);
      expect(r.ok && (r.data as any[]).length > 0).toBe(false);
      const a = await anon.get(`/${t}?select=id`);
      expect(a.ok && (a.data as any[]).length > 0).toBe(false);
    }
  });
  test("o desenvolvedor não ganha acesso aos módulos por atalho", async () => {
    const r = await rpc(dev, "cell_save", { p_org: org, p_id: null, p: { name: "Dev tenta" } });
    expect(msg(r)).toBe("forbidden");
    expect(msg(await rpc(dev, "prog_save", { p_org: org, p_id: null, p: { name: "x", start_date: day(1), starts_time: "19:00" } }))).toBe("forbidden");
  });
});

describe("células — cadastro e liderança", () => {
  test("criar exige permissão de gestão; participar ou liderar não basta", async () => {
    cA = (await rpc(sec, "cell_save", { p_org: org, p_id: null, p: { name: "Célula Alfa", category: "Jovens", weekday: 3, meet_time: "20:00", frequency: "weekly", capacity: 4, modality: "in_person", address: "Rua 1" } })).data;
    expect(cA).toBeTruthy();
    expect(msg(await rpc(semPerm, "cell_save", { p_org: org, p_id: null, p: { name: "Sem perm" } }))).toBe("forbidden");
    await rpc(sec, "cell_member_add", { p_cell: cA, p_person: P.Lider, p_role: "leader" });
    expect(msg(await rpc(lider, "cell_save", { p_org: org, p_id: null, p: { name: "Líder cria" } }))).toBe("forbidden");
    expect(msg(await rpc(lider, "cell_save", { p_org: org, p_id: cA, p: { name: "Alfa editada pelo líder" } }))).toBe("forbidden");
    expect(msg(await rpc(lider, "cell_set_status", { p_cell: cA, p_active: false, p_reason: "x" }))).toBe("forbidden");
  });
  test("nome obrigatório e único; capacidade não pode ficar abaixo dos participantes", async () => {
    expect(msg(await rpc(sec, "cell_save", { p_org: org, p_id: null, p: { name: "  " } }))).toBe("name_required");
    expect(msg(await rpc(sec, "cell_save", { p_org: org, p_id: null, p: { name: "célula alfa" } }))).toBe("duplicate_name");
    cB = (await rpc(sec, "cell_save", { p_org: org, p_id: null, p: { name: "Célula Beta", modality: "online", meeting_link: "https://meet.exemplo/x" } })).data;
    cC = (await rpc(sec, "cell_save", { p_org: org, p_id: null, p: { name: "Célula Gama", modality: "hybrid" } })).data;
    await rpc(sec, "cell_member_add", { p_cell: cB, p_person: P.Lider2, p_role: "leader" });
    expect(msg(await rpc(sec, "cell_save", { p_org: org, p_id: cA, p: { name: "Célula Alfa", capacity: 0 } }))).toBeTruthy();
    expect((await rpc(sec, "cell_save", { p_org: org, p_id: cA, p: { name: "Célula Alfa", category: "Jovens", capacity: 4, weekday: 3, meet_time: "20:00", description: "Editada" } })).ok).toBe(true);
    const g = (await cellOf(sec, cA)).data;
    expect(g.cell.description).toBe("Editada");
    expect(g.cell.leaders[0].name).toBe("Lider");
  });
  test("estados e escopos: ativar/desativar exige motivo, líder vê só a própria célula", async () => {
    expect(msg(await rpc(sec, "cell_set_status", { p_cell: cC, p_active: false }))).toBe("reason_required");
    expect((await rpc(sec, "cell_set_status", { p_cell: cC, p_active: false, p_reason: "Pausa" })).ok).toBe(true);
    expect(msg(await rpc(sec, "cell_member_add", { p_cell: cC, p_person: P.Fabi }))).toBe("cell_inactive");
    expect((await rpc(sec, "cell_set_status", { p_cell: cC, p_active: true })).ok).toBe(true);
    const ids = ((await rpc(lider, "cell_list", { p_org: org })).data as any[]).map((c) => c.name);
    expect(ids).toEqual(["Célula Alfa"]);
    expect(msg(await cellOf(lider, cB))).toBe("forbidden");
    expect(((await rpc(sec, "cell_list", { p_org: org })).data as any[]).length).toBe(3);
    expect(((await rpc(semPerm, "cell_list", { p_org: org })).data as any[]).length).toBe(0);
  });
  test("outra igreja não enxerga nem altera", async () => {
    expect(msg(await cellOf(outro, cA))).toBe("forbidden");
    expect(((await rpc(outro, "cell_list", { p_org: org })).data as any[]).length).toBe(0);
    expect(msg(await rpc(outro, "cell_member_add", { p_cell: cA, p_person: P.Ana }))).toBe("forbidden");
  });
});

describe("células — participantes", () => {
  test("líder da célula gerencia participantes, mas não nomeia liderança", async () => {
    expect((await rpc(lider, "cell_member_add", { p_cell: cA, p_person: P.Ana })).ok).toBe(true);
    expect((await rpc(lider, "cell_member_add", { p_cell: cA, p_person: P.Membro })).ok).toBe(true);
    expect(msg(await rpc(lider, "cell_member_add", { p_cell: cA, p_person: P.Bia, p_role: "leader" }))).toBe("forbidden");
    expect(msg(await rpc(lider, "cell_member_add", { p_cell: cB, p_person: P.Bia }))).toBe("forbidden");
  });
  test("quem só participa não ganha acesso administrativo", async () => {
    expect(msg(await cellOf(membro, cA))).toBe("forbidden");
    expect(msg(await rpc(membro, "cell_member_add", { p_cell: cA, p_person: P.Bia }))).toBe("forbidden");
    expect(msg(await rpc(membro, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-1) } }))).toBe("forbidden");
  });
  test("vínculo único, lotação e pessoas inválidas", async () => {
    expect(msg(await rpc(sec, "cell_member_add", { p_cell: cB, p_person: P.Ana }))).toBe("already_in_cell");
    expect((await rpc(sec, "cell_member_add", { p_cell: cA, p_person: P.Bia })).ok).toBe(true);
    expect(msg(await rpc(sec, "cell_member_add", { p_cell: cA, p_person: P.Caio }))).toBe("cell_full");
    expect(msg(await rpc(sec, "cell_member_add", { p_cell: cB, p_person: P.Rejeitada }))).toBe("person_not_active");
    expect(msg(await rpc(sec, "cell_member_add", { p_cell: cB, p_person: P.Estranha }))).toBe("person_not_found");
    expect(msg(await rpc(sec, "cell_save", { p_org: org, p_id: cA, p: { name: "Célula Alfa", capacity: 2 } }))).toBe("capacity_below_members");
  });
  test("remover preserva o histórico, com motivo", async () => {
    const m = (await cellOf(sec, cA)).data.members.find((x: any) => x.name === "Bia");
    expect((await rpc(lider, "cell_member_remove", { p_member: m.id, p_reason: "Mudou de cidade" })).ok).toBe(true);
    const g = (await cellOf(sec, cA)).data;
    expect(g.members.find((x: any) => x.name === "Bia")).toBeUndefined();
    expect(g.past.find((x: any) => x.name === "Bia").reason).toBe("Mudou de cidade");
    const h = (await rpc(sec, "cell_person_history", { p_org: org, p_person: P.Bia })).data;
    expect(h[0].status).toBe("left");
    expect(g.history.some((x: any) => x.action === "member_remove")).toBe(true);
  });
  test("transferência fecha o vínculo antigo e abre o novo, sem apagar nada", async () => {
    expect(msg(await rpc(lider, "cell_transfer", { p_person: P.Ana, p_to: cB }))).toBe("forbidden");
    expect(msg(await rpc(sec, "cell_transfer", { p_person: P.Lider, p_to: cB }))).toBe("leader_cannot_transfer");
    expect(msg(await rpc(sec, "cell_transfer", { p_person: P.Ana, p_to: cA }))).toBe("same_cell");
    expect(msg(await rpc(sec, "cell_transfer", { p_person: P.Fabi, p_to: cB }))).toBe("no_active_link");
    expect((await rpc(sec, "cell_transfer", { p_person: P.Ana, p_to: cB, p_reason: "Mais perto de casa" })).ok).toBe(true);
    const h = (await rpc(sec, "cell_person_history", { p_org: org, p_person: P.Ana })).data;
    expect(h.map((x: any) => x.cell + ":" + x.status)).toEqual(["Célula Beta:active", "Célula Alfa:left"]);
    const b = (await cellOf(sec, cB)).data;
    expect(b.history.some((x: any) => x.action === "transfer_in")).toBe(true);
  });
  test("pessoas sem vínculo ativo são identificadas só para quem tem permissão", async () => {
    const u = (await rpc(sec, "cell_unlinked", { p_org: org })).data.map((x: any) => x.name);
    expect(u).toContain("Bia"); expect(u).toContain("Caio"); expect(u).not.toContain("Ana"); expect(u).not.toContain("Rejeitada");
    expect(msg(await rpc(semPerm, "cell_unlinked", { p_org: org }))).toBe("forbidden");
    expect(msg(await rpc(lider, "cell_unlinked", { p_org: org }))).toBe("forbidden");
  });
});

describe("células — reuniões e frequência", () => {
  let m1 = "";
  test("registrar reunião com presenças e visitantes", async () => {
    await rpc(sec, "cell_member_add", { p_cell: cA, p_person: P.Duda });
    const att = [{ person_id: P.Membro, present: true }, { person_id: P.Duda, present: false }, { person_id: P.Lider, present: true }];
    const r = await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-10), responsible_person_id: P.Lider, notes: "Boa noite", attendance: att, visitors: [{ name: "Visitante Um" }, { name: "Visitante Dois", person_id: P.Edu }] } });
    expect(r.ok).toBe(true); m1 = r.data;
    const g = (await rpc(lider, "cell_meeting_get", { p_meeting: m1 })).data;
    expect(g.present).toBe(2); expect(g.visitors_count).toBe(2); expect(g.attendance.length).toBe(3); expect(g.visitors.length).toBe(2); expect(g.responsible).toBe("Lider");
  });
  test("validações: data futura, duplicidade, presença de quem não é da célula, cancelamento com motivo", async () => {
    expect(msg(await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(5) } }))).toBe("future_date");
    expect(msg(await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-10) } }))).toBe("meeting_exists");
    expect(msg(await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-9), attendance: [{ person_id: P.Fabi }] } }))).toBe("not_a_member");
    expect(msg(await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-9), status: "cancelled" } }))).toBe("reason_required");
    expect(msg(await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-9), visitors: [{ name: " " }] } }))).toBe("visitor_name_required");
    expect(msg(await rpc(lider2, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-9) } }))).toBe("forbidden");
    expect((await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-3), status: "cancelled", cancel_reason: "Feriado" } })).ok).toBe(true);
  });
  test("contagem manual e edição preservam o registro anterior no histórico", async () => {
    expect((await rpc(lider2, "cell_meeting_save", { p_cell: cB, p: { meeting_date: day(-8), present_count: 7, visitors: [{ name: "V" }] } })).ok).toBe(true);
    expect((await rpc(lider, "cell_meeting_save", { p_cell: cA, p: { id: m1, meeting_date: day(-10), notes: "Corrigida", attendance: [{ person_id: P.Membro, present: true }, { person_id: P.Duda, present: true }], visitors: [] } })).ok).toBe(true);
    const g = (await rpc(lider, "cell_meeting_get", { p_meeting: m1 })).data;
    expect(g.present).toBe(2); expect(g.visitors_count).toBe(0);
    const h = (await cellOf(sec, cA)).data.history.find((x: any) => x.action === "meeting_edit");
    expect(h.detail.before.visitors).toBe(2);
  });
});

describe("células — supervisão configurável e relatórios", () => {
  test("estrutura de supervisão sem hierarquia fixa, sem ciclos", async () => {
    expect(msg(await rpc(lider, "cell_sup_save", { p_org: org, p_id: null, p_person: P.Sup, p_title: "x", p_parent: null, p_active: true }))).toBe("forbidden");
    supPaiId = (await rpc(sec, "cell_sup_save", { p_org: org, p_id: null, p_person: P.SupPai, p_title: "Coordenador de área", p_parent: null, p_active: true })).data;
    supId = (await rpc(sec, "cell_sup_save", { p_org: org, p_id: null, p_person: P.Sup, p_title: "Supervisor", p_parent: supPaiId, p_active: true })).data;
    expect(msg(await rpc(sec, "cell_sup_save", { p_org: org, p_id: supPaiId, p_person: P.SupPai, p_title: "Coordenador", p_parent: supId, p_active: true }))).toBe("invalid_parent");
    expect(msg(await rpc(sec, "cell_sup_save", { p_org: org, p_id: supId, p_person: P.Sup, p_title: "Sup", p_parent: supId, p_active: true }))).toBe("invalid_parent");
    await rpc(sec, "cell_save", { p_org: org, p_id: cA, p: { name: "Célula Alfa", category: "Jovens", capacity: 3, supervisor_id: supId } });
    await rpc(sec, "cell_save", { p_org: org, p_id: cB, p: { name: "Célula Beta", modality: "online", supervisor_id: supPaiId } });
    const l = (await rpc(sec, "cell_sup_list", { p_org: org })).data;
    expect(l.length).toBe(2);
  });
  test("o supervisor enxerga e acompanha só o que supervisiona (inclusive abaixo na estrutura)", async () => {
    expect(((await rpc(sup, "cell_list", { p_org: org })).data as any[]).map((c) => c.name)).toEqual(["Célula Alfa"]);
    expect(((await rpc(supPai, "cell_list", { p_org: org })).data as any[]).map((c) => c.name).sort()).toEqual(["Célula Alfa", "Célula Beta"]);
    expect(msg(await cellOf(sup, cB))).toBe("forbidden");
    expect(msg(await rpc(sup, "cell_save", { p_org: org, p_id: cA, p: { name: "Sup edita" } }))).toBe("forbidden");
    expect((await rpc(sup, "cell_meeting_save", { p_cell: cA, p: { meeting_date: day(-2), present_count: 3 } })).ok).toBe(true);
  });
  test("relatório da igreja: totais, frequência, visitantes, séries e células sem reunião", async () => {
    const r = (await rpc(sec, "cell_report", { p_org: org, p_from: day(-60), p_to: day(0) })).data;
    expect(r.scope).toBe("church");
    expect(r.cells_total).toBe(3); expect(r.cells_active).toBe(3); expect(r.cells_inactive).toBe(0);
    expect(r.participants).toBe(5);
    expect(r.meetings_held).toBe(3); expect(r.meetings_cancelled).toBe(1);
    expect(r.present_total).toBe(2 + 7 + 3); expect(r.visitors_total).toBe(1);
    expect(r.without_meetings.map((c: any) => c.name)).toEqual(["Célula Gama"]);
    expect(r.unlinked).toBeGreaterThan(0);
    expect(Array.isArray(r.series) && r.series.length >= 2).toBe(true);
    expect(r.per_supervisor.length).toBe(2);
    expect(r.per_cell.length).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/saude|saúde|health/i);
  });
  test("relatório com escopo próprio e permissões", async () => {
    const own = (await rpc(lider, "cell_report", { p_org: org, p_from: day(-60), p_to: day(0) })).data;
    expect(own.scope).toBe("own"); expect(own.cells_total).toBe(1); expect(own.unlinked).toBeNull();
    const s = (await rpc(sup, "cell_report", { p_org: org, p_from: day(-60), p_to: day(0) })).data;
    expect(s.cells_total).toBe(1);
    expect(msg(await rpc(semPerm, "cell_report", { p_org: org, p_from: day(-60), p_to: day(0) }))).toBe("forbidden");
    expect(msg(await rpc(sec, "cell_report", { p_org: org, p_from: day(0), p_to: day(-5) }))).toBe("invalid_period");
  });
});

describe("programações", () => {
  let pCulto = "", pQuinz = "", pMes = "", pDias = "", pDatas = "", pRascunho = "", pLideres = "", pPublica = "";
  const base = { category: "culto", starts_time: "19:00", ends_time: "21:00", location: "Templo", visibility: "members" };
  test("cadastrar exige permissão de gestão e valida os dados", async () => {
    expect(msg(await rpc(semPerm, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x", start_date: "2027-01-03" } }))).toBe("forbidden");
    expect(msg(await rpc(lider, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x", start_date: "2027-01-03" } }))).toBe("forbidden");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "", start_date: "2027-01-03" } }))).toBe("name_required");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x" } }))).toBe("date_required");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x", start_date: "2027-01-03", ends_time: "18:00" } }))).toBe("invalid_time");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x", start_date: "2027-01-03", recurrence: { freq: "sempre" } } }))).toBe("invalid_recurrence");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x", start_date: "2027-01-03", recurrence: { freq: "weekdays", weekdays: [] } } }))).toBe("weekdays_required");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "x", start_date: "2027-01-03", recurrence: { freq: "weekly", until: "2026-01-01" } } }))).toBe("invalid_until");
  });
  test("recorrência: semanal, quinzenal, mensal, dias específicos, datas e fim", async () => {
    pCulto = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Culto de domingo", start_date: "2027-01-03", recurrence: { freq: "weekly" } } })).data;
    pQuinz = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Reunião de líderes", category: "reuniao", start_date: "2027-01-05", recurrence: { freq: "biweekly" } } })).data;
    pMes = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Ceia", category: "especial", start_date: "2027-01-31", recurrence: { freq: "monthly" } } })).data;
    pDias = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Oração", category: "oracao", start_date: "2027-01-04", recurrence: { freq: "weekdays", weekdays: [1, 3, 5], until: "2027-01-15" } } })).data;
    pDatas = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Vigílias", category: "vigilia", start_date: "2027-01-01", recurrence: { freq: "dates", dates: ["2027-02-20", "2027-01-09", "2027-03-13"] } } })).data;
    for (const id of [pCulto, pQuinz, pMes, pDias, pDatas]) await rpc(sec, "prog_set_status", { p_id: id, p_status: "published" });
    const jan = (await occ(sec, "2027-01-01", "2027-02-28"));
    const by = (id: string) => jan.filter((o) => o.prog_id === id).map((o) => o.date);
    expect(by(pCulto).length).toBe(9); expect(by(pCulto)[0]).toBe("2027-01-03");
    expect(by(pQuinz)).toEqual(["2027-01-05", "2027-01-19", "2027-02-02", "2027-02-16"]);
    expect(by(pMes)).toEqual(["2027-01-31", "2027-02-28"]);
    expect(by(pDias)).toEqual(["2027-01-04", "2027-01-06", "2027-01-08", "2027-01-11", "2027-01-13", "2027-01-15"]);
    expect(by(pDatas)).toEqual(["2027-01-09", "2027-02-20"]);
    expect((await rpc(sec, "prog_occurrences", { p_org: org, p_from: "2027-01-01", p_to: "2029-01-01" })).ok).toBe(false);
  });
  test("exceções e cancelamentos não apagam o histórico", async () => {
    expect(msg(await rpc(sec, "prog_exception_set", { p_id: pCulto, p_date: "2027-01-10", p_kind: "cancel" }))).toBe("reason_required");
    expect(msg(await rpc(sec, "prog_exception_set", { p_id: pCulto, p_date: "2027-01-11", p_kind: "cancel", p_reason: "x" }))).toBe("not_an_occurrence");
    expect((await rpc(sec, "prog_exception_set", { p_id: pCulto, p_date: "2027-01-10", p_kind: "cancel", p_reason: "Viagem do pastor" })).ok).toBe(true);
    expect((await rpc(sec, "prog_exception_set", { p_id: pCulto, p_date: "2027-01-17", p_kind: "modify", p: { starts_time: "18:00", ends_time: "20:00", location: "Salão", note: "Local alterado" } })).ok).toBe(true);
    const o = await occ(membro, "2027-01-10", "2027-01-17");
    const c = o.filter((x) => x.prog_id === pCulto);
    expect(c[0].status).toBe("cancelled"); expect(c[1].starts_time).toBe("18:00:00"); expect(c[1].location).toBe("Salão"); expect(c[1].modified).toBe(true);
    await rpc(sec, "prog_exception_clear", { p_id: pCulto, p_date: "2027-01-10", p_reason: "Pastor voltou" });
    expect((await occ(membro, "2027-01-10", "2027-01-10")).find((x) => x.prog_id === pCulto).status).toBe("scheduled");
    const g = (await rpc(sec, "prog_get", { p_id: pCulto })).data;
    expect(g.exceptions.length).toBe(2); expect(g.exceptions.some((e: any) => e.voided_at)).toBe(true);
    expect(g.history.some((h: any) => h.action === "exception_clear")).toBe(true);
    expect(msg(await rpc(lider, "prog_exception_set", { p_id: pCulto, p_date: "2027-01-24", p_kind: "cancel", p_reason: "x" }))).toBe("forbidden");
  });
  test("publicar, despublicar e cancelar a programação inteira", async () => {
    pRascunho = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Rascunho", start_date: "2027-01-06" } })).data;
    expect((await occ(membro, "2027-01-01", "2027-01-31")).some((o) => o.prog_id === pRascunho)).toBe(false);
    expect((await occ(sec, "2027-01-01", "2027-01-31")).some((o) => o.prog_id === pRascunho)).toBe(true);
    await ins("access_grants", { org_id: org, user_id: lider2.id, role_key: "secretary", title: "Só gestão", actions: ["prog_manage"] });
    expect(msg(await rpc(lider2, "prog_set_status", { p_id: pRascunho, p_status: "published" }))).toBe("forbidden");
    expect(msg(await rpc(semPerm, "prog_set_status", { p_id: pRascunho, p_status: "published" }))).toBe("forbidden");
    expect((await rpc(sec, "prog_set_status", { p_id: pRascunho, p_status: "published" })).ok).toBe(true);
    expect((await occ(membro, "2027-01-01", "2027-01-31")).some((o) => o.prog_id === pRascunho)).toBe(true);
    await rpc(sec, "prog_set_status", { p_id: pRascunho, p_status: "draft" });
    expect((await occ(membro, "2027-01-01", "2027-01-31")).some((o) => o.prog_id === pRascunho)).toBe(false);
    expect(msg(await rpc(sec, "prog_set_status", { p_id: pRascunho, p_status: "cancelled" }))).toBe("reason_required");
    await rpc(sec, "prog_set_status", { p_id: pRascunho, p_status: "cancelled", p_reason: "Cancelada pela diretoria" });
    expect(msg(await rpc(sec, "prog_set_status", { p_id: pRascunho, p_status: "published" }))).toBe("program_cancelled");
    expect(msg(await rpc(sec, "prog_save", { p_org: org, p_id: pRascunho, p: { ...base, name: "Reabrir", start_date: "2027-01-06" } }))).toBe("program_cancelled");
    const g = (await rpc(sec, "prog_get", { p_id: pRascunho })).data;
    expect(g.program.status).toBe("cancelled"); expect(g.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(["create", "publish", "unpublish", "cancel"]));
  });
  test("visibilidade: pública, membros e liderança; não-membros e convidados", async () => {
    pLideres = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Só liderança", start_date: "2027-01-07", visibility: "leaders" } })).data;
    pPublica = (await rpc(sec, "prog_save", { p_org: org, p_id: null, p: { ...base, name: "Aberta ao público", start_date: "2027-01-08", visibility: "public" } })).data;
    for (const id of [pLideres, pPublica]) await rpc(sec, "prog_set_status", { p_id: id, p_status: "published" });
    const names = async (u: any) => (await occ(u, "2027-01-07", "2027-01-08")).filter((o) => [pLideres, pPublica].includes(o.prog_id)).map((o) => o.name).sort();
    expect(await names(membro)).toEqual(["Aberta ao público"]);
    expect(await names(convidado)).toEqual(["Aberta ao público"]);
    expect(await names(sec)).toEqual(["Aberta ao público", "Só liderança"]);
    await patch(`team_members?team_id=eq.${team}&user_id=eq.${dev.id}`, { is_leader: true });
    expect(await names(dev)).toEqual(["Aberta ao público", "Só liderança"]);
    expect((await rpc(outro, "prog_occurrences", { p_org: org, p_from: "2027-01-07", p_to: "2027-01-08" })).ok).toBe(false);
    expect(msg(await rpc(membro, "prog_list", { p_org: org }))).toBe("forbidden");
  });
  test("ordem de atividades configurável, por programação e por data, com alterações registradas", async () => {
    const items = [{ title: "Abertura", planned_time: "19:00", duration_min: 10, responsible_person_id: P.Lider }, { title: "Louvor", planned_time: "19:10", duration_min: 30 }, { title: "Palavra", planned_time: "19:40", duration_min: 40, notes: "Série" }];
    expect(msg(await rpc(semPerm, "prog_agenda_save", { p_id: pCulto, p_date: null, p_items: items }))).toBe("forbidden");
    expect((await rpc(sec, "prog_agenda_save", { p_id: pCulto, p_date: null, p_items: items })).ok).toBe(true);
    expect(msg(await rpc(sec, "prog_agenda_save", { p_id: pCulto, p_date: null, p_items: [{ title: "" }] }))).toBe("title_required");
    expect(msg(await rpc(sec, "prog_agenda_save", { p_id: pCulto, p_date: "2027-01-11", p_items: items }))).toBe("not_an_occurrence");
    const a1 = (await rpc(sec, "prog_agenda_get", { p_id: pCulto, p_date: "2027-01-24" })).data;
    expect(a1.specific).toBe(false); expect(a1.items.map((i: any) => i.title)).toEqual(["Abertura", "Louvor", "Palavra"]);
    await rpc(sec, "prog_agenda_save", { p_id: pCulto, p_date: "2027-01-24", p_items: [{ title: "Santa Ceia" }, { title: "Mensagem" }] });
    const a2 = (await rpc(sec, "prog_agenda_get", { p_id: pCulto, p_date: "2027-01-24" })).data;
    expect(a2.specific).toBe(true); expect(a2.items.map((i: any) => i.title)).toEqual(["Santa Ceia", "Mensagem"]);
    await rpc(sec, "prog_agenda_save", { p_id: pCulto, p_date: null, p_items: [{ title: "Palavra" }, { title: "Louvor" }] });
    const h = (await rpc(sec, "prog_get", { p_id: pCulto })).data.history.filter((x: any) => x.action === "agenda_save");
    expect(h.length).toBe(3); expect(h[0].detail.before.length).toBe(3);
    expect(msg(await rpc(membro, "prog_agenda_get", { p_id: pCulto, p_date: null }))).toBe("forbidden");
  });
});

describe("escalas gerais", () => {
  let r1 = "", r2 = "", rPast = "", a: Record<string, string> = {};
  const assign = (...ks: string[]) => ks.map((k, i) => ({ person_id: P[k], function: ["Recepção", "Som", "Mídia", "Coordenação"][i] }));
  test("criar rascunho: só com permissão; rascunho não aparece para os escalados", async () => {
    expect(msg(await rpc(semPerm, "roster_save", { p_org: org, p_id: null, p: { title: "x", starts_at: at(5) } }))).toBe("forbidden");
    expect(msg(await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "", starts_at: at(5) } }))).toBe("name_required");
    expect(msg(await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "x", starts_at: at(5), assignments: [{ person_id: P.Estranha }] } }))).toBe("person_not_active");
    expect(msg(await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "x", starts_at: at(5), assignments: assign("Ana", "Ana") } }))).toBe("duplicate_person");
    r1 = (await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "Recepção do domingo", activity: "Recepção", starts_at: at(5, 18), ends_at: at(5, 21), assignments: assign("Membro", "Lider", "Ana") } })).data;
    expect(r1).toBeTruthy();
    expect((await rpc(sec, "roster_get", { p_id: r1 })).data.roster.status).toBe("draft");
    expect(msg(await rpc(membro, "roster_get", { p_id: r1 }))).toBe("forbidden");
    expect(((await rpc(membro, "roster_list", { p_org: org, p_from: day(0), p_to: day(30), p_mine: true })).data as any[]).length).toBe(0);
    expect(msg(await rpc(sec, "roster_publish", { p_id: (await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "Vazia", starts_at: at(9) } })).data }))).toBe("no_people");
  });
  test("publicar convida (notificação) e detecta conflitos de horário, indisponibilidade e Louvor", async () => {
    // conflito com outra escala publicada
    const rx = (await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "Outra", starts_at: at(5, 19), ends_at: at(5, 20), assignments: assign("Membro") } })).data;
    expect((await rpc(sec, "roster_publish", { p_id: rx })).data.ok).toBe(true);
    const bloq = (await rpc(sec, "roster_publish", { p_id: r1 })).data;
    expect(bloq.ok).toBe(false); expect(bloq.conflicts.map((c: any) => c.kind)).toContain("overlap");
    expect((await rpc(sec, "roster_get", { p_id: r1 })).data.roster.status).toBe("draft");
    // indisponibilidade informada pela pessoa
    await ins("unavailability", { org_id: org, user_id: lider.id, start_date: day(5), end_date: day(5), all_day: true, note: "Viagem" });
    // escala do Louvor (somente leitura)
    const sch = await ins("schedules", { org_id: org, team_id: team, title: "Louvor de domingo", starts_at: at(5, 18), ends_at: at(5, 21), status: "published" });
    await ins("schedule_assignments", { schedule_id: sch[0].id, org_id: org, team_id: team, user_id: dev.id });
    await person("Ana2", { user_id: dev.id }).catch(() => null);
    const kinds = (await rpc(sec, "roster_check", { p_org: org, p_starts: at(5, 18), p_ends: at(5, 21), p_persons: [P.Membro, P.Lider, P.Dev], p_exclude: r1 })).data.map((c: any) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["overlap", "unavailable", "louvor"]));
    // desfaz o conflito de horário e publica forçando o restante
    await rpc(sec, "roster_cancel", { p_id: rx, p_reason: "Substituída" });
    const f = (await rpc(sec, "roster_publish", { p_id: r1 })).data;
    expect(f.ok).toBe(false);
    const ok = (await rpc(sec, "roster_publish", { p_id: r1, p_force: true })).data;
    expect(ok.ok).toBe(true);
    const g = (await rpc(sec, "roster_get", { p_id: r1 })).data;
    expect(g.roster.status).toBe("awaiting");
    expect(g.history.find((h: any) => h.action === "publish").detail.forced).toBe(true);
    for (const x of g.assignments) a[x.name] = x.id;
    const n = await rows(`notifications?user_id=eq.${membro.id}&kind=eq.roster_invite`);
    expect(n.length).toBeGreaterThan(0);
    expect(msg(await rpc(sec, "roster_publish", { p_id: r1 }))).toBe("not_draft");
  });
  test("confirmar e recusar: só a própria pessoa; situação da escala acompanha as respostas", async () => {
    expect(msg(await rpc(lider, "roster_respond", { p_assignment: a.Membro, p_answer: "confirm" }))).toBe("forbidden");
    expect(msg(await rpc(sec, "roster_respond", { p_assignment: a.Membro, p_answer: "confirm" }))).toBe("forbidden");
    expect(msg(await rpc(membro, "roster_respond", { p_assignment: a.Membro, p_answer: "talvez" }))).toBe("invalid_answer");
    expect((await rpc(membro, "roster_respond", { p_assignment: a.Membro, p_answer: "confirm" })).ok).toBe(true);
    expect((await rpc(sec, "roster_get", { p_id: r1 })).data.roster.status).toBe("partial");
    expect((await rpc(lider, "roster_respond", { p_assignment: a.Lider, p_answer: "decline", p_reason: "Compromisso" })).ok).toBe(true);
    const mine = (await rpc(lider, "roster_list", { p_org: org, p_from: day(0), p_to: day(30), p_mine: true })).data;
    expect(mine.length).toBe(1); expect(mine[0].my_status).toBe("declined");
    expect(((await rpc(lider, "roster_get", { p_id: r1 })).data.history)).toBeNull();
    const hist = (await rpc(sec, "roster_get", { p_id: r1 })).data.history.map((h: any) => h.action);
    expect(hist).toEqual(expect.arrayContaining(["confirmed", "declined"]));
    expect((await rpc(lider, "roster_respond", { p_assignment: a.Lider, p_answer: "confirm" })).ok).toBe(true);
    const sx = (await rpc(sec, "roster_get", { p_id: r1 })).data;
    expect(sx.roster.status).toBe("partial");
    expect(sx.roster.confirmed).toBe(2);
  });
  test("substituição: pedido, conflito do substituto, aprovação e rejeição", async () => {
    // Ana confirma; pede substituição por Bia
    const ana = await newUser("AnaUser"); await joinChurch(admin.api, org, ana);
    await patch(`people?id=eq.${P.Ana}`, { user_id: ana.id });
    expect((await rpc(ana, "roster_respond", { p_assignment: a.Ana, p_answer: "confirm" })).ok).toBe(true);
    expect((await rpc(sec, "roster_get", { p_id: r1 })).data.roster.status).toBe("confirmed");
    expect(msg(await rpc(membro, "roster_sub_request", { p_assignment: a.Ana, p_substitute: P.Bia }))).toBe("forbidden");
    const sub = (await rpc(ana, "roster_sub_request", { p_assignment: a.Ana, p_substitute: P.Bia, p_reason: "Doente" })).data;
    expect((await rpc(sec, "roster_get", { p_id: r1 })).data.roster.status).toBe("partial");
    expect(msg(await rpc(ana, "roster_sub_decide", { p_sub: sub, p_approve: true }))).toBe("forbidden");
    expect(msg(await rpc(membro, "roster_sub_decide", { p_sub: sub, p_approve: true }))).toBe("forbidden");
    // substituto indisponível → exige confirmação do gestor
    await ins("unavailability", { org_id: org, user_id: (await newUser("BiaUser").then(async (u) => { await joinChurch(admin.api, org, u); await patch(`people?id=eq.${P.Bia}`, { user_id: u.id }); return u; })).id, start_date: day(5), end_date: day(5), all_day: true });
    const bloq = (await rpc(sec, "roster_sub_decide", { p_sub: sub, p_approve: true })).data;
    expect(bloq.ok).toBe(false);
    expect((await rpc(sec, "roster_sub_decide", { p_sub: sub, p_approve: true, p_force: true })).data.ok).toBe(true);
    const g = (await rpc(sec, "roster_get", { p_id: r1 })).data;
    expect(g.assignments.map((x: any) => x.name)).toContain("Bia");
    expect(g.assignments.map((x: any) => x.name)).not.toContain("Ana");
    expect(g.assignments.find((x: any) => x.name === "Bia").status).toBe("invited");
    expect(g.subs[0].status).toBe("approved");
    expect(msg(await rpc(sec, "roster_sub_decide", { p_sub: sub, p_approve: false }))).toBe("already_decided");
    // rejeição devolve a pessoa à escala
    const sub2 = (await rpc(membro, "roster_sub_request", { p_assignment: a.Membro, p_reason: "Imprevisto" })).data;
    expect(msg(await rpc(sec, "roster_sub_decide", { p_sub: sub2, p_approve: true }))).toBe("substitute_required");
    expect((await rpc(sec, "roster_sub_decide", { p_sub: sub2, p_approve: false, p_note: "Preciso de você" })).data.ok).toBe(true);
    expect((await rpc(sec, "roster_get", { p_id: r1 })).data.assignments.find((x: any) => x.name === "Membro").status).toBe("invited");
  });
  test("a permissão específica de aprovação decide substituições sem poder criar escalas", async () => {
    const ap = await newUser("Aprovador"); await joinChurch(admin.api, org, ap);
    await ins("access_grants", { org_id: org, user_id: ap.id, role_key: "secretary", title: "Aprova", actions: ["roster_approve"] });
    const sub = (await rpc(membro, "roster_sub_request", { p_assignment: a.Membro, p_substitute: P.Caio })).data;
    expect((await rpc(ap, "roster_sub_decide", { p_sub: sub, p_approve: false })).data.ok).toBe(true);
    expect(msg(await rpc(ap, "roster_save", { p_org: org, p_id: null, p: { title: "x", starts_at: at(6) } }))).toBe("forbidden");
    expect((await rpc(ap, "roster_get", { p_id: r1 })).data.assignments.length).toBe(3);
  });
  test("cancelar exige motivo, avisa os escalados e encerra; concluir só depois do início", async () => {
    r2 = (await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "Recepção futura", starts_at: at(8), assignments: assign("Edu", "Fabi") } })).data;
    await rpc(sec, "roster_publish", { p_id: r2 });
    expect(msg(await rpc(sec, "roster_complete", { p_id: r2 }))).toBe("not_started");
    expect(msg(await rpc(sec, "roster_cancel", { p_id: r2, p_reason: " " }))).toBe("reason_required");
    expect(msg(await rpc(semPerm, "roster_cancel", { p_id: r2, p_reason: "x" }))).toBe("forbidden");
    expect((await rpc(sec, "roster_cancel", { p_id: r2, p_reason: "Evento adiado" })).ok).toBe(true);
    const g = (await rpc(sec, "roster_get", { p_id: r2 })).data;
    expect(g.roster.status).toBe("cancelled"); expect(g.roster.cancel_reason).toBe("Evento adiado"); expect(g.assignments.length).toBe(2);
    expect(msg(await rpc(sec, "roster_save", { p_org: org, p_id: r2, p: { title: "x", starts_at: at(8) } }))).toBe("roster_closed");
    rPast = (await rpc(sec, "roster_save", { p_org: org, p_id: null, p: { title: "Culto passado", starts_at: at(-1, 10), ends_at: at(-1, 12), assignments: assign("Duda") } })).data;
    await rpc(sec, "roster_publish", { p_id: rPast, p_force: true });
    const aid = (await rpc(sec, "roster_get", { p_id: rPast })).data.assignments[0].id;
    expect((await rpc(sec, "roster_complete", { p_id: rPast })).ok).toBe(true);
    expect((await rpc(sec, "roster_get", { p_id: rPast })).data.roster.status).toBe("completed");
    expect(msg(await rpc(sec, "roster_complete", { p_id: rPast }))).toBe("roster_closed");
    void aid;
  });
  test("edição de escala publicada: quem sai é registrado, quem entra é convidado", async () => {
    expect((await rpc(sec, "roster_save", { p_org: org, p_id: r1, p: { title: "Recepção do domingo", activity: "Recepção", starts_at: at(5, 18), ends_at: at(5, 21), assignments: assign("Membro", "Bia", "Caio") } })).ok).toBe(true);
    const g = (await rpc(sec, "roster_get", { p_id: r1 })).data;
    expect(g.assignments.length).toBe(3);
    expect(g.assignments.map((x: any) => x.name).sort()).toEqual(["Bia", "Caio", "Membro"]);
    expect(g.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(["person_added", "person_removed", "edit"]));
  });
  test("o Ministério de Louvor não é alterado por nenhuma operação", async () => {
    const s = await rows(`schedules?org_id=eq.${org}&select=id,title,status,updated_at`);
    expect(s.length).toBe(1); expect(s[0].title).toBe("Louvor de domingo"); expect(s[0].status).toBe("published");
    expect((await rows(`schedule_assignments?org_id=eq.${org}&select=id`)).length).toBe(1);
    expect((await rows(`mod_audit?org_id=eq.${org}&module=eq.roster&select=id`)).length).toBeGreaterThan(5);
  });
});
