// Fase 4A — Comunicação: comunicados (público, agenda, validade, fixação), notificações com preferências e limite, pregações.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, redator: any, editor: any, pregador: any, membro: any, visitante: any, freq: any, lider: any, dev: any, fora: any, coord: any;
let org = "", team = "", segId = "", grpId = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const svc = async (path: string, method: string, body?: any) => fetch(`${REST}/${path}`, { method, headers: await sk(), body: body ? JSON.stringify(body) : undefined });
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const clearNotifs = async () => { await svc(`notifications?org_id=eq.${org}`, "DELETE"); };
const iso = (h: number) => new Date(Date.now() + h * 36e5).toISOString();
const save = (u: any, p: any, id: string | null = null) => rpc(u, "comm_ann_save", { p_org: org, p_id: id, p });
const mine = async (u: any) => (await u.api.get(`/announcements?org_id=eq.${org}&team_id=is.null&select=id,title`)).data.map((a: any) => a.title) as string[];
const notifs = async (u: any, kind = "announcement") => (await rows(`notifications?user_id=eq.${u.id}&kind=eq.${kind}&select=title`)).map((n) => n.title) as string[];
const pub = async (u: any, p: any, when: string | null = null) => { const id = (await save(u === editor ? redator : u, p)).data.id; await rpc(u === redator ? editor : u, "comm_ann_publish", { p_id: id, p_when: when }); return id as string; };

beforeAll(async () => {
  [admin, redator, editor, pregador, membro, visitante, freq, lider, dev, fora, coord] = await Promise.all(["Adm", "Redator", "Editor", "Pregador", "Membro", "Visitante", "Freq", "Lider", "Dev", "Fora", "Coord"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Comunicação" })).data;
  await joinChurch(admin.api, org, redator, editor, pregador, membro, visitante, freq, lider, dev, coord);
  const grant = (u: any, t: string, a: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: t, p_actions: a });
  await grant(redator, "Redator", ["comm_manage"]); await grant(editor, "Editor", ["comm_publish"]); await grant(pregador, "Pregador", ["comm_sermons"]);
  for (const [u, c] of [[membro, "member"], [visitante, "visitor"], [freq, "attender"]] as any) await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [u.id], p_classification: c });
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Com", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_leader: true }) });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
  const segRes = (await admin.api.rpc("segment_save", { p_org: org, p_id: null, p: { name: "Frequentadores", kind: "dynamic", criteria: { op: "and", items: [{ field: "classification", cmp: "eq", value: "attender" }] } } })).data;
  segId = segRes?.saved ?? segRes?.id;
  grpId = (await admin.api.rpc("group_save", { p_org: org, p_id: null, p: { name: "Grupo Teste" } })).data.id;
  const memberPerson = (await rows(`people?org_id=eq.${org}&user_id=eq.${membro.id}&select=id`))[0].id;
  await admin.api.rpc("group_members_add", { p_id: grpId, p_people: [memberPerson] });
});

describe("permissões", () => {
  test("liderança de time, desenvolvedor, membro e quem está fora não gerenciam comunicados nem pregações", async () => {
    for (const u of [lider, dev, membro, fora]) {
      expect(msg(await rpc(u, "comm_ann_list", { p_org: org }))).toBe("forbidden");
      expect(msg(await save(u, { title: "X" }))).toBe("forbidden");
      expect(msg(await rpc(u, "sermon_save", { p_org: org, p_id: null, p: { title: "X" } }))).toBe("forbidden");
    }
    expect(msg(await rpc(fora, "sermon_list", { p_org: org }))).toBe("forbidden");
    expect(msg(await rpc(fora, "notif_prefs_get", { p_org: org }))).toBe("forbidden");
  });
  test("cada permissão faz só o seu papel", async () => {
    const id = (await save(redator, { title: "Rascunho do redator" })).data.id;
    expect(msg(await rpc(redator, "comm_ann_publish", { p_id: id }))).toBe("forbidden");
    expect(msg(await rpc(redator, "comm_ann_pin", { p_id: id, p_pinned: true }))).toBe("forbidden");
    expect(msg(await save(editor, { title: "Do editor" }))).toBe("forbidden");
    expect(msg(await rpc(editor, "comm_ann_delete", { p_id: id }))).toBe("forbidden");
    expect(msg(await rpc(pregador, "comm_ann_list", { p_org: org }))).toBe("forbidden");
    expect(msg(await rpc(redator, "sermon_save", { p_org: org, p_id: null, p: { title: "X" } }))).toBe("forbidden");
    expect((await rpc(editor, "comm_ann_list", { p_org: org })).data.can.publish).toBe(true);
  });
});

