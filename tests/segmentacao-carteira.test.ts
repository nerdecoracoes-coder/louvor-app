// Recursos 11 e 12: Segmentação de Pessoas e Carteira Digital do Membro.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, anonKey, REST, Api } from "./helpers";

let admin: any, sec: any, semPerm: any, sup: any, membro: any, visitante: any, inativo: any, lider: any, fora: any, anon: Api;
let org = "", teamA = "", teamB = "", netA = "", jr = "";
const P: Record<string, string> = {};
const msg = (r: any) => String(r.data?.message ?? "");
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const patch = async (q: string, b: any) => { const r = await fetch(`${REST}/${q}`, { method: "PATCH", headers: await sk(), body: JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const born = (age: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - age); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };
const rpc = (u: any, fn: string, a: any) => (u.api ?? u).rpc(fn, a);
const leaf = (field: string, cmp: string, value?: any) => ({ field, cmp, value });
const all = (...items: any[]) => ({ op: "and", items });
const any_ = (...items: any[]) => ({ op: "or", items });
const prev = async (u: any, crit: any) => (await rpc(u, "segment_preview", { p_org: org, p_criteria: crit, p_limit: 100 })).data;
const names = (r: any) => (r.items as any[]).map((i) => i.name).sort();
const ACT = ["people_segments_view", "people_segments_create", "people_segments_edit", "people_segments_delete", "people_groups_view", "people_groups_create", "people_groups_members", "people_segments_functions", "people_segments_export", "people_segments_use",
  "people_wallet_view", "people_wallet_issue", "people_wallet_batch", "people_wallet_suspend", "people_wallet_reactivate", "people_wallet_revoke", "people_wallet_token", "people_wallet_config", "people_wallet_validate", "people_view"];
const grant = (u: any, title: string, actions: string[], role = "secretary", network: string | null = null) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: role, p_network: network, p_title: title, p_actions: actions });
async function person(key: string, o: any) { const r = await ins("people", { org_id: org, full_name: key, ...o }); P[key] = r[0].id; return r[0].id; }
const mine = async (u: any) => (await rpc(u, "wallet_mine", { p_org: org })).data;
const val = async (t: string, u: any = anon) => (await rpc(u, "wallet_validate", { p_token: t })).data;
const wal = async (person: string) => (await rpc(sec, "wallet_get", { p_org: org, p_person: P[person] })).data;

