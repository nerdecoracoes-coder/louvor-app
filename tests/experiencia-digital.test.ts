// Fase 5 — Experiência Digital: conteúdos, planos de leitura, atalhos, busca integrada, menu e Home.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, gestor: any, membro: any, visitante: any, freq: any, lider: any, dev: any, fora: any, outro: any;
let org = "", team = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const save = (u: any, p: any, id: string | null = null) => rpc(u, "dig_content_save", { p_org: org, p_id: id, p });
const list = async (u: any, f: any = {}) => (await rpc(u, "content_list", { p_org: org, p_filter: f })).data;
const search = async (u: any, q: string) => ((await rpc(u, "search_all", { p_org: org, p_q: q })).data.groups as any[]);
const titles = (g: any[], key: string) => (g.find((x) => x.key === key)?.items ?? []).map((i: any) => i.title) as string[];
const menu = async (u: any) => (await rpc(u, "my_menu", { p_org: org })).data;
const cards = async (u: any) => ((await rpc(u, "home_discover", { p_org: org })).data?.cards ?? []) as any[];

beforeAll(async () => {
  [admin, gestor, membro, visitante, freq, lider, dev, fora, outro] = await Promise.all(["Adm", "Gestor", "Membro", "Visitante", "Freq", "Lider", "Dev", "Fora", "Outro"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Digital" })).data;
  await joinChurch(admin.api, org, gestor, membro, visitante, freq, lider, dev, outro);
  await admin.api.rpc("grant_set", { p_org: org, p_user: gestor.id, p_role: "secretary", p_network: null, p_title: "Digital", p_actions: ["dig_manage"] });
  for (const [u, c] of [[membro, "member"], [visitante, "visitor"], [freq, "attender"]] as any) await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [u.id], p_classification: c });
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Dig", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_leader: true }) });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
});

describe("permissões", () => {
  test("liderança de time, desenvolvedor, membro e quem está fora não gerenciam nada", async () => {
    for (const u of [lider, dev, membro, visitante, fora]) {
      expect(msg(await rpc(u, "dig_content_list", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await save(u, { title: "X", kind: "study" }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "plan_admin_list", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "shortcut_list", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "shortcut_save", { p_org: org, p_id: null, p: { label: "X", route: "#/avisos" } }))).toMatch(/forbidden/);
    }
    expect(msg(await rpc(fora, "content_list", { p_org: org }))).toMatch(/forbidden/);
    expect(msg(await rpc(fora, "search_all", { p_org: org, p_q: "abc" }))).toMatch(/forbidden/);
  });
  test("tabelas fechadas para as chaves do app", async () => {
    await save(gestor, { title: "Fechada", kind: "study" });
    for (const t of ["content_items", "content_series", "reading_plans", "reading_plan_days", "reading_plan_progress", "reading_plan_enrollments", "home_shortcuts"])
      for (const u of [admin, gestor, membro]) { const r = await u.api.get(`/${t}?select=*`); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0); }
  });
});