describe("comunicados: rascunho, agenda, validade e visibilidade (na tabela)", () => {
  test("rascunho não aparece nem notifica; ao publicar aparece e notifica o público, menos o autor", async () => {
    await clearNotifs(); const id = (await save(redator, { title: "Culto especial" })).data.id;
    expect(await mine(membro)).not.toContain("Culto especial");
    expect((await notifs(membro)).length).toBe(0);
    const r = (await rpc(editor, "comm_ann_publish", { p_id: id })).data;
    expect(r.ok).toBe(true); expect(r.scheduled).toBe(false);
    expect(await mine(membro)).toContain("Culto especial"); expect(await mine(visitante)).toContain("Culto especial");
    expect(await notifs(membro)).toContain("Novo aviso: Culto especial");
    expect(await notifs(editor)).not.toContain("Novo aviso: Culto especial"); expect(await notifs(redator)).not.toContain("Novo aviso: Culto especial");
    // publicar de novo não notifica outra vez
    await rpc(editor, "comm_ann_publish", { p_id: id });
    expect((await notifs(membro)).filter((t) => t === "Novo aviso: Culto especial").length).toBe(1);
  });
  test("agendado fica oculto e sem notificação até a hora; o despacho envia e o mural passa a mostrar", async () => {
    await clearNotifs(); const id = await pub(editor, { title: "Agendado para amanhã" }, iso(24));
    const a = (await rpc(editor, "comm_ann_list", { p_org: org })).data.items.find((x: any) => x.id === id);
    expect(a.state).toBe("scheduled");
    expect(await mine(membro)).not.toContain("Agendado para amanhã"); expect(await notifs(membro)).not.toContain("Novo aviso: Agendado para amanhã");
    await svc(`announcements?id=eq.${id}`, "PATCH", { publish_at: iso(-1) });
    expect(await mine(membro)).toContain("Agendado para amanhã");
    const d = await fetch(`${REST}/rpc/comm_dispatch`, { method: "POST", headers: await sk(), body: "{}" });
    expect(Number(await d.text())).toBeGreaterThanOrEqual(1);
    expect(await notifs(membro)).toContain("Novo aviso: Agendado para amanhã");
    expect(Number(await (await fetch(`${REST}/rpc/comm_dispatch`, { method: "POST", headers: await sk(), body: "{}" })).text())).toBe(0);
  });
  test("vencido e despublicado somem do mural, mas continuam na gestão", async () => {
    const id = await pub(editor, { title: "Com validade" });
    await svc(`announcements?id=eq.${id}`, "PATCH", { expires_at: iso(-1) });
    expect(await mine(membro)).not.toContain("Com validade");
    expect((await rpc(editor, "comm_ann_list", { p_org: org })).data.items.find((x: any) => x.id === id).state).toBe("expired");
    const id2 = await pub(editor, { title: "Vai sair" });
    expect(await mine(membro)).toContain("Vai sair");
    expect((await rpc(editor, "comm_ann_unpublish", { p_id: id2 })).data.ok).toBe(true);
    expect(await mine(membro)).not.toContain("Vai sair");
    expect(await mine(redator)).toContain("Vai sair");
    expect(msg(await rpc(editor, "comm_ann_unpublish", { p_id: id2 }))).toBe("comm_not_published");
    expect(msg(await rpc(editor, "comm_ann_publish", { p_id: id, p_when: null }))).toBe("comm_expired");
  });
  test("validações: título, público, link e validade", async () => {
    expect(msg(await save(redator, { title: " " }))).toBe("comm_title_required");
    expect(msg(await save(redator, { title: "X", audience: "todos" }))).toBe("comm_invalid_audience");
    expect(msg(await save(redator, { title: "X", audience: "segment" }))).toBe("comm_invalid_audience");
    expect(msg(await save(redator, { title: "X", audience: "group", group_id: segId }))).toBe("comm_invalid_audience");
    expect(msg(await save(redator, { title: "X", link_url: "javascript:alert(1)" }))).toBe("comm_invalid_link");
    expect(msg(await save(redator, { title: "X", body: "a".repeat(4001) }))).toBe("comm_body_long");
    expect((await save(redator, { title: "Link interno", link_url: "#/eventos", link_label: "Ver eventos" })).data.ok).toBe(true);
  });
  test("rascunho nunca publicado pode ser excluído; publicado não", async () => {
    const d = (await save(redator, { title: "Excluir" })).data.id;
    expect((await rpc(redator, "comm_ann_delete", { p_id: d })).data.ok).toBe(true);
    const p = await pub(editor, { title: "Não excluir" });
    expect(msg(await rpc(redator, "comm_ann_delete", { p_id: p }))).toBe("comm_not_draft");
  });
  test("fixar: só publicado, no máximo 3, e despublicar tira a fixação", async () => {
    const ids: string[] = []; for (const n of ["A", "B", "C", "D"]) ids.push(await pub(editor, { title: "Fixo " + n }));
    const draft = (await save(redator, { title: "Fixo rascunho" })).data.id;
    expect(msg(await rpc(editor, "comm_ann_pin", { p_id: draft, p_pinned: true }))).toBe("comm_not_published");
    for (const id of ids.slice(0, 3)) expect((await rpc(editor, "comm_ann_pin", { p_id: id, p_pinned: true })).data.ok).toBe(true);
    expect(msg(await rpc(editor, "comm_ann_pin", { p_id: ids[3], p_pinned: true }))).toBe("comm_too_many_pinned");
    await rpc(editor, "comm_ann_unpublish", { p_id: ids[0] });
    expect((await rpc(editor, "comm_ann_list", { p_org: org })).data.items.find((x: any) => x.id === ids[0]).pinned).toBe(false);
    expect((await rpc(editor, "comm_ann_pin", { p_id: ids[3], p_pinned: true })).data.ok).toBe(true);
  });
});