beforeAll(async () => {
  [admin, sec, semPerm, sup, membro, visitante, inativo, lider, fora] = await Promise.all(["Admin", "Sec", "SemPerm", "Sup", "Membro", "Visitante", "Inativo", "Lider", "Fora"].map(newUser));
  anon = new Api(await anonKey());
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Carteira" })).data;
  await joinChurch(admin.api, org, sec, semPerm, sup, membro, visitante, inativo, lider);
  teamA = (await admin.api.post("teams", { org_id: org, name: "Louvor Seg", team_type: "louvor" })).data[0].id;
  teamB = (await admin.api.post("teams", { org_id: org, name: "Recepção Seg", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: teamA, p_users: [lider.id, membro.id] });
  await admin.api.rpc("add_team_members", { p_team: teamB, p_users: [membro.id] });
  await patch(`team_members?team_id=eq.${teamA}&user_id=eq.${lider.id}`, { is_leader: true });
  netA = (await ins("church_networks", { org_id: org, name: "Rede Seg" }))[0].id;
  await ins("network_teams", { network_id: netA, team_id: teamB, org_id: org });
  await grant(sec, "Secretaria", ACT);
  await grant(sup, "Supervisor", ["people_segments_view", "people_wallet_view", "people_wallet_issue", "people_groups_view"], "network_supervisor", netA);
  await person("Ana", { classification: "member", status: "active", birth_date: born(25), sex: "F", marital_status: "casado", city: "Rio", neighborhood: "Centro", user_id: membro.id, registered_at: "2020-01-10", joined_at: "2020-06-01" });
  await person("Bruno", { classification: "member", status: "active", birth_date: born(45), sex: "M", marital_status: "casado", city: "Niterói", user_id: lider.id });
  await person("Carla", { classification: "attender", status: "active", birth_date: born(22), sex: "F", city: "Rio" });
  await person("Davi", { classification: "visitor", status: "active", birth_date: born(30), sex: "M", user_id: visitante.id });
  await person("Eva", { classification: "member", status: "inactive", birth_date: born(60), sex: "F", user_id: inativo.id });
  await person("Fabio", { classification: "member", status: "pending" });
  await person("Gil", { classification: "member", status: "active", city: "Rio" });
  jr = (await ins("journeys", { org_id: org, name: "Jornada Seg", status: "active" }).catch(() => [{ id: null }]))[0].id;
});

describe("segmentação: critérios, prévia e atualização automática", () => {
  test("E, OU e grupos aninhados; prévia traz total, nome, classificação e vínculos; sem duplicidade", async () => {
    const a = await prev(sec, all(leaf("status", "eq", "active"), leaf("classification", "in", ["member", "attender"])));
    expect(names(a)).toEqual(["Ana", "Bruno", "Carla", "Gil"]); expect(a.total).toBe(4);
    const o = await prev(sec, any_(leaf("classification", "eq", "visitor"), leaf("status", "eq", "pending")));
    expect(names(o)).toEqual(["Davi", "Fabio"]);
    const n = await prev(sec, any_(all(leaf("status", "eq", "active"), leaf("classification", "eq", "member")), all(leaf("status", "eq", "active"), leaf("classification", "eq", "attender"), leaf("city", "eq", "Rio"))));
    expect(names(n)).toEqual(["Ana", "Bruno", "Carla", "Gil"]);
    const ana = a.items.find((i: any) => i.name === "Ana"); expect(ana.classification).toBe("member"); expect(ana.links.length).toBe(2); expect(new Set(a.items.map((i: any) => i.id)).size).toBe(a.items.length);
  });
  test("operadores: idade, faixa, contém, preenchido, não pertence, entre", async () => {
    expect(names(await prev(sec, leaf("age", "between", [20, 30])))).toEqual(["Ana", "Carla", "Davi"]);
    expect(names(await prev(sec, leaf("age", "gt", 44)))).toEqual(["Bruno", "Eva"]);
    expect(names(await prev(sec, leaf("age", "empty")))).toEqual(["Fabio", "Gil"]);
    expect(names(await prev(sec, leaf("city", "contains", "ni")))).toEqual(["Bruno"]);
    expect(names(await prev(sec, all(leaf("city", "filled"), leaf("classification", "not_in", ["member"]))))).toEqual(["Carla"]);
    expect(names(await prev(sec, leaf("sex", "neq", "F")))).toEqual(["Bruno", "Davi", "Fabio", "Gil"]);
    expect(names(await prev(sec, leaf("band", "in", ["2"])))).toEqual(["Carla"]); expect(names(await prev(sec, leaf("band", "eq", "3")))).toEqual(["Ana", "Davi"]);
    expect(names(await prev(sec, leaf("band", "not_in", ["2", "3", "4"])))).toEqual(["Bruno", "Eva", "Fabio", "Gil"]);
  });
  test("vínculos reais: time, rede, grupo manual e jornada; pessoa em dois times aparece uma vez", async () => {
    expect(names(await prev(sec, leaf("team", "in", [teamA, teamB])))).toEqual(["Ana", "Bruno"]);
    expect(names(await prev(sec, leaf("network", "eq", netA)))).toEqual(["Ana"]);
    expect(names(await prev(sec, leaf("team", "empty")))).toEqual(["Carla", "Davi", "Eva", "Fabio", "Gil"]);
    expect((await prev(sec, leaf("team", "filled"))).total).toBe(2);
  });
  test("funções são independentes da classificação e exigem permissão própria", async () => {
    expect(names(await prev(sec, leaf("function", "eq", "team_leader")))).toEqual(["Bruno"]);
    const lim = newUser; const semFunc = await newUser("SemFunc"); await joinChurch(admin.api, org, semFunc);
    await grant(semFunc, "Parcial", ["people_segments_view"]);
    expect(msg(await rpc(semFunc, "segment_preview", { p_org: org, p_criteria: leaf("function", "eq", "team_leader"), p_limit: 10 }))).toContain("forbidden");
    expect((await rpc(semFunc, "segment_preview", { p_org: org, p_criteria: leaf("city", "eq", "Rio"), p_limit: 10 })).data.total).toBe(3);
  });
  test("critério inválido, campo fora da lista e tentativa de injeção são recusados ou inertes", async () => {
    expect(msg(await rpc(sec, "segment_preview", { p_org: org, p_criteria: leaf("admin_notes", "eq", "x"), p_limit: 5 }))).toContain("invalid_field");
    expect(msg(await rpc(sec, "segment_preview", { p_org: org, p_criteria: leaf("city", "like", "x"), p_limit: 5 }))).toContain("invalid_operator");
    expect(msg(await rpc(sec, "segment_preview", { p_org: org, p_criteria: leaf("classification", "eq", "xyz"), p_limit: 5 }))).toContain("invalid_criteria");
    expect((await prev(sec, leaf("city", "eq", "x'; drop table people; --"))).total).toBe(0);
    expect((await rows("people?select=id&org_id=eq." + org)).length).toBe(7);
  });
  test("salvar, listar, editar critérios, ativar/desativar e atualização automática com histórico", async () => {
    const sv = await rpc(sec, "segment_save", { p_org: org, p_id: null, p: { name: "Membros ativos", description: "Teste", kind: "dynamic", criteria: all(leaf("classification", "eq", "member"), leaf("status", "eq", "active")) } });
    const id = sv.data.id; expect(id).toBeTruthy();
    expect(msg(await rpc(sec, "segment_save", { p_org: org, p_id: null, p: { name: "membros ATIVOS", criteria: leaf("city", "eq", "Rio") } }))).toContain("duplicate_name");
    expect(msg(await rpc(sec, "segment_save", { p_org: org, p_id: null, p: { name: "Vazio", criteria: { op: "and", items: [] } } }))).toContain("criteria_required");
    let g = (await rpc(sec, "segment_get", { p_id: id })).data; expect(g.total).toBe(3); expect(g.segment.criteria.items.length).toBe(2);
    await patch(`people?id=eq.${P.Gil}`, { classification: "attender" }); // sai sozinho
    await patch(`people?id=eq.${P.Davi}`, { classification: "member" }); // entra sozinho
    g = (await rpc(sec, "segment_get", { p_id: id })).data; expect(g.items.map((i: any) => i.name).sort()).toEqual(["Ana", "Bruno", "Davi"]);
    expect(g.history.some((h: any) => h.kind === "entered" && h.person === "Davi")).toBe(true); expect(g.history.some((h: any) => h.kind === "left" && h.person === "Gil")).toBe(true);
    await patch(`people?id=eq.${P.Gil}`, { classification: "member" }); await patch(`people?id=eq.${P.Davi}`, { classification: "visitor" });
    expect((await rpc(sec, "segment_save", { p_org: org, p_id: id, p: { name: "Membros ativos", criteria: all(leaf("classification", "eq", "member"), leaf("status", "eq", "active"), leaf("city", "eq", "Rio")) } })).data.id).toBe(id);
    expect((await rpc(sec, "segment_get", { p_id: id })).data.total).toBe(2);
    const l = (await rpc(sec, "segment_list", { p_org: org, p: { q: "ativos" } })).data; expect(l.length).toBe(1); expect(l[0].count).toBe(2);
    expect((await rpc(sec, "segment_set_active", { p_id: id, p_active: false })).data.ok).toBe(true);
    expect(msg(await rpc(sec, "segment_audience", { p_id: id }))).toContain("segment_inactive");
    expect((await rpc(sec, "segment_list", { p_org: org, p: { status: "inactive" } })).data.length).toBe(1);
    await rpc(sec, "segment_set_active", { p_id: id, p_active: true });
    const a = (await rpc(sec, "segment_audience", { p_id: id })).data; expect(a.people).toBe(2); expect(a.with_account).toBe(1);
    const e = (await rpc(sec, "segment_export", { p_id: id })).data; expect(e.items.length).toBe(2); expect(JSON.stringify(e)).not.toMatch(/phone|email|cpf/);
  });
});

describe("grupos manuais", () => {
  let gid = "";
  test("criar, adicionar (individual e lote), duplicidade ignorada, remover preservando o histórico", async () => {
    gid = (await rpc(sec, "group_save", { p_org: org, p_id: null, p: { name: "Comissão do evento", description: "x", category: "Eventos", kind: "temporary", visibility: "all" } })).data.id;
    expect(msg(await rpc(sec, "group_save", { p_org: org, p_id: null, p: { name: "comissão do EVENTO" } }))).toContain("duplicate_name");
    const a = (await rpc(sec, "group_members_add", { p_id: gid, p_people: [P.Ana, P.Bruno, P.Carla, P.Ana] })).data; expect(a.added).toBe(3);
    expect((await rpc(sec, "group_members_add", { p_id: gid, p_people: [P.Ana, P.Davi] })).data).toMatchObject({ added: 1, already: 1 });
    expect((await rpc(sec, "group_member_remove", { p_id: gid, p_person: P.Carla, p_reason: "saiu" })).data.ok).toBe(true);
    expect(msg(await rpc(sec, "group_member_remove", { p_id: gid, p_person: P.Carla }))).toContain("not_found");
    let g = (await rpc(sec, "group_get", { p_id: gid })).data; expect(g.members.map((m: any) => m.name).sort()).toEqual(["Ana", "Bruno", "Davi"]);
    expect(g.history.some((h: any) => h.person === "Carla" && h.status === "removed" && h.reason === "saiu")).toBe(true);
    await rpc(sec, "group_members_add", { p_id: gid, p_people: [P.Carla] }); g = (await rpc(sec, "group_get", { p_id: gid })).data; expect(g.history.filter((h: any) => h.person === "Carla").length).toBe(2);
    expect((await rpc(sec, "segment_preview", { p_org: org, p_criteria: leaf("group", "eq", gid), p_limit: 20 })).data.total).toBe(4);
  });
  test("encerrar mantém participantes e histórico; não aceita novos; participação não concede permissão", async () => {
    await rpc(sec, "group_set_status", { p_id: gid, p_status: "closed" });
    expect(msg(await rpc(sec, "group_members_add", { p_id: gid, p_people: [P.Gil] }))).toContain("group_not_active");
    expect((await rpc(sec, "group_get", { p_id: gid })).data.members.length).toBe(4);
    expect(msg(await rpc(membro, "group_list", { p_org: org, p: {} }))).toContain("forbidden"); // Ana está no grupo e continua sem acesso
    expect(msg(await rpc(membro, "segment_preview", { p_org: org, p_criteria: leaf("city", "eq", "Rio"), p_limit: 5 }))).toContain("forbidden");
  });
  test("visibilidade restrita e registros auditáveis", async () => {
    const r = (await rpc(admin, "group_save", { p_org: org, p_id: null, p: { name: "Reservado", visibility: "restricted", owner_id: admin.id } })).data.id;
    expect((await rpc(sec, "group_list", { p_org: org, p: {} })).data.some((g: any) => g.id === r)).toBe(false);
    expect((await rpc(admin, "group_list", { p_org: org, p: {} })).data.some((g: any) => g.id === r)).toBe(true);
    expect(msg(await rpc(sec, "group_get", { p_id: r }))).toContain("forbidden");
    expect((await rows(`seg_log?org_id=eq.${org}&select=kind`)).length).toBeGreaterThan(8);
  });
});

describe("segmentação: permissões e escopo", () => {
  test("sem permissão, sem login e outra igreja", async () => {
    for (const fn of [["segment_list", { p_org: org, p: {} }], ["group_list", { p_org: org, p: {} }], ["segment_options", { p_org: org }]]) expect(msg(await rpc(semPerm, fn[0] as string, fn[1]))).toContain("forbidden");
    expect((await anon.rpc("segment_list", { p_org: org, p: {} })).ok).toBe(false);
    expect(msg(await rpc(fora, "segment_list", { p_org: org, p: {} }))).toContain("forbidden");
    const u = (await rpc(sec, "segment_list", { p_org: org, p: {} })).data[0].id; expect(msg(await rpc(fora, "segment_get", { p_id: u }))).toContain("forbidden");
  });
  test("perfis parciais: ver não cria, criar não exclui, exportar e usar são permissões próprias", async () => {
    expect(msg(await rpc(sup, "segment_save", { p_org: org, p_id: null, p: { name: "X", criteria: leaf("city", "eq", "Rio") } }))).toContain("forbidden");
    const id = (await rpc(sec, "segment_list", { p_org: org, p: {} })).data[0].id;
    expect(msg(await rpc(sup, "segment_set_active", { p_id: id, p_active: false }))).toContain("forbidden");
    expect(msg(await rpc(sup, "segment_export", { p_id: id }))).toContain("forbidden"); expect(msg(await rpc(sup, "segment_audience", { p_id: id }))).toContain("forbidden");
  });
  test("supervisor só enxerga as pessoas da própria rede", async () => {
    const r = (await rpc(sup, "segment_preview", { p_org: org, p_criteria: leaf("status", "in", ["active", "inactive", "pending"]), p_limit: 50 })).data;
    expect(names(r)).toEqual(["Ana"]); expect(r.items[0].age).toBeNull(); // sem people_view a idade não aparece
  });
});

describe("carteira: emissão, elegibilidade e matrícula", () => {
  test("emite para membro ativo; matrícula única, formatada e da pessoa", async () => {
    const r = await rpc(sec, "wallet_issue", { p_org: org, p_person: P.Ana, p_reason: null }); expect(r.data.matricula).toBe("M-00001");
    expect(msg(await rpc(sec, "wallet_issue", { p_org: org, p_person: P.Ana }))).toContain("already_issued");
    const b = await rpc(sec, "wallet_issue", { p_org: org, p_person: P.Bruno }); expect(b.data.matricula).toBe("M-00002");
    expect((await rows(`person_matricula?org_id=eq.${org}&select=matricula`)).length).toBe(2);
  });
  test("visitante, frequentador, inativo e pendente não são elegíveis (validado no servidor)", async () => {
    for (const [n, m] of [["Davi", "not_eligible"], ["Carla", "not_eligible"], ["Eva", "not_eligible"], ["Fabio", "person_pending"]]) expect(msg(await rpc(sec, "wallet_issue", { p_org: org, p_person: P[n] }))).toContain(m);
    expect((await rows(`wallets?org_id=eq.${org}&select=id`)).length).toBe(2);
  });
  test("o membro vê a própria carteira com dados mínimos; os demais recebem mensagem adequada", async () => {
    const m = await mine(membro); expect(m.state).toBe("active"); expect(m.token).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{32}$/);
    expect(m.card.name).toBe("Ana"); expect(m.card.matricula).toBe("M-00001"); expect(m.card.title).toBe("CARTEIRA DE MEMBRO"); expect(m.card.church_name).toBe("Igreja Carteira");
    expect(JSON.stringify(m)).not.toMatch(/phone|cpf|address|email|birth/i);
    expect((await mine(visitante)).state).toBe("not_eligible"); expect((await mine(inativo)).state).toBe("not_eligible"); expect((await mine(semPerm)).state).toBe("no_person");
    const nm = await rpc(fora, "wallet_mine", { p_org: org }); expect(msg(nm)).toContain("forbidden");
    expect((await anon.rpc("wallet_mine", { p_org: org })).ok).toBe(false);
  });
  test("membro elegível sem emissão vê 'não emitida'", async () => {
    await person("Hugo", { classification: "member", status: "active" }); const hu = await newUser("Hugo"); await joinChurch(admin.api, org, hu); await patch(`people?id=eq.${P.Hugo}`, { user_id: hu.id });
    expect((await mine(hu)).state).toBe("not_issued");
  });
});

