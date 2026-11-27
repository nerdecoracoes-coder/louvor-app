// Fase 6A — Múltiplas Igrejas: estrutura configurável, convite com consentimento, acesso por escopo, consolidado só com números, isolamento.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let matriz: any, localA: any, localB: any, regional: any, financeiro: any, membro: any, dev: any, fora: any;
let orgM = "", orgA = "", orgB = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const tree = async (u: any, org: string) => (await rpc(u, "org_tree", { p_org: org })).data;
const names = (t: any) => (t.units as any[]).map((x) => x.name);

beforeAll(async () => {
  [matriz, localA, localB, regional, financeiro, membro, dev, fora] = await Promise.all(["Matriz", "LocalA", "LocalB", "Regional", "Financeiro", "Membro", "Dev", "Fora"].map(newUser));
  orgM = (await matriz.api.rpc("create_organization", { p_name: "Sede Nacional" })).data;
  orgA = (await localA.api.rpc("create_organization", { p_name: "Igreja Alfa" })).data; // igreja que já existia, criada isolada
  orgB = (await localB.api.rpc("create_organization", { p_name: "Igreja Beta" })).data;
  await joinChurch(matriz.api, orgM, regional, financeiro, membro);
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
  // dados internos de cada igreja
  await ins("people", [{ org_id: orgA, full_name: "Maria Alfa", classification: "member", status: "active" }, { org_id: orgA, full_name: "João Alfa", classification: "visitor", status: "active" }]);
  await ins("people", [{ org_id: orgB, full_name: "Ana Beta", classification: "member", status: "active" }]);
  await ins("cells", [{ org_id: orgA, name: "Célula Alfa 1", status: "active" }, { org_id: orgB, name: "Célula Beta 1", status: "active" }]);
});

describe("igrejas existentes continuam isoladas e inalteradas", () => {
  test("sem estrutura, cada igreja segue sozinha: nenhuma ganhou pai e o acesso é só do administrador", async () => {
    for (const o of [orgM, orgA, orgB]) expect((await rows(`organizations?id=eq.${o}&select=parent_id,unit_kind`))[0]).toEqual({ parent_id: null, unit_kind: null });
    expect(msg(await rpc(matriz, "org_tree", { p_org: orgA }))).toBe("forbidden"); // admin da Matriz não vê a Alfa
    expect((await tree(matriz, orgM)).units.map((u: any) => u.name)).toEqual(["Sede Nacional"]);
  });
  test("quem não tem acesso nenhum recebe forbidden em tudo", async () => {
    for (const u of [fora, membro, dev, regional]) {
      expect(msg(await rpc(u, "org_tree", { p_org: orgM }))).toBe("forbidden");
      expect(msg(await rpc(u, "org_consolidated", { p_org: orgM }))).toBe("forbidden");
      expect(msg(await rpc(u, "org_unit_create", { p_parent: orgM, p_name: "Nova" }))).toBe("forbidden");
      expect(msg(await rpc(u, "org_invite_create", { p_parent: orgM }))).toBe("forbidden");
      expect(msg(await rpc(u, "org_scope_list", { p_org: orgM }))).toBe("forbidden");
      expect(msg(await rpc(u, "org_inst_history", { p_org: orgM }))).toBe("forbidden");
    }
  });
});