describe("público (reaproveita a Segmentação)", () => {
  test("por classificação, segmento, grupo e célula", async () => {
    await clearNotifs(); await pub(editor, { title: "Só membros", audience: "member" }); await pub(editor, { title: "Só visitantes", audience: "visitor" });
    await pub(editor, { title: "Segmento frequentadores", audience: "segment", segment_id: segId }); await pub(editor, { title: "Do grupo", audience: "group", group_id: grpId });
    expect(await mine(membro)).toEqual(expect.arrayContaining(["Só membros", "Do grupo"])); expect(await mine(membro)).not.toContain("Só visitantes"); expect(await mine(membro)).not.toContain("Segmento frequentadores");
    expect(await mine(visitante)).toContain("Só visitantes"); expect(await mine(visitante)).not.toContain("Só membros");
    expect(await mine(freq)).toContain("Segmento frequentadores"); expect(await mine(freq)).not.toContain("Do grupo");
    expect(await mine(coord)).not.toContain("Do grupo");   // sem ficha cadastrada não entra em público segmentado
    expect(await notifs(freq)).toContain("Novo aviso: Segmento frequentadores"); expect(await notifs(freq)).not.toContain("Novo aviso: Só membros");
    expect(await notifs(membro)).toContain("Novo aviso: Do grupo"); expect(await notifs(visitante)).not.toContain("Novo aviso: Do grupo");
    expect(await mine(admin)).toEqual(expect.arrayContaining(["Só membros", "Só visitantes", "Do grupo"]));   // quem administra vê tudo
    const cells = (await rpc(admin, "comm_ann_list", { p_org: org })).data.cells; expect(Array.isArray(cells)).toBe(true);
  });
  test("quem não é da igreja não lê nada; avisos de time seguem só para o time", async () => {
    expect((await fora.api.get(`/announcements?org_id=eq.${org}&select=id`)).data.length).toBe(0);
    const t = await lider.api.post("announcements", { org_id: org, team_id: team, title: "Aviso do time", body: "x", created_by: lider.id });
    expect(t.ok).toBe(true);
    expect((await membro.api.get(`/announcements?org_id=eq.${org}&team_id=eq.${team}&select=id`)).data.length).toBe(0);
    expect((await lider.api.get(`/announcements?org_id=eq.${org}&team_id=eq.${team}&select=id`)).data.length).toBe(1);
  });
});