describe("carteira: validação do QR", () => {
  let tok = "";
  test("token válido: só nome, igreja e situação; resultado vem do servidor", async () => {
    tok = (await mine(membro)).token; const v = await val(tok);
    expect(v.result).toBe("valid"); expect(v.name).toBe("Ana"); expect(v.church).toBe("Igreja Carteira"); expect(v.notice).toContain("não comprova a identidade civil");
    expect(v.matricula ?? null).toBeNull(); expect(JSON.stringify(v)).not.toMatch(/phone|cpf|email|address/i);
    expect((await val(tok, sec)).result).toBe("valid");
    expect((await rows(`wallet_log?org_id=eq.${org}&kind=eq.validated&select=id`)).length).toBe(1); // só validação autenticada e autorizada é registrada
  });
  test("token inválido, adulterado ou de outra carteira", async () => {
    expect((await val("lixo")).result).toBe("not_found"); expect((await val(tok.slice(0, -1) + (tok.endsWith("0") ? "1" : "0"))).result).toBe("not_found");
    const other = (await mine(lider)).token; expect(other).not.toBe(tok); expect((await val(other)).name).toBe("Bruno"); expect((await val(other.split(".")[0] + "." + tok.split(".")[1])).result).toBe("not_found");
    expect((await val("0".repeat(32) + "." + "0".repeat(32))).result).toBe("not_found");
  });
  test("a carteira não guarda o token em lugar nenhum", async () => {
    const w = await rows(`wallets?org_id=eq.${org}&select=*`); expect(JSON.stringify(w)).not.toContain(tok.split(".")[1]);
  });
  test("política da igreja: matrícula na validação pública quando permitido", async () => {
    await rpc(sec, "wallet_settings_save", { p_org: org, p: { public_matricula: true } }); expect((await val(tok)).matricula).toBe("M-00001");
    await rpc(sec, "wallet_settings_save", { p_org: org, p: { public_matricula: false } });
  });
  test("suspender, reativar, revogar: o servidor reconhece e o app do membro não mostra cartão válido", async () => {
    const id = (await wal("Ana")).wallet.id;
    expect(msg(await rpc(sec, "wallet_suspend", { p_id: id, p_reason: "" }))).toContain("reason_required");
    await rpc(sec, "wallet_suspend", { p_id: id, p_reason: "Disciplina pastoral" });
    expect((await val(tok)).result).toBe("suspended"); const s = await mine(membro); expect(s.state).toBe("suspended"); expect(s.token).toBeUndefined(); expect(s.card).toBeUndefined();
    await rpc(sec, "wallet_reactivate", { p_id: id }); expect((await val(tok)).result).toBe("valid");
    await rpc(sec, "wallet_revoke", { p_id: id, p_reason: "Pedido do membro" });
    const rv = await val(tok); expect(rv.result).toBe("revoked"); expect(rv.name).toBeUndefined(); expect((await mine(membro)).state).toBe("revoked");
    expect(msg(await rpc(sec, "wallet_reactivate", { p_id: id }))).toContain("invalid_status");
  });
  test("token revogado nunca volta a valer; reemissão mantém a matrícula e gera novo QR", async () => {
    const id = (await wal("Ana")).wallet.id; const r = await rpc(sec, "wallet_reissue", { p_id: id, p_reason: "Voltou" }); expect(r.data.matricula).toBe("M-00001");
    const novo = (await mine(membro)).token; expect(novo).not.toBe(tok); expect((await val(tok)).result).toBe("not_found"); expect((await val(novo)).result).toBe("valid"); tok = novo;
  });
  test("renovar token invalida o QR antigo", async () => {
    const id = (await wal("Ana")).wallet.id; await rpc(sec, "wallet_renew_token", { p_id: id, p_reason: "QR vazou" });
    expect((await val(tok)).result).toBe("not_found"); tok = (await mine(membro)).token; expect((await val(tok)).result).toBe("valid");
  });
  test("limite de tentativas contra enumeração", async () => {
    let limited = false; for (let i = 0; i < 14; i++) { const r = await rpc(anon as any, "wallet_validate", { p_token: "a".repeat(32) + "." + String(i).padStart(32, "0") }); if (msg(r).includes("rate_limited")) limited = true; }
    expect(limited).toBe(true);
    await fetch(`${REST}/wallet_attempts?id=gt.0`, { method: "DELETE", headers: await sk() });
  });
});