describe("conteúdos", () => {
  let vid = "", est = "", baixar = "", serie = "";
  test("rascunho não aparece para o público; publicar exige link em vídeo/áudio/material", async () => {
    serie = (await rpc(gestor, "dig_series_save", { p_org: org, p_id: null, p: { name: "Conhecendo a Bíblia" } })).data.id;
    expect(msg(await rpc(gestor, "dig_series_save", { p_org: org, p_id: null, p: { name: "conhecendo a bíblia" } }))).toBe("name_taken");
    vid = (await save(gestor, { title: "Estudo em vídeo Romanos", kind: "video", series_id: serie, url: "https://exemplo.com/v1" })).data.id;
    expect((await list(membro)).items.some((i: any) => i.id === vid)).toBe(false);
    expect(msg(await rpc(membro, "content_get", { p_id: vid }))).toBe("not_found");
    const sem = (await save(gestor, { title: "Sem link", kind: "audio" })).data.id;
    expect(msg(await rpc(gestor, "dig_content_set_status", { p_id: sem, p_status: "published" }))).toBe("dig_link_required");
    expect(msg(await save(gestor, { title: "Link ruim", kind: "video", url: "javascript:alert(1)" }))).toBe("dig_invalid_link");
    expect(msg(await save(gestor, { title: "Série ruim", kind: "study", series_id: "00000000-0000-0000-0000-000000000000" }))).toBe("dig_invalid_series");
    expect((await rpc(gestor, "dig_content_set_status", { p_id: vid, p_status: "published" })).data.ok).toBe(true);
    est = (await save(gestor, { title: "Estudo só para membros", kind: "study", audience: "member", description: "texto longo do estudo" })).data.id;
    await rpc(gestor, "dig_content_set_status", { p_id: est, p_status: "published" });
    baixar = (await save(gestor, { title: "Apostila de células", kind: "download", file_url: "https://exemplo.com/a.pdf", audience: "visitor" })).data.id;
    await rpc(gestor, "dig_content_set_status", { p_id: baixar, p_status: "published" });
  });
  test("cada pessoa vê só o seu público; busca e filtros funcionam", async () => {
    const t = async (u: any) => (await list(u)).items.map((i: any) => i.title);
    expect(await t(membro)).toContain("Estudo só para membros"); expect(await t(membro)).not.toContain("Apostila de células");
    expect(await t(visitante)).toContain("Apostila de células"); expect(await t(visitante)).not.toContain("Estudo só para membros");
    expect(await t(freq)).toEqual(["Estudo em vídeo Romanos"]);
    expect((await list(membro, { kind: "video" })).items.length).toBe(1);
    expect((await list(membro, { series_id: serie })).items[0].id).toBe(vid);
    expect((await list(membro, { q: "romanos" })).items.length).toBe(1);
    expect((await list(membro)).series.map((s: any) => s.name)).toEqual(["Conhecendo a Bíblia"]);
    expect(msg(await rpc(freq, "content_get", { p_id: est }))).toBe("not_found");
    expect((await rpc(membro, "content_get", { p_id: est })).data.description).toContain("texto longo");
  });
  test("despublicar tira do ar; auditoria registra sem vazar nada; link e público não ficam livres", async () => {
    await rpc(gestor, "dig_content_set_status", { p_id: vid, p_status: "draft" });
    expect((await list(membro)).items.some((i: any) => i.id === vid)).toBe(false);
    await rpc(gestor, "dig_content_set_status", { p_id: vid, p_status: "published" });
    expect(msg(await save(gestor, { title: "x", kind: "study", audience: "todos" }))).toBe("dig_invalid_audience");
    const a = await rows(`mod_audit?org_id=eq.${org}&module=eq.digital&select=action`);
    expect(a.length).toBeGreaterThan(3);
  });
});

describe("planos de leitura", () => {
  let plano = "";
  const days = [{ title: "Dia 1", passage: "João 1", note: "Comece aqui" }, { passage: "João 2" }, { passage: "João 3", url: "https://exemplo.com/j3" }];
  test("plano vazio não publica; publicado aparece só para o público e com dias", async () => {
    plano = (await rpc(gestor, "plan_save", { p_org: org, p_id: null, p: { title: "João em 3 dias", audience: "all", days: [] } })).data.id;
    expect(msg(await rpc(gestor, "plan_set_status", { p_id: plano, p_status: "published" }))).toBe("dig_plan_empty");
    expect(msg(await rpc(gestor, "plan_save", { p_org: org, p_id: plano, p: { title: "x", days: [{ passage: "" }] } }))).toBe("dig_passage_required");
    expect((await rpc(gestor, "plan_save", { p_org: org, p_id: plano, p: { title: "João em 3 dias", audience: "all", days } })).data.ok).toBe(true);
    expect(((await rpc(membro, "plans_for_me", { p_org: org })).data as any[]).length).toBe(0); // ainda rascunho
    expect(msg(await rpc(membro, "plan_get", { p_id: plano }))).toBe("not_found");
    expect((await rpc(gestor, "plan_set_status", { p_id: plano, p_status: "published" })).data.ok).toBe(true);
    expect(((await rpc(membro, "plans_for_me", { p_org: org })).data as any[])[0].total).toBe(3);
  });
  test("inscrição e progresso são individuais; marcar exige inscrição; gestão vê só contagens", async () => {
    expect(msg(await rpc(membro, "plan_mark", { p_id: plano, p_day: 1, p_done: true }))).toBe("dig_not_enrolled");
    await rpc(membro, "plan_enroll", { p_id: plano }); await rpc(visitante, "plan_enroll", { p_id: plano });
    expect((await rpc(membro, "plan_mark", { p_id: plano, p_day: 1, p_done: true })).data.ok).toBe(true);
    expect(msg(await rpc(membro, "plan_mark", { p_id: plano, p_day: 99, p_done: true }))).toBe("not_found");
    const m = (await rpc(membro, "plan_get", { p_id: plano })).data, v = (await rpc(visitante, "plan_get", { p_id: plano })).data;
    expect(m.days.filter((d: any) => d.done).length).toBe(1); expect(v.days.filter((d: any) => d.done).length).toBe(0);
    const adm = ((await rpc(gestor, "plan_admin_list", { p_org: org })).data as any[]).find((p) => p.id === plano);
    expect(adm.enrolled).toBe(2); expect(adm.finished).toBe(0);
    expect(JSON.stringify(adm)).not.toContain(membro.id);
    await rpc(membro, "plan_mark", { p_id: plano, p_day: 2, p_done: true }); await rpc(membro, "plan_mark", { p_id: plano, p_day: 3, p_done: true });
    expect(((await rpc(gestor, "plan_admin_list", { p_org: org })).data as any[]).find((p) => p.id === plano).finished).toBe(1);
    await rpc(membro, "plan_mark", { p_id: plano, p_day: 3, p_done: false });
    expect(((await rpc(membro, "plans_for_me", { p_org: org })).data as any[])[0].done).toBe(2);
  });
  test("não é possível reduzir os dias de um plano que já tem progresso", async () => {
    expect(msg(await rpc(gestor, "plan_save", { p_org: org, p_id: plano, p: { title: "João em 3 dias", days: days.slice(0, 2) } }))).toBe("dig_plan_in_use");
    expect((await rpc(gestor, "plan_save", { p_org: org, p_id: plano, p: { title: "João em 3 dias", days: [...days, { passage: "João 4" }] } })).data.ok).toBe(true);
  });
  test("quem despublica não apaga o plano de quem já começou", async () => {
    await rpc(gestor, "plan_set_status", { p_id: plano, p_status: "draft" });
    expect(((await rpc(membro, "plans_for_me", { p_org: org })).data as any[]).length).toBe(1);
    expect(((await rpc(freq, "plans_for_me", { p_org: org })).data as any[]).length).toBe(0);
    await rpc(gestor, "plan_set_status", { p_id: plano, p_status: "published" });
  });
});