describe("regressão: avisos criados pelo caminho antigo (coordenação)", () => {
  test("aviso inserido direto continua publicado para toda a igreja e notifica", async () => {
    await clearNotifs(); const r = await admin.api.post("announcements", { org_id: org, title: "Aviso direto antigo", body: "oi", created_by: admin.id });
    expect(r.ok).toBe(true); expect(r.data[0].status).toBe("published"); expect(r.data[0].audience).toBe("all");
    expect(await mine(membro)).toContain("Aviso direto antigo"); expect(await notifs(visitante)).toContain("Novo aviso: Aviso direto antigo");
  });
});

describe("notificações: preferências e limite", () => {
  test("silenciar comunicados bloqueia só esse grupo; o essencial nunca é bloqueado", async () => {
    await clearNotifs(); const p = (await rpc(freq, "notif_prefs_get", { p_org: org })).data;
    expect(p.push.configured).toBe(false); expect(p.groups.map((g: any) => g.key)).toEqual(["comunicados", "eventos", "escalas", "financeiro", "conversas", "lembretes"]);
    expect(msg(await rpc(freq, "notif_prefs_set", { p_org: org, p_grp: "essencial", p_enabled: false }))).toBe("invalid_group");
    expect((await rpc(freq, "notif_prefs_set", { p_org: org, p_grp: "comunicados", p_enabled: false })).data.ok).toBe(true);
    const antes = (await notifs(freq)).length;
    await pub(editor, { title: "Aviso para todos depois do silêncio" });
    expect((await notifs(freq)).length).toBe(antes);
    expect(await mine(freq)).toContain("Aviso para todos depois do silêncio");   // continua no mural
    await fetch(`${REST}/rpc/notify_user`, { method: "POST", headers: await sk(), body: JSON.stringify({ p_user: freq.id, p_org: org, p_kind: "contact", p_title: "Essencial" }) });
    expect(await notifs(freq, "contact")).toContain("Essencial");
    expect((await rpc(freq, "notif_prefs_get", { p_org: org })).data.groups.find((g: any) => g.key === "comunicados").enabled).toBe(false);
    expect((await rpc(freq, "notif_prefs_set", { p_org: org, p_grp: "comunicados", p_enabled: true })).data.ok).toBe(true);
  });
  test("no máximo 5 avisos novos por pessoa em 24 h", async () => {
    await clearNotifs(); for (let i = 1; i <= 7; i++) await pub(editor, { title: "Rajada " + i, audience: "member" });
    expect((await notifs(membro)).length).toBe(5);
    expect(await mine(membro)).toContain("Rajada 7");
  });
  test("preferências são de cada pessoa e a tabela é fechada", async () => {
    expect((await membro.api.get(`/notif_prefs?org_id=eq.${org}`)).ok).toBe(false);
    await rpc(membro, "notif_prefs_set", { p_org: org, p_grp: "eventos", p_enabled: false });
    expect((await rpc(visitante, "notif_prefs_get", { p_org: org })).data.groups.find((g: any) => g.key === "eventos").enabled).toBe(true);
  });
});