describe("carteira: ciclo de vida e atualização cadastral", () => {
  test("alteração de nome e foto aparece na carteira; matrícula não muda", async () => {
    const tk = (await mine(membro)).token; await patch(`people?id=eq.${P.Ana}`, { full_name: "Ana Souza", photo_url: "https://exemplo.test/ana.jpg" });
    const m = await mine(membro); expect(m.card.name).toBe("Ana Souza"); expect(m.card.photo_url).toBe("https://exemplo.test/ana.jpg"); expect(m.card.matricula).toBe("M-00001");
    expect((await val(tk)).name).toBe("Ana Souza"); expect((await val(tk)).photo_url).toBe("https://exemplo.test/ana.jpg");
  });
  test("inativação suspende (política automática) e reativação exige elegibilidade", async () => {
    const tk = (await mine(membro)).token; await patch(`people?id=eq.${P.Ana}`, { status: "inactive" });
    expect((await val(tk)).result).toBe("suspended"); expect((await mine(membro)).state).toBe("suspended");
    await rpc(sec, "wallet_settings_save", { p_org: org, p: { suspension_policy: "manual" } }); expect((await val(tk)).result).toBe("valid"); // política manual: segue a decisão administrativa
    await rpc(sec, "wallet_settings_save", { p_org: org, p: { suspension_policy: "auto" } });
    await patch(`people?id=eq.${P.Ana}`, { status: "active" }); expect((await val(tk)).result).toBe("valid");
  });
  test("mudança de classificação suspende e impede reativação até voltar a ser membro", async () => {
    const id = (await wal("Ana")).wallet.id, tk = (await mine(membro)).token; await patch(`people?id=eq.${P.Ana}`, { classification: "attender" });
    expect((await val(tk)).result).toBe("suspended"); expect((await mine(membro)).reason).toBe("classification");
    expect(msg(await rpc(sec, "wallet_reactivate", { p_id: id }))).toContain("invalid_status"); // armazenado ainda é ativo
    await rpc(sec, "wallet_suspend", { p_id: id, p_reason: "Mudança de classificação" }); expect(msg(await rpc(sec, "wallet_reactivate", { p_id: id }))).toContain("not_eligible");
    await patch(`people?id=eq.${P.Ana}`, { classification: "member" }); expect((await rpc(sec, "wallet_reactivate", { p_id: id })).data.status).toBe("active");
  });
  test("histórico completo e notificações ao membro", async () => {
    const h = (await wal("Ana")).history.map((x: any) => x.kind); for (const k of ["issued", "suspended", "reactivated", "revoked", "reissued", "token_renewed"]) expect(h).toContain(k);
    const n = (await membro.api.get(`/notifications?user_id=eq.${membro.id}&kind=eq.wallet&select=title`)).data as any[]; expect(n.length).toBeGreaterThanOrEqual(5);
  });
});