describe("atalhos institucionais", () => {
  test("rótulo, destino e público validados; máximo de 8 ativos; cada pessoa vê os do seu público", async () => {
    expect(msg(await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "", route: "#/avisos" } }))).toBe("dig_label_required");
    expect(msg(await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "X", route: "javascript:alert(1)" } }))).toBe("dig_invalid_link");
    expect(msg(await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "X", route: "http://inseguro.com" } }))).toBe("dig_invalid_link");
    await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "Site", route: "https://igreja.org", icon: "link", position: 1 } });
    await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "Só membros", route: "#/planos", icon: "book", audience: "member", position: 2 } });
    expect(((await rpc(membro, "shortcuts_for_me", { p_org: org })).data as any[]).map((s) => s.label)).toEqual(["Site", "Só membros"]);
    expect(((await rpc(visitante, "shortcuts_for_me", { p_org: org })).data as any[]).map((s) => s.label)).toEqual(["Site"]);
    for (let i = 0; i < 6; i++) expect((await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "A" + i, route: "#/avisos" } })).data.ok).toBe(true);
    expect(msg(await rpc(gestor, "shortcut_save", { p_org: org, p_id: null, p: { label: "Extra", route: "#/avisos" } }))).toBe("dig_too_many_shortcuts");
    const l = (await rpc(gestor, "shortcut_list", { p_org: org })).data as any[];
    expect((await rpc(gestor, "shortcut_save", { p_org: org, p_id: l[0].id, p: { label: "Site", route: "https://igreja.org", active: false } })).data.ok).toBe(true);
    expect((await rpc(gestor, "shortcut_delete", { p_id: l[1].id })).data.ok).toBe(true);
    expect(msg(await rpc(membro, "shortcut_delete", { p_id: l[2].id }))).toBe("forbidden");
  });
});

