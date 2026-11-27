// Fase 5 (melhorias): busca sem acento/tolerante a erro, transmissão ao vivo, anotações e lembretes de plano, base do push.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, gestor: any, membro: any, visitante: any, lider: any, dev: any, fora: any, outro: any;
let org = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const svcRpc = async (fn: string, body: any = {}) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: "POST", headers: await sk(), body: JSON.stringify(body) }); const t = await r.text(); return { ok: r.ok, data: t ? JSON.parse(t) : null }; };
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const search = async (u: any, q: string) => ((await rpc(u, "search_all", { p_org: org, p_q: q })).data.groups as any[]);
const titles = (g: any[], key: string) => (g.find((x) => x.key === key)?.items ?? []).map((i: any) => i.title) as string[];
const cards = async (u: any) => ((await rpc(u, "home_discover", { p_org: org })).data?.cards ?? []) as any[];
const at = (min: number) => new Date(Date.now() + min * 60000).toISOString();
const notifs = async (u: any, kind = "plan_reminder") => rows(`notifications?user_id=eq.${u.id}&kind=eq.${kind}&select=title,body,link`);

beforeAll(async () => {
  [admin, gestor, membro, visitante, lider, dev, fora, outro] = await Promise.all(["Adm", "Gestor", "Membro", "Visitante", "Lider", "Dev", "Fora", "Outro"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Melhorias" })).data;
  await joinChurch(admin.api, org, gestor, membro, visitante, lider, dev, outro);
  await admin.api.rpc("grant_set", { p_org: org, p_user: gestor.id, p_role: "secretary", p_network: null, p_title: "Digital", p_actions: ["dig_manage"] });
  for (const [u, c] of [[membro, "member"], [visitante, "visitor"], [outro, "member"]] as any) await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [u.id], p_classification: c });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
});

describe("busca sem acento e tolerante a erros", () => {
  test("'biblia', 'BIBLIA', 'Bíblia' e 'bibila' acham 'Conhecendo a Bíblia'; termo sem relação não", async () => {
    const c = (await rpc(gestor, "dig_content_save", { p_org: org, p_id: null, p: { title: "Conhecendo a Bíblia", kind: "study", audience: "all" } })).data.id;
    expect((await rpc(gestor, "dig_content_set_status", { p_id: c, p_status: "published" })).data.ok).toBe(true);
    for (const q of ["biblia", "BIBLIA", "Bíblia", "bibila", "bibla"]) {
      expect(titles(await search(membro, q), "contents")).toContain("Conhecendo a Bíblia");
      const l = (await rpc(membro, "content_list", { p_org: org, p_filter: { q } })).data.items as any[];
      expect(l.map((x) => x.title)).toContain("Conhecendo a Bíblia");
    }
    expect(titles(await search(membro, "batismo"), "contents")).not.toContain("Conhecendo a Bíblia");
    expect(titles(await search(membro, "pastor"), "contents")).not.toContain("Conhecendo a Bíblia");
  });
  test("pregação sem acento na busca de pregações e na busca geral", async () => {
    const r = await rpc(admin, "sermon_save", { p_org: org, p_id: null, p: { title: "Celebração da Páscoa", preacher: "Pr. João" } });
    expect(r.data.id).toBeTruthy();
    expect((await rpc(admin, "sermon_set_status", { p_id: r.data.id, p_publish: true })).data.ok).toBe(true);
    const l = (await rpc(admin, "sermon_list", { p_org: org, p_filter: { q: "celebracao" } })).data.items as any[];
    expect(l.map((x) => x.title)).toContain("Celebração da Páscoa");
    expect(titles(await search(membro, "pascoa"), "sermons")).toContain("Celebração da Páscoa");
  });
  test("coringas e entrada curta continuam bloqueados", async () => {
    expect((await search(membro, "%%")).every((g) => (g.items ?? []).length === 0)).toBe(true);
    expect((await search(membro, "b")).every((g) => (g.items ?? []).length === 0)).toBe(true);
  });
});