describe("pregações", () => {
  let s1 = "", s2 = "", sr = "";
  test("cadastro com série, texto bíblico, mídia e links; rascunho não aparece para membros", async () => {
    sr = (await rpc(pregador, "sermon_series_save", { p_org: org, p_id: null, p: { name: "Romanos" } })).data.id;
    expect(msg(await rpc(pregador, "sermon_series_save", { p_org: org, p_id: null, p: { name: "romanos" } }))).toBe("name_taken");
    s1 = (await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { title: "A justiça de Deus", preacher: "Pr. Paulo", preached_on: "2026-11-15", series_id: sr, category: "Domingo", scripture: "Romanos 3:21-26", description: "Mensagem", video_url: "https://video.exemplo/1", audio_url: "https://audio.exemplo/1", links: [{ label: "Roteiro", url: "https://exemplo/roteiro" }] } })).data.id;
    expect((await rpc(membro, "sermon_list", { p_org: org })).data.items.length).toBe(0);
    expect((await rpc(pregador, "sermon_list", { p_org: org })).data.items.length).toBe(1);
    expect((await rpc(pregador, "sermon_set_status", { p_id: s1, p_publish: true })).data.ok).toBe(true);
    const l = (await rpc(membro, "sermon_list", { p_org: org })).data;
    expect(l.items[0].title).toBe("A justiça de Deus"); expect(l.items[0].series).toBe("Romanos"); expect(l.categories).toEqual(["Domingo"]); expect(l.series[0].count).toBe(1); expect(l.can).toBe(false);
  });
  test("validações de links e série", async () => {
    const b = { title: "X" };
    expect(msg(await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { ...b, video_url: "ftp://x" } }))).toBe("comm_invalid_link");
    expect(msg(await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { ...b, links: [{ label: "a", url: "javascript:1" }] } }))).toBe("comm_invalid_link");
    expect(msg(await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { ...b, links: Array.from({ length: 9 }, () => ({ label: "a", url: "https://a.b" })) } }))).toBe("comm_invalid_link");
    expect(msg(await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { ...b, series_id: segId } }))).toBe("comm_invalid_series");
    expect(msg(await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { title: " " } }))).toBe("comm_title_required");
  });
  test("busca por pregador, texto, série e categoria; público por classificação", async () => {
    s2 = (await rpc(pregador, "sermon_save", { p_org: org, p_id: null, p: { title: "Para quem chegou agora", preacher: "Pra. Ana", preached_on: "2026-11-22", category: "Visitantes", audience: "visitor" } })).data.id;
    await rpc(pregador, "sermon_set_status", { p_id: s2, p_publish: true });
    const q = async (u: any, f: any) => (await rpc(u, "sermon_list", { p_org: org, p_filter: f })).data.items.map((i: any) => i.title);
    expect(await q(membro, { q: "paulo" })).toEqual(["A justiça de Deus"]); expect(await q(membro, { q: "romanos 3" })).toEqual(["A justiça de Deus"]); expect(await q(membro, { q: "Romanos" })).toEqual(["A justiça de Deus"]);
    expect(await q(membro, { series_id: sr })).toEqual(["A justiça de Deus"]); expect(await q(membro, { category: "Visitantes" })).toEqual([]);
    expect(await q(visitante, { category: "Visitantes" })).toEqual(["Para quem chegou agora"]);
    expect((await q(pregador, {})).length).toBe(2);
    expect((await q(visitante, {})).sort()).toEqual(["A justiça de Deus", "Para quem chegou agora"]);   // ordenado por data: mais nova primeiro
    expect((await rpc(visitante, "sermon_list", { p_org: org })).data.items[0].title).toBe("Para quem chegou agora");
  });
  test("menu: pregações aparecem quando há conteúdo publicado para a pessoa; tabelas fechadas; auditoria", async () => {
    expect((await membro.api.get(`/sermons?org_id=eq.${org}`)).ok).toBe(false);
    const a = await rows(`mod_audit?org_id=eq.${org}&module=eq.comm&select=action,entity`); const acts = new Set(a.map((x) => x.action + ":" + x.entity));
    for (const k of ["create:announcement", "publish:announcement", "schedule:announcement", "unpublish:announcement", "pin:announcement", "delete_draft:announcement", "create:sermon", "publish:sermon", "create:series"]) expect(acts.has(k)).toBe(true);
  });
});