describe("busca integrada respeita permissões", () => {
  test("conteúdo, plano, pregação, evento, comunicado e programação aparecem só para quem pode abrir", async () => {
    await ins("sermons", { org_id: org, title: "Pregação sobre graça", status: "published", audience: "member" });
    await ins("sermons", { org_id: org, title: "Graça rascunho", status: "draft" });
    await ins("ev_events", { org_id: org, title: "Culto da graça", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "published", audience: "member" });
    await ins("ev_events", { org_id: org, title: "Graça para visitantes", starts_at: new Date(Date.now() + 864e5).toISOString(), status: "published", audience: "visitor" });
    await ins("prog_items", { org_id: org, name: "Reunião de graça líderes", category: "reuniao", visibility: "leaders", status: "published", start_date: "2026-12-20", starts_time: "19:00" });
    await ins("prog_items", { org_id: org, name: "Culto graça público", category: "culto", visibility: "public", status: "published", start_date: "2026-12-20", starts_time: "19:00" });
    await ins("prog_items", { org_id: org, name: "Graça rascunho prog", category: "culto", visibility: "public", status: "draft", start_date: "2026-12-20", starts_time: "19:00" });
    await ins("content_items", { org_id: org, kind: "study", title: "Estudo da graça", status: "published", published_at: new Date().toISOString(), audience: "member" });
    await ins("content_items", { org_id: org, kind: "study", title: "Graça em rascunho", status: "draft" });
    await ins("announcements", { org_id: org, title: "Comunicado da graça", body: "x", status: "published", audience: "member", created_by: admin.id });
    await ins("announcements", { org_id: org, title: "Graça rascunho aviso", body: "x", status: "draft", created_by: admin.id });
    const m = await search(membro, "graça"), v = await search(visitante, "graça");
    expect(titles(m, "sermons")).toEqual(["Pregação sobre graça"]); expect(titles(v, "sermons")).toEqual([]);
    expect(titles(m, "events")).toEqual(["Culto da graça"]); expect(titles(v, "events")).toEqual(["Graça para visitantes"]);
    expect(titles(m, "agenda")).toContain("Culto graça público"); expect(titles(m, "agenda")).not.toContain("Reunião de graça líderes"); expect(titles(m, "agenda")).not.toContain("Graça rascunho prog");
    expect(titles(await search(lider, "graça"), "agenda")).toContain("Reunião de graça líderes");
    expect(titles(m, "contents")).toEqual(["Estudo da graça"]); expect(titles(v, "contents")).toEqual([]);
    expect(titles(m, "notices")).toEqual(["Comunicado da graça"]); expect(titles(v, "notices")).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/rascunho/i);
  });
  test("busca curta é vazia; caracteres de curinga não vazam tudo; informação da igreja encontra o nome", async () => {
    expect(await search(membro, "a")).toEqual([]);
    expect(await search(membro, "%%")).toEqual([]); expect(await search(membro, "\\")).toEqual([]);
    expect(titles(await search(membro, "Igreja Digital"), "church")).toEqual(["Igreja Digital"]);
  });
  test("rotas devolvidas existem no app", async () => {
    const all = (await search(membro, "graça")).flatMap((g) => g.items.map((i: any) => i.route as string));
    for (const r of all) expect(r).toMatch(/^#\/(eventos|agenda|pregacoes(\?q=.*)?|conteudos\/[0-9a-f-]{36}|planos\/[0-9a-f-]{36}|avisos|igreja)$/);
  });
});

describe("menu e Home", () => {
  test("Conteúdos e Planos só aparecem para quem tem algo publicado para o seu público", async () => {
    expect((await menu(membro)).contents).toBe(true); expect((await menu(membro)).plans).toBe(true);
    expect((await menu(freq)).contents).toBe(true); // vídeo para todos
    const solo = await newUser("Solo"); await joinChurch(admin.api, org, solo);
    await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [solo.id], p_classification: "attender" });
    expect((await menu(solo)).contents).toBe(true);
  });
  test("cards automáticos de conteúdo e plano existem, levam a destinos reais e respeitam o público", async () => {
    const cm = await cards(membro);
    const cc = cm.find((c) => c.key === "contents"), cp = cm.find((c) => c.key === "plan");
    expect(cc.route).toMatch(/^#\/conteudos\/[0-9a-f-]{36}$/); expect(cp.route).toMatch(/^#\/planos\/[0-9a-f-]{36}$/);
    expect(cp.kind).toBe("progress"); // o membro está no plano
    const cf = await cards(freq);
    expect(cf.find((c) => c.key === "contents").title).not.toBe("Estudo só para membros");
    expect((await rpc(freq, "content_get", { p_id: cf.find((c) => c.key === "contents").route.split("/")[2] })).data?.title).toBeTruthy();
    expect(cf.find((c) => c.key === "plan").kind).toBe("horizontal");
  });
  test("sem conteúdo publicado, não há card nem item de menu", async () => {
    const org2 = (await outro.api.rpc("create_organization", { p_name: "Igreja Vazia" })).data;
    const m2 = (await rpc(outro, "my_menu", { p_org: org2 })).data;
    expect(m2.contents).toBe(false); expect(m2.plans).toBe(false);
    expect(((await rpc(outro, "home_discover", { p_org: org2 })).data.cards as any[]).some((c) => ["contents", "plan"].includes(c.key))).toBe(false);
  });
});