describe("transmissão ao vivo", () => {
  let live = "";
  const save = (u: any, p: any, id: string | null = null) => rpc(u, "live_save", { p_org: org, p_id: id, p });
  test("só quem tem dig_manage cadastra; liderança, desenvolvedor e membro não", async () => {
    for (const u of [lider, dev, membro, visitante, fora]) {
      expect(msg(await save(u, { title: "X", url: "https://youtube.com/live/x", starts_at: at(5) }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "live_list", { p_org: org }))).toMatch(/forbidden/);
    }
  });
  test("validações: título, link https, início e período", async () => {
    expect(msg(await save(gestor, { title: "", url: "https://x.com", starts_at: at(5) }))).toBe("dig_title_required");
    expect(msg(await save(gestor, { title: "T", url: "http://x.com", starts_at: at(5) }))).toBe("dig_invalid_link");
    expect(msg(await save(gestor, { title: "T", url: "javascript:alert(1)", starts_at: at(5) }))).toBe("dig_invalid_link");
    expect(msg(await save(gestor, { title: "T", url: "https://x.com" }))).toBe("dig_start_required");
    expect(msg(await save(gestor, { title: "T", url: "https://x.com", starts_at: at(10), ends_at: at(5) }))).toBe("dig_bad_period");
  });
  test("card aparece só na janela (15 min antes até o fim), com o link externo", async () => {
    live = (await save(gestor, { title: "Culto ao vivo", url: "https://youtube.com/live/abc", image_url: "https://exemplo.com/i.jpg", starts_at: at(120) })).data.id;
    expect((await cards(membro)).find((c) => c.key === "live")).toBeUndefined(); // longe do início
    await save(gestor, { title: "Culto ao vivo", url: "https://youtube.com/live/abc", starts_at: at(10) }, live);
    let c = (await cards(membro)).find((x) => x.key === "live");
    expect(c.url).toBe("https://youtube.com/live/abc"); expect(c.title).toBe("Culto ao vivo"); expect(c.action).toBe("Assistir ao vivo"); expect((await cards(membro))[0].key).toBe("live");
    await save(gestor, { title: "Culto ao vivo", url: "https://youtube.com/live/abc", starts_at: at(-30) }, live);
    c = (await cards(membro)).find((x) => x.key === "live"); expect(c.label).toBe("Ao vivo agora");
    await save(gestor, { title: "Culto ao vivo", url: "https://youtube.com/live/abc", starts_at: at(-30), ends_at: at(-1) }, live);
    expect((await cards(membro)).find((x) => x.key === "live")).toBeUndefined(); // já terminou
  });
  test("público escolhido e desativação", async () => {
    await save(gestor, { title: "Só membros", url: "https://youtube.com/live/m", starts_at: at(-5), audience: "member" }, live);
    expect((await cards(membro)).some((c) => c.key === "live")).toBe(true);
    expect((await cards(visitante)).some((c) => c.key === "live")).toBe(false);
    await save(gestor, { title: "Só membros", url: "https://youtube.com/live/m", starts_at: at(-5), audience: "all", active: false }, live);
    expect((await cards(membro)).some((c) => c.key === "live")).toBe(false);
    const l = (await rpc(gestor, "live_list", { p_org: org })).data as any[]; expect(l[0].state).toBe("off");
  });
  test("excluir e tabela fechada", async () => {
    expect(msg(await rpc(membro, "live_delete", { p_id: live }))).toMatch(/forbidden/);
    expect((await rpc(gestor, "live_delete", { p_id: live })).data.ok).toBe(true);
    for (const u of [admin, gestor, membro]) { const r = await u.api.get("/live_streams?select=*"); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0); }
  });
});