describe("estrutura sem hierarquia fixa", () => {
  test("criar unidade abaixo de uma igreja: quem cria vira administrador da nova; tipo é livre", async () => {
    const r = await rpc(matriz, "org_unit_create", { p_parent: orgM, p_name: "Regional Sul", p_kind: "Distrito Missionário" });
    expect(r.data.ok).toBe(true); const regSul = r.data.id;
    const o = (await rows(`organizations?id=eq.${regSul}&select=parent_id,unit_kind,name`))[0]; expect(o).toEqual({ parent_id: orgM, unit_kind: "Distrito Missionário", name: "Regional Sul" });
    expect((await rows(`org_members?org_id=eq.${regSul}&user_id=eq.${matriz.id}&select=role`))[0].role).toBe("admin");
    // uma unidade pode ser filha de outra unidade (sem níveis fixos), até 8 níveis
    const c = await rpc(matriz, "org_unit_create", { p_parent: regSul, p_name: "Congregação Centro", p_kind: "Congregação" });
    expect(c.data.ok).toBe(true);
    const t = await tree(matriz, orgM);
    expect(t.units.map((u: any) => [u.name, u.depth, u.kind])).toEqual([["Sede Nacional", 0, null], ["Regional Sul", 1, "Distrito Missionário"], ["Congregação Centro", 2, "Congregação"]]);
  });
  test("validações: nome obrigatório, tipo curto, profundidade máxima", async () => {
    expect(msg(await rpc(matriz, "org_unit_create", { p_parent: orgM, p_name: " " }))).toBe("org_need_name");
    expect(msg(await rpc(matriz, "org_unit_create", { p_parent: orgM, p_name: "Ok", p_kind: "x".repeat(41) }))).toBe("org_kind_long");
    let cur = orgM; // já há 2 níveis abaixo; criamos até chegar ao limite
    const t0 = await tree(matriz, orgM); const deepest = (t0.units as any[]).find((u) => u.depth === 2).id; cur = deepest;
    for (let i = 3; i <= 8; i++) cur = (await rpc(matriz, "org_unit_create", { p_parent: cur, p_name: `Nível ${i}` })).data.id;
    expect(msg(await rpc(matriz, "org_unit_create", { p_parent: cur, p_name: "Nível 9" }))).toBe("org_too_deep");
  });
  test("vincular uma unidade que já tem filhas respeita o limite de níveis", async () => {
    const solo = await newUser("Solo"); const raiz = (await solo.api.rpc("create_organization", { p_name: "Raiz Solo" })).data;
    let cur = raiz; for (let i = 1; i <= 8; i++) cur = (await rpc(solo, "org_unit_create", { p_parent: cur, p_name: `S${i}` })).data.id; // 8 níveis abaixo
    const out = (await solo.api.rpc("create_organization", { p_name: "Outra Raiz" })).data;
    expect(msg(await rpc(solo, "org_unit_link", { p_child: raiz, p_parent: out }))).toBe("org_too_deep");
    expect((await rows(`organizations?id=eq.${raiz}&select=parent_id`))[0].parent_id).toBeNull();
  });
  test("ninguém altera parent_id direto pela API; ciclo é barrado", async () => {
    const r = await matriz.api.patch(`organizations?id=eq.${orgM}`, { parent_id: orgA });
    expect(JSON.stringify(r.data)).toContain("org_parent_locked");
    expect((await rows(`organizations?id=eq.${orgM}&select=parent_id`))[0].parent_id).toBeNull();
    const r2 = await localA.api.patch(`organizations?id=eq.${orgA}`, { parent_id: orgM });
    expect(JSON.stringify(r2.data)).toContain("org_parent_locked");
    // pelo serviço (sem usuário) um ciclo ainda é barrado
    const reg = (await rows(`organizations?parent_id=eq.${orgM}&select=id`))[0].id;
    const r3 = await fetch(`${REST}/organizations?id=eq.${orgM}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ parent_id: reg }) });
    expect(JSON.stringify(await r3.json())).toContain("org_cycle");
  });
  test("tipo de unidade pode ser renomeado por quem estrutura", async () => {
    const reg = (await rows(`organizations?parent_id=eq.${orgM}&select=id`))[0].id;
    expect((await rpc(matriz, "org_unit_set_kind", { p_org: reg, p_kind: "Regional" })).data.ok).toBe(true);
    expect((await rows(`organizations?id=eq.${reg}&select=unit_kind`))[0].unit_kind).toBe("Regional");
    expect(msg(await rpc(localA, "org_unit_set_kind", { p_org: reg, p_kind: "X" }))).toBe("forbidden");
  });
});

describe("vincular igreja existente exige consentimento dos dois lados", () => {
  let code = "";
  test("só quem estrutura o pai cria convite; código aparece uma vez e só o hash fica guardado", async () => {
    const r = await rpc(matriz, "org_invite_create", { p_parent: orgM, p_kind: "Igreja" }); code = r.data.code;
    expect(code).toMatch(/^IGR-[0-9A-F]{12}$/);
    const raw = JSON.stringify(await rows("org_invites?select=*")); expect(raw).not.toContain(code);
    const l = (await rpc(matriz, "org_invite_list", { p_parent: orgM })).data; expect(l[0].state).toBe("open"); expect(JSON.stringify(l)).not.toContain(code);
  });
  test("aceite exige ser administrador da igreja; código errado ou de outro não vale", async () => {
    expect(msg(await rpc(matriz, "org_invite_accept", { p_child: orgA, p_code: code }))).toBe("forbidden"); // admin da matriz não é admin da Alfa
    expect(msg(await rpc(dev, "org_invite_accept", { p_child: orgA, p_code: code }))).toBe("forbidden");
    expect(msg(await rpc(localA, "org_invite_accept", { p_child: orgA, p_code: "IGR-000000000000" }))).toBe("org_invite_invalid");
    expect((await rows(`organizations?id=eq.${orgA}&select=parent_id`))[0].parent_id).toBeNull();
  });
  test("aceite vincula sem mexer nos dados; o código não pode ser reutilizado; já vinculada não vincula de novo", async () => {
    const antes = (await rows(`people?org_id=eq.${orgA}&select=id`)).length;
    const r = await rpc(localA, "org_invite_accept", { p_child: orgA, p_code: code.toLowerCase() });
    expect(r.data).toEqual({ ok: true, parent_id: orgM });
    expect((await rows(`organizations?id=eq.${orgA}&select=parent_id,unit_kind`))[0]).toEqual({ parent_id: orgM, unit_kind: "Igreja" });
    expect((await rows(`people?org_id=eq.${orgA}&select=id`)).length).toBe(antes);
    expect(msg(await rpc(localB, "org_invite_accept", { p_child: orgB, p_code: code }))).toBe("org_invite_invalid");
    const c2 = (await rpc(matriz, "org_invite_create", { p_parent: orgM })).data.code;
    expect(msg(await rpc(localA, "org_invite_accept", { p_child: orgA, p_code: c2 }))).toBe("org_has_parent");
    expect((await rpc(matriz, "org_invite_list", { p_parent: orgM })).data.some((i: any) => i.state === "used" && i.used_by === "Igreja Alfa")).toBe(true);
  });
  test("convite expirado ou revogado não vale", async () => {
    const c = (await rpc(matriz, "org_invite_create", { p_parent: orgM })).data.code;
    await fetch(`${REST}/org_invites?used_at=is.null`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    expect(msg(await rpc(localB, "org_invite_accept", { p_child: orgB, p_code: c }))).toBe("org_invite_invalid");
    const c3 = (await rpc(matriz, "org_invite_create", { p_parent: orgM })).data.code;
    const id = ((await rpc(matriz, "org_invite_list", { p_parent: orgM })).data as any[]).find((i) => i.state === "open").id;
    expect(msg(await rpc(localB, "org_invite_revoke", { p_id: id }))).toBe("forbidden");
    expect((await rpc(matriz, "org_invite_revoke", { p_id: id })).data.ok).toBe(true);
    expect(msg(await rpc(localB, "org_invite_accept", { p_child: orgB, p_code: c3 }))).toBe("org_invite_invalid");
  });
  test("convite de quem perdeu o acesso ao pai deixa de valer", async () => {
    const ex = await newUser("Ex"); await joinChurch(matriz.api, orgM, ex);
    await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: ex.id, p_level: "Temporário", p_actions: ["structure"] });
    const c = (await rpc(ex, "org_invite_create", { p_parent: orgM })).data.code; expect(c).toMatch(/^IGR-/);
    const gid = ((await rpc(matriz, "org_scope_list", { p_org: orgM })).data as any[]).find((g) => g.user_id === ex.id).id;
    await rpc(matriz, "org_scope_remove", { p_id: gid });
    expect(msg(await rpc(localB, "org_invite_accept", { p_child: orgB, p_code: c }))).toBe("org_invite_invalid");
  });
  test("vínculo direto quando a mesma pessoa administra as duas; desvincular não apaga nada", async () => {
    const dupla = await newUser("Dupla"); const o1 = (await dupla.api.rpc("create_organization", { p_name: "Dupla 1" })).data; const o2 = (await dupla.api.rpc("create_organization", { p_name: "Dupla 2" })).data;
    expect(msg(await rpc(dupla, "org_unit_link", { p_child: o2, p_parent: o2 }))).toBe("org_cycle");
    expect((await rpc(dupla, "org_unit_link", { p_child: o2, p_parent: o1, p_kind: "Unidade" })).data.ok).toBe(true);
    expect(msg(await rpc(dupla, "org_unit_link", { p_child: o1, p_parent: o2 }))).toMatch(/org_cycle/);
    expect(msg(await rpc(localB, "org_unit_unlink", { p_child: o2 }))).toBe("forbidden");
    expect((await rpc(dupla, "org_unit_unlink", { p_child: o2 })).data.ok).toBe(true);
    expect((await rows(`organizations?id=eq.${o2}&select=id,parent_id`))[0].parent_id).toBeNull();
    expect((await rows(`org_members?org_id=eq.${o2}&select=user_id`)).length).toBe(1);
  });
});

describe("acesso global só por concessão explícita", () => {
  let gRegional = "", gFin = "";
  test("só o administrador da unidade concede; precisa ser membro; ações válidas", async () => {
    expect(msg(await rpc(regional, "org_scope_set", { p_org: orgM, p_user: regional.id, p_level: "Eu", p_actions: ["consolidated"] }))).toBe("forbidden");
    expect(msg(await rpc(dev, "org_scope_set", { p_org: orgM, p_user: regional.id, p_level: "x", p_actions: ["consolidated"] }))).toBe("forbidden");
    expect(msg(await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: fora.id, p_level: "x", p_actions: ["consolidated"] }))).toBe("org_member_required");
    expect(msg(await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: regional.id, p_level: "x", p_actions: ["admin"] }))).toBe("org_invalid_actions");
    expect(msg(await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: regional.id, p_level: "x", p_actions: [] }))).toBe("org_invalid_actions");
    gRegional = (await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: regional.id, p_level: "Liderança regional", p_actions: ["consolidated"] })).data.id;
    gFin = (await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: financeiro.id, p_level: "Tesouraria geral", p_actions: ["consolidated", "consolidated_fin"] })).data.id;
    const l = (await rpc(matriz, "org_scope_list", { p_org: orgM })).data as any[]; expect(l.map((g) => g.level).sort()).toEqual(["Liderança regional", "Tesouraria geral"]);
  });
  test("liderança regional vê estrutura e números, mas não cria unidades nem concede acesso; acesso não cobre outras árvores", async () => {
    expect(names(await tree(regional, orgM))).toContain("Igreja Alfa");
    expect(msg(await rpc(regional, "org_unit_create", { p_parent: orgM, p_name: "X" }))).toBe("forbidden");
    expect(msg(await rpc(regional, "org_scope_list", { p_org: orgM }))).toBe("forbidden");
    expect(msg(await rpc(regional, "org_tree", { p_org: orgB }))).toBe("forbidden"); // Beta não está na árvore
    expect((await rpc(regional, "inst_access", { p_org: orgM })).data).toMatchObject({ admin: false, structure: false, consolidated: true, fin: false });
  });
  test("concessão revogada tira o acesso na hora; histórico registra quem concedeu e revogou", async () => {
    const tmp = await newUser("Tmp"); await joinChurch(matriz.api, orgM, tmp);
    const id = (await rpc(matriz, "org_scope_set", { p_org: orgM, p_user: tmp.id, p_level: "Tmp", p_actions: ["consolidated"] })).data.id;
    expect((await rpc(tmp, "org_consolidated", { p_org: orgM })).data.totals.units).toBeGreaterThan(0);
    await rpc(matriz, "org_scope_remove", { p_id: id });
    expect(msg(await rpc(tmp, "org_consolidated", { p_org: orgM }))).toBe("forbidden");
    expect(msg(await rpc(regional, "org_scope_remove", { p_id: gFin }))).toBe("forbidden");
    const h = (await rpc(matriz, "org_inst_history", { p_org: orgM })).data as any[];
    expect(h.some((x) => x.entity === "scope" && x.action === "grant")).toBe(true); expect(h.some((x) => x.entity === "scope" && x.action === "revoke")).toBe(true);
  });
});

describe("consolidado: só números e isolamento dos dados internos", () => {
  test("totais e por unidade conferem com os dados; sem nomes de pessoas", async () => {
    const c = (await rpc(regional, "org_consolidated", { p_org: orgM })).data;
    const alfa = (c.units as any[]).find((u) => u.name === "Igreja Alfa");
    expect(alfa).toMatchObject({ people: 2, members: 1, cells: 1, kind: "Igreja" });
    expect(c.totals.people).toBeGreaterThanOrEqual(2); expect(c.totals.cells).toBeGreaterThanOrEqual(1);
    expect(c.fin_allowed).toBe(false); expect(alfa.fin).toBeNull(); expect(c.totals.income).toBeNull();
    const raw = JSON.stringify(c); for (const n of ["Maria", "João", "Ana", "Célula Alfa"]) expect(raw).not.toContain(n);
    // a Beta (fora da árvore) não entra nos números
    expect(raw).not.toContain("Igreja Beta");
  });
  test("indicadores financeiros só com concessão própria e a consulta fica auditada", async () => {
    const acc = (await ins("fin_accounts", [{ org_id: orgA, name: "Caixa", kind: "cash" }]))[0].id;
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    await ins("fin_entries", [{ org_id: orgA, kind: "income", description: "Oferta", amount: 1500, account_id: acc, status: "settled", paid_at: hoje, due_date: hoje, approval: "none" },
      { org_id: orgA, kind: "expense", description: "Luz", amount: 400, account_id: acc, status: "settled", paid_at: hoje, due_date: hoje, approval: "approved" }]);
    expect((await rpc(regional, "org_consolidated", { p_org: orgM })).data.units.find((u: any) => u.name === "Igreja Alfa").fin).toBeNull();
    const c = (await rpc(financeiro, "org_consolidated", { p_org: orgM })).data;
    expect(c.fin_allowed).toBe(true);
    expect(c.units.find((u: any) => u.name === "Igreja Alfa").fin).toMatchObject({ income: 1500, expense: 400 });
    expect(Number(c.totals.income)).toBe(1500); expect(Number(c.totals.expense)).toBe(400);
    expect(JSON.stringify(c)).not.toContain("Oferta");
    expect(((await rpc(matriz, "org_inst_history", { p_org: orgM })).data as any[]).some((x) => x.entity === "consolidated" && x.action === "view_fin")).toBe(true);
  });
  test("administrador da Matriz também não lê financeiro das filhas sem concessão financeira", async () => {
    expect((await rpc(matriz, "org_consolidated", { p_org: orgM })).data.fin_allowed).toBe(false);
  });
  test("ter acesso ao nó NÃO abre os dados internos das unidades (RLS continua valendo)", async () => {
    for (const u of [regional, financeiro, matriz]) {
      for (const t of ["people", "cells", "fin_entries", "ev_events", "prog_items"]) {
        const r = await u.api.get(`/${t}?org_id=eq.${orgA}&select=id`); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0);
      }
      expect(msg(await rpc(u, "fin_catalog", { p_org: orgA }))).toBe("forbidden");
    }
    for (const t of ["org_scope_grants", "org_invites"]) for (const u of [matriz, regional]) { const r = await u.api.get(`/${t}?select=*`); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0); }
  });
  test("desvincular a Alfa tira a Alfa dos números; os dados dela continuam intactos", async () => {
    expect((await rpc(localA, "org_unit_unlink", { p_child: orgA })).data.ok).toBe(true);
    expect((await rpc(regional, "org_consolidated", { p_org: orgM })).data.units.some((u: any) => u.name === "Igreja Alfa")).toBe(false);
    expect((await rows(`people?org_id=eq.${orgA}&select=id`)).length).toBe(2);
    expect(msg(await rpc(regional, "org_tree", { p_org: orgA }))).toBe("forbidden");
  });
});