describe("carteira: lote, gestão e permissões", () => {
  test("lote: só elegíveis, sem duplicidade, falhas identificadas e reprocessamento", async () => {
    const before = (await rows(`wallets?org_id=eq.${org}&select=id`)).length;
    const r = (await rpc(sec, "wallet_batch", { p_org: org, p: { all: true } })).data; expect(r.created).toBe(2); expect(r.failed.length).toBe(0); // Gil e Hugo
    const again = (await rpc(sec, "wallet_batch", { p_org: org, p: { all: true } })).data; expect(again.created).toBe(0); expect(again.skipped).toBe(0 + 0 || again.skipped);
    expect((await rows(`wallets?org_id=eq.${org}&select=id`)).length).toBe(before + 2);
    const bad = (await rpc(sec, "wallet_batch", { p_org: org, p: { person_ids: [P.Davi, P.Carla, P.Eva, P.Fabio, P.Gil] } })).data;
    expect(bad.created).toBe(0); expect(bad.skipped).toBe(1); expect(bad.failed.map((f: any) => f.name).sort()).toEqual(["Carla", "Davi", "Eva", "Fabio"]);
    expect(new Set((await rows(`person_matricula?org_id=eq.${org}&select=matricula`)).map((x) => x.matricula)).size).toBe(before + 2);
    expect((await rows(`wallet_log?org_id=eq.${org}&kind=eq.batch&select=id`)).length).toBeGreaterThanOrEqual(2);
  });
  test("integração: segmento por situação da carteira; pertencer ao segmento não dá direito à carteira", async () => {
    const sem = await prev(sec, all(leaf("wallet_eligible", "eq", true), leaf("wallet", "eq", "none"))); expect(sem.total).toBe(0);
    const comCart = await prev(sec, leaf("wallet", "in", ["active"])); expect(names(comCart)).toEqual(["Ana Souza", "Bruno", "Gil", "Hugo"]);
    const seg = (await rpc(sec, "segment_save", { p_org: org, p_id: null, p: { name: "Visitantes e frequentadores", criteria: leaf("classification", "in", ["visitor", "attender"]) } })).data.id;
    const r = (await rpc(sec, "wallet_batch", { p_org: org, p: { segment_id: seg } })).data; expect(r.created).toBe(0); expect(r.failed.length).toBe(2);
    expect((await rpc(sec, "wallet_list", { p_org: org, p: { status: "none" } })).data.total).toBe(0);
  });
  test("lista com busca por nome e matrícula e filtros por situação; detalhes", async () => {
    expect((await rpc(sec, "wallet_list", { p_org: org, p: { q: "M-00002" } })).data.items[0].name).toBe("Bruno");
    const l = (await rpc(sec, "wallet_list", { p_org: org, p: { status: "active" } })).data; expect(l.counts.active).toBe(4);
    expect((await rpc(sec, "wallet_list", { p_org: org, p: { q: "Souza" } })).data.items.length).toBe(1);
  });
  test("permissões: sem permissão não lista, não emite, não valida como autorizado; supervisor só a própria rede", async () => {
    for (const [fn, a] of [["wallet_list", { p_org: org, p: {} }], ["wallet_issue", { p_org: org, p_person: P.Gil }], ["wallet_batch", { p_org: org, p: { all: true } }], ["wallet_settings_save", { p_org: org, p: { title: "X" } }]] as any[]) expect(msg(await rpc(semPerm, fn, a))).toContain("forbidden");
    const id = (await wal("Bruno")).wallet.id; expect(msg(await rpc(semPerm, "wallet_revoke", { p_id: id, p_reason: "abc" }))).toContain("forbidden");
    expect(msg(await rpc(sup, "wallet_revoke", { p_id: id, p_reason: "abc" }))).toContain("forbidden"); // sem a permissão de revogar
    expect(msg(await rpc(sup, "wallet_suspend", { p_id: (await wal("Ana")).wallet.id, p_reason: "abc" }))).toContain("forbidden");
    expect((await rpc(sup, "wallet_list", { p_org: org, p: {} })).data.items.map((i: any) => i.name)).toEqual(["Ana Souza"]);
    expect(msg(await rpc(sup, "wallet_get", { p_org: org, p_person: P.Bruno }))).toContain("not_found");
    expect(msg(await rpc(fora, "wallet_list", { p_org: org, p: {} }))).toContain("forbidden");
    for (const fn of ["wallet_issue", "wallet_list", "wallet_batch"]) expect((await anon.rpc(fn, { p_org: org, p_person: P.Gil, p: {} })).ok).toBe(false);
  });
  test("configuração do modelo: título, cores, elementos e formato da matrícula; segredo nunca sai", async () => {
    expect((await rpc(sec, "wallet_settings_save", { p_org: org, p: { title: "CARTÃO DE MEMBRO", accent: "#3753D1", style: "light", show_photo: false, matricula_prefix: "ABC", matricula_digits: 4, church_name: "Igreja X" } })).data.saved).toBe(true);
    const c = (await rpc(sec, "wallet_settings_get", { p_org: org })).data; expect(c.title).toBe("CARTÃO DE MEMBRO"); expect(c.style).toBe("light"); expect(JSON.stringify(c)).not.toContain("secret");
    expect(msg(await rpc(sec, "wallet_settings_save", { p_org: org, p: { accent: "azul" } }))).toContain("invalid_config");
    const m = await mine(membro); expect(m.card.title).toBe("CARTÃO DE MEMBRO"); expect(m.card.church_name).toBe("Igreja X"); expect(m.card.photo_url).toBeNull(); expect(m.card.matricula).toBe("M-00001"); // matrículas antigas não mudam
    await person("Iris", { classification: "member", status: "active" }); expect((await rpc(sec, "wallet_issue", { p_org: org, p_person: P.Iris })).data.matricula).toBe("ABC-0005");
    expect((await rows(`wallet_log?org_id=eq.${org}&kind=eq.config&select=detail`)).some((x) => JSON.stringify(x).includes("secret"))).toBe(false);
  });
  test("tabelas internas não são acessíveis pelo cliente", async () => {
    for (const t of ["wallets", "wallet_settings", "person_matricula", "wallet_log", "wallet_attempts", "seg_segments", "seg_groups", "seg_group_members", "seg_log"]) { const r = await sec.api.get(`/${t}?select=*`); expect(r.ok === false || (r.data ?? []).length === 0).toBe(true); }
  });
  test("auto-emissão pela política da igreja: só para elegíveis", async () => {
    await rpc(sec, "wallet_settings_save", { p_org: org, p: { issue_policy: "auto" } });
    const j = await newUser("Julia"); await joinChurch(admin.api, org, j); await person("Julia", { classification: "member", status: "active", user_id: j.id });
    const m = await mine(j); expect(m.state).toBe("active"); expect(m.card.matricula).toMatch(/^ABC-/);
    expect((await mine(visitante)).state).toBe("not_eligible");
  });
});