describe("planos: anotações pessoais e lembretes", () => {
  let plano = "";
  beforeAll(async () => {
    plano = (await rpc(gestor, "plan_save", { p_org: org, p_id: null, p: { title: "Salmos em 2 dias", audience: "all", days: [{ passage: "Salmo 1" }, { passage: "Salmo 23" }] } })).data.id;
    await rpc(gestor, "plan_set_status", { p_id: plano, p_status: "published" });
  });
  test("anotação exige participação no plano; é privada e editável; vazio apaga", async () => {
    expect(msg(await rpc(membro, "plan_note_set", { p_id: plano, p_day: 1, p_body: "oi" }))).toBe("dig_not_enrolled");
    await rpc(membro, "plan_enroll", { p_id: plano });
    expect(msg(await rpc(membro, "plan_note_set", { p_id: plano, p_day: 9, p_body: "oi" }))).toBe("not_found");
    expect(msg(await rpc(membro, "plan_note_set", { p_id: plano, p_day: 1, p_body: "x".repeat(2001) }))).toBe("dig_note_long");
    expect((await rpc(membro, "plan_note_set", { p_id: plano, p_day: 1, p_body: "  Deus é meu pastor  " })).data.ok).toBe(true);
    let d = (await rpc(membro, "plan_get", { p_id: plano })).data.days; expect(d[0].my_note).toBe("Deus é meu pastor"); expect(d[1].my_note).toBeNull();
    await rpc(membro, "plan_note_set", { p_id: plano, p_day: 1, p_body: "Editada" });
    expect((await rpc(membro, "plan_get", { p_id: plano })).data.days[0].my_note).toBe("Editada");
    // ninguém mais lê: gestor, administração, outro membro (mesmo participando), nem pela tabela
    await rpc(outro, "plan_enroll", { p_id: plano });
    for (const u of [admin, gestor, outro, lider, dev]) {
      const days = (await rpc(u, "plan_get", { p_id: plano })).data?.days; if (days) expect(days.every((x: any) => x.my_note == null)).toBe(true);
      const r = await u.api.get("/reading_plan_notes?select=*"); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0);
    }
    await rpc(membro, "plan_note_set", { p_id: plano, p_day: 1, p_body: "" });
    expect((await rpc(membro, "plan_get", { p_id: plano })).data.days[0].my_note).toBeNull();
  });
  test("lembrete é opt-in: sem ativar, não avisa", async () => {
    await svcRpc("plan_remind_dispatch");
    expect((await notifs(membro)).length).toBe(0);
    expect(msg(await rpc(visitante, "plan_remind_set", { p_id: plano, p_on: true, p_time: "07:00" }))).toBe("dig_not_enrolled");
    expect(msg(await rpc(membro, "plan_remind_set", { p_id: plano, p_on: true, p_time: "abc" }))).toBe("dig_bad_time");
  });
  test("lembrete ativado avisa uma vez por dia, com o próximo dia não lido; respeita horário", async () => {
    await rpc(membro, "plan_remind_set", { p_id: plano, p_on: true, p_time: "23:59" });
    expect((await rpc(membro, "plan_get", { p_id: plano })).data.remind).toEqual({ on: true, time: "23:59" });
    const spHora = new Date().toLocaleTimeString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 5);
    if (spHora < "23:59") { await svcRpc("plan_remind_dispatch"); expect((await notifs(membro)).length).toBe(0); } // ainda não chegou a hora
    await rpc(membro, "plan_remind_set", { p_id: plano, p_on: true, p_time: "00:00" });
    expect((await svcRpc("plan_remind_dispatch")).data).toBeGreaterThanOrEqual(1);
    let n = await notifs(membro); expect(n.length).toBe(1); expect(n[0].body).toContain("Dia 1"); expect(n[0].body).toContain("Salmo 1"); expect(n[0].link).toBe(`#/planos/${plano}`);
    await svcRpc("plan_remind_dispatch"); expect((await notifs(membro)).length).toBe(1); // sem repetir no mesmo dia
    expect((await notifs(outro)).length).toBe(0); // quem não ativou não recebe
  });
  test("preferência 'lembretes' desligada silencia; plano concluído não avisa; botão desligado também", async () => {
    await rpc(membro, "plan_mark", { p_id: plano, p_day: 1, p_done: true });
    await fetch(`${REST}/reading_plan_enrollments?plan_id=eq.${plano}&user_id=eq.${membro.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ last_reminded_on: "2020-01-01" }) });
    await rpc(membro, "notif_prefs_set", { p_org: org, p_grp: "lembretes", p_enabled: false });
    await svcRpc("plan_remind_dispatch"); expect((await notifs(membro)).length).toBe(1); // desligado: nada novo
    await rpc(membro, "notif_prefs_set", { p_org: org, p_grp: "lembretes", p_enabled: true });
    await rpc(membro, "plan_mark", { p_id: plano, p_day: 2, p_done: true });
    await fetch(`${REST}/reading_plan_enrollments?plan_id=eq.${plano}&user_id=eq.${membro.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ last_reminded_on: "2020-01-01" }) });
    await svcRpc("plan_remind_dispatch"); expect((await notifs(membro)).length).toBe(1); // concluído: nada novo
  });
  test("funções internas não ficam abertas ao app", async () => {
    expect(msg(await rpc(membro, "plan_remind_dispatch", {}))).toMatch(/permission denied|not found|function/i);
  });
});

describe("aviso no celular (base)", () => {
  const ep = "https://push.example.com/send/abc123";
  test("cadastrar, atualizar e remover aparelho; só https; contagem própria", async () => {
    expect(msg(await rpc(membro, "push_subscribe", { p_endpoint: "http://x.com/a", p_p256dh: "k", p_auth: "a" }))).toBe("push_invalid");
    expect(msg(await rpc(membro, "push_subscribe", { p_endpoint: ep, p_p256dh: "", p_auth: "a" }))).toBe("push_invalid");
    expect((await rpc(membro, "push_subscribe", { p_endpoint: ep, p_p256dh: "k1", p_auth: "a1", p_ua: "Android" })).data.ok).toBe(true);
    expect((await rpc(membro, "push_subscribe", { p_endpoint: ep, p_p256dh: "k2", p_auth: "a2" })).data.ok).toBe(true); // mesmo aparelho: atualiza
    expect((await rpc(membro, "push_status", {})).data.devices).toBe(1);
    expect((await rpc(outro, "push_status", {})).data.devices).toBe(0);
    for (const u of [admin, membro]) { const r = await u.api.get("/push_subscriptions?select=*"); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0); }
  });
  test("notificação de quem tem aparelho entra na fila; de quem não tem, não", async () => {
    await fetch(`${REST}/push_outbox`, { method: "DELETE", headers: await sk() });
    await svcRpc("notify_user", { p_user: membro.id, p_org: org, p_kind: "announcement", p_title: "Aviso importante", p_body: "Corpo", p_link: "#/avisos", p_data: null });
    await svcRpc("notify_user", { p_user: outro.id, p_org: org, p_kind: "announcement", p_title: "Outro aviso", p_body: "Corpo", p_link: "#/avisos", p_data: null });
    const q = await rows("push_outbox?select=user_id,title,link"); expect(q.length).toBe(1); expect(q[0].user_id).toBe(membro.id); expect(q[0].title).toBe("Aviso importante");
  });
  test("preferências continuam valendo: grupo desligado não vira push", async () => {
    await fetch(`${REST}/push_outbox`, { method: "DELETE", headers: await sk() });
    await rpc(membro, "notif_prefs_set", { p_org: org, p_grp: "comunicados", p_enabled: false });
    await svcRpc("notify_user", { p_user: membro.id, p_org: org, p_kind: "announcement", p_title: "Silenciado", p_body: "x", p_link: null, p_data: null });
    expect((await rows("push_outbox?select=id")).length).toBe(0);
  });
  test("envio: pegar pendentes traz os aparelhos; relatório marca enviado e remove aparelho inválido; app não chama", async () => {
    await rpc(membro, "notif_prefs_set", { p_org: org, p_grp: "comunicados", p_enabled: true });
    await svcRpc("notify_user", { p_user: membro.id, p_org: org, p_kind: "announcement", p_title: "Para enviar", p_body: "b", p_link: "#/avisos", p_data: null });
    const claim = (await svcRpc("push_claim", { p_limit: 10 })).data as any[];
    expect(claim.length).toBe(1); expect(claim[0].subs[0].endpoint).toBe(ep); expect(claim[0].subs[0].p256dh).toBe("k2");
    expect(msg(await rpc(membro, "push_claim", { p_limit: 5 }))).toMatch(/permission denied|not found|function/i);
    await svcRpc("push_report", { p_done: [claim[0].id], p_dead: [ep], p_error: null });
    expect((await rows(`push_outbox?id=eq.${claim[0].id}&select=sent_at`))[0].sent_at).not.toBeNull();
    expect((await rpc(membro, "push_status", {})).data.devices).toBe(0); // aparelho morto removido
    expect(((await svcRpc("push_claim", { p_limit: 10 })).data as any[]).length).toBe(0);
  });
  test("remover aparelho pelo próprio usuário", async () => {
    await rpc(membro, "push_subscribe", { p_endpoint: ep, p_p256dh: "k", p_auth: "a" });
    await rpc(outro, "push_unsubscribe", { p_endpoint: ep }); expect((await rpc(membro, "push_status", {})).data.devices).toBe(1); // outro não remove o de membro
    await rpc(membro, "push_unsubscribe", { p_endpoint: ep }); expect((await rpc(membro, "push_status", {})).data.devices).toBe(0);
  });
});
