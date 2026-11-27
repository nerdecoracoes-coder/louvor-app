// Fase 6B — Integrações: chaves de API, API v1, webhooks (eventos, assinatura, falhas, reenvio), logs sem segredos e monitoramento.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";
import { handleApi, dispatchWebhooks, dispatchHandler, signPayload, isPrivateIp, sha256Hex, type IntegEnv } from "../supabase/functions/_shared/integ.ts";

let admin: any, gestor: any, membro: any, dev: any, fora: any, lider: any, outroAdmin: any;
let org = "", orgB = "", team = "";
let env: IntegEnv;
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const ins = async (t: string, b: any) => { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: await sk(), body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(t + JSON.stringify(j)); return j as any[]; };
const patch = async (q: string, b: any) => { const r = await fetch(`${REST}/${q}`, { method: "PATCH", headers: await sk(), body: JSON.stringify(b) }); return r.json(); };
const svcRpc = async (fn: string, body: any = {}) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: "POST", headers: await sk(), body: JSON.stringify(body) }); const t = await r.text(); return { ok: r.ok, data: t ? JSON.parse(t) : null }; };
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const api = (path: string, key?: string, init: RequestInit = {}) => handleApi(new Request("https://x.supabase.co/functions/v1/api" + path, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.headers as any) } }), env);
const newKey = async (scopes: string[], extra: any = {}) => (await rpc(admin, "api_key_create", { p_org: org, p_name: extra.name ?? "Chave teste", p_scopes: scopes, p_rate: extra.rate ?? 60, p_days: extra.days === undefined ? 365 : extra.days })).data;
const ALL = ["events:read", "programs:read", "sermons:read", "contents:read"];
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

beforeAll(async () => {
  env = { rest: REST, serviceKey: await serviceKey(), cronSecret: "segredo-cron" };
  [admin, gestor, membro, dev, fora, lider, outroAdmin] = await Promise.all(["Adm", "Gestor", "Membro", "Dev", "Fora", "Lider", "OutroAdm"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Integra" })).data;
  orgB = (await outroAdmin.api.rpc("create_organization", { p_name: "Igreja Outra" })).data;
  await joinChurch(admin.api, org, gestor, membro, dev, lider);
  await admin.api.rpc("grant_set", { p_org: org, p_user: gestor.id, p_role: "secretary", p_network: null, p_title: "Integrações", p_actions: ["integ_manage"] });
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Int", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_leader: true }) });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
  // dados de cada igreja
  await ins("ev_events", [
    { org_id: org, title: "Culto de Páscoa", starts_at: future(10), ends_at: future(10.1), status: "published", audience: "all", registration: "open", location: "Templo" },
    { org_id: org, title: "Rascunho secreto", starts_at: future(11), ends_at: future(11.1), status: "draft", audience: "all", registration: "none", location: null },
    { org_id: org, title: "Só para membros", starts_at: future(12), ends_at: future(12.1), status: "published", audience: "member", registration: "none", location: null },
    { org_id: orgB, title: "Evento da outra igreja", starts_at: future(10), ends_at: future(10.1), status: "published", audience: "all", registration: "none", location: null }]);
  await ins("prog_items", [{ org_id: org, name: "Culto de domingo", status: "published", visibility: "public", start_date: hoje, starts_time: "19:00", ends_time: "21:00" }, { org_id: org, name: "Reunião de líderes", status: "published", visibility: "leaders", start_date: hoje, starts_time: "19:00", ends_time: "21:00" }, { org_id: org, name: "Rascunho", status: "draft", visibility: "public", start_date: hoje, starts_time: "19:00", ends_time: "21:00" }]);
  await ins("sermons", [{ org_id: org, title: "A graça", preacher: "Pr. Paulo", status: "published", audience: "all" }, { org_id: org, title: "Só membros", preacher: null, status: "published", audience: "member" }]);
  await ins("content_items", [{ org_id: org, kind: "study", title: "Estudo aberto", status: "published", audience: "all" }, { org_id: org, kind: "study", title: "Estudo de membros", status: "published", audience: "member" }]);
});

describe("permissões", () => {
  test("só quem tem integ_manage entra; liderança, desenvolvedor, membro e estranho não", async () => {
    for (const u of [lider, dev, membro, fora]) {
      for (const [fn, a] of [["api_key_list", { p_org: org }], ["wh_list", { p_org: org }], ["integ_status", { p_org: org }], ["integ_log_list", { p_org: org }], ["wh_deliveries", { p_org: org }],
        ["api_key_create", { p_org: org, p_name: "x1", p_scopes: ["events:read"], p_rate: 60, p_days: 30 }], ["wh_save", { p_org: org, p_id: null, p: { name: "x1", url: "https://a.com/h", events: ["person.created"] } }]] as any)
        expect(msg(await rpc(u, fn, a))).toBe("forbidden");
    }
    expect((await rpc(gestor, "api_key_list", { p_org: org })).data).toEqual([]);
    expect((await rpc(admin, "integ_access", { p_org: org })).data).toEqual({ manage: true, fin: true });
    expect((await rpc(gestor, "integ_access", { p_org: org })).data).toEqual({ manage: true, fin: false });
    expect((await rpc(dev, "integ_access", { p_org: org })).data).toEqual({ manage: false, fin: false });
  });
  test("funções do servidor e tabelas não ficam abertas ao app", async () => {
    for (const [fn, a] of [["api_authenticate", { p_hash: "x" }], ["wh_claim", {}], ["wh_report", { p_results: [] }], ["integ_heartbeat", { p_source: "push", p_ok: true }], ["api_v1_events", { p_org: org }], ["integ_purge", {}], ["api_log", { p_org: org, p_key: null, p_method: "GET", p_path: "/", p_status: 200, p_ms: 1 }]] as any)
      expect(msg(await rpc(admin, fn, a))).toMatch(/permission denied|not found|schema cache/i);
    for (const t of ["api_keys", "api_rate", "webhook_endpoints", "webhook_events", "webhook_deliveries", "integration_logs", "integration_heartbeats"])
      for (const u of [admin, gestor]) { const r = await u.api.get(`/${t}?select=*`); expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0); }
  });
});

describe("chaves de API", () => {
  test("validações e chave mostrada uma vez; no banco só o hash", async () => {
    expect(msg(await rpc(admin, "api_key_create", { p_org: org, p_name: "x", p_scopes: ["events:read"], p_rate: 60, p_days: 30 }))).toBe("integ_need_name");
    expect(msg(await rpc(admin, "api_key_create", { p_org: org, p_name: "Ok", p_scopes: ["people:read"], p_rate: 60, p_days: 30 }))).toBe("integ_invalid_scopes");
    expect(msg(await rpc(admin, "api_key_create", { p_org: org, p_name: "Ok", p_scopes: [], p_rate: 60, p_days: 30 }))).toBe("integ_invalid_scopes");
    expect(msg(await rpc(admin, "api_key_create", { p_org: org, p_name: "Ok", p_scopes: ["events:read"], p_rate: 5, p_days: 30 }))).toBe("integ_invalid_rate");
    expect(msg(await rpc(admin, "api_key_create", { p_org: org, p_name: "Ok", p_scopes: ["events:read"], p_rate: 601, p_days: 30 }))).toBe("integ_invalid_rate");
    expect(msg(await rpc(admin, "api_key_create", { p_org: org, p_name: "Ok", p_scopes: ["events:read"], p_rate: 60, p_days: 999 }))).toBe("integ_invalid_days");
    const k = await newKey(ALL, { name: "Site da igreja" });
    expect(k.key).toMatch(/^somos_live_[0-9a-f]{40}$/);
    const stored = JSON.stringify(await rows("api_keys?select=*")); expect(stored).not.toContain(k.key); expect(stored).toContain(await sha256Hex(k.key));
    const l = (await rpc(admin, "api_key_list", { p_org: org })).data as any[]; const me = l.find((x) => x.id === k.id);
    expect(me.prefix).toBe(k.key.slice(0, 15)); expect(me.state).toBe("active"); expect(JSON.stringify(l)).not.toContain(k.key); expect(JSON.stringify(l)).not.toContain("key_hash");
    expect(me.expires_at).not.toBeNull();
  });
  test("revogar vale na hora; só quem gerencia a igreja da chave revoga", async () => {
    const k = await newKey(ALL);
    expect((await api("/v1/ping", k.key)).status).toBe(200);
    expect(msg(await rpc(outroAdmin, "api_key_revoke", { p_id: k.id }))).toBe("forbidden");
    expect(msg(await rpc(membro, "api_key_revoke", { p_id: k.id }))).toBe("forbidden");
    expect((await rpc(gestor, "api_key_revoke", { p_id: k.id })).data.ok).toBe(true);
    const r = await api("/v1/ping", k.key); expect(r.status).toBe(401); expect((await r.json()).error.code).toBe("revoked");
  });
});

describe("API v1", () => {
  let key = "";
  beforeAll(async () => { key = (await newKey(ALL, { name: "Principal" })).key; });
  test("sem chave ou com chave errada: 401; mesmo rota inexistente exige chave; nada é exposto sem autenticação", async () => {
    for (const p of ["/v1/events", "/v1/ping", "/v1/nada", "/v1/people", "/admin", "/"]) {
      const r = await api(p); expect(r.status).toBe(401); expect((await r.json()).error.code).toBe("invalid_key"); expect(r.headers.get("www-authenticate")).toContain("Bearer");
    }
    expect((await api("/v1/events", "somos_live_" + "0".repeat(40))).status).toBe(401);
    expect((await api("/v1/events?api_key=" + key)).status).toBe(401); // chave na URL não vale
    expect((await api("/v1/events", undefined, { headers: { Authorization: "Basic abc" } })).status).toBe(401);
  });
  test("ping, cabeçalhos de versão e limite; rota inexistente e método errado", async () => {
    const r = await api("/v1/ping", key); expect(r.status).toBe(200); expect(r.headers.get("x-api-version")).toBe("v1"); expect(r.headers.get("x-ratelimit-limit")).toBe("60"); expect(Number(r.headers.get("x-ratelimit-remaining"))).toBeLessThan(60);
    expect((await r.json()).data.ok).toBe(true);
    const nf = await api("/v1/people", key); expect(nf.status).toBe(404); expect((await nf.json()).error.code).toBe("not_found");
    expect((await api("/v2/events", key)).status).toBe(404);
    const m = await api("/v1/events", key, { method: "POST", body: "{}" }); expect(m.status).toBe(405); expect(m.headers.get("allow")).toContain("GET");
    expect((await api("/v1/events", key, { method: "DELETE" })).status).toBe(405);
  });
  test("eventos: só publicados para todos, da própria igreja, sem campos internos", async () => {
    const r = await api("/v1/events", key); expect(r.status).toBe(200); const j: any = await r.json();
    expect(j.data.map((e: any) => e.title)).toEqual(["Culto de Páscoa"]);
    expect(Object.keys(j.data[0]).sort()).toEqual(["description", "ends_at", "id", "image_url", "location", "registration", "starts_at", "title"]);
    const raw = JSON.stringify(j); for (const n of ["Rascunho secreto", "Só para membros", "outra igreja", "created_by", "org_id"]) expect(raw).not.toContain(n);
  });
  test("programações, pregações e conteúdos: só o público e publicado", async () => {
    expect(((await (await api("/v1/programs", key)).json()) as any).data.map((x: any) => x.name)).toEqual(["Culto de domingo"]);
    expect(((await (await api("/v1/sermons", key)).json()) as any).data.map((x: any) => x.title)).toEqual(["A graça"]);
    expect(((await (await api("/v1/contents", key)).json()) as any).data.map((x: any) => x.title)).toEqual(["Estudo aberto"]);
  });
  test("escopo: chave só de eventos não lê pregações", async () => {
    const k = (await newKey(["events:read"])).key;
    expect((await api("/v1/events", k)).status).toBe(200);
    const r = await api("/v1/sermons", k); expect(r.status).toBe(403); expect((await r.json()).error.code).toBe("insufficient_scope");
    expect((await api("/v1/ping", k)).status).toBe(200);
  });
  test("paginação e parâmetros inválidos", async () => {
    for (let i = 1; i <= 3; i++) await ins("ev_events", [{ org_id: org, title: `Extra ${i}`, starts_at: future(20 + i), ends_at: future(20.1 + i), status: "published", audience: "all", registration: "none" }]);
    const a: any = await (await api("/v1/events?limit=2", key)).json(); expect(a.data.length).toBe(2); expect(a.has_more).toBe(true); expect(a.limit).toBe(2);
    const b: any = await (await api("/v1/events?limit=2&offset=2", key)).json(); expect(b.data.length).toBe(2); expect(b.has_more).toBe(false); expect(b.offset).toBe(2);
    for (const q of ["limit=0", "limit=101", "limit=abc", "offset=-1", "limit=1.5"]) { const r = await api("/v1/events?" + q, key); expect(r.status).toBe(400); expect((await r.json()).error.code).toBe("invalid_parameter"); }
  });
  test("limite por minuto: depois do limite, 429 com Retry-After; chave vencida: 401", async () => {
    const k = (await newKey(["events:read"], { rate: 10 })).key; let last: Response | null = null;
    for (let i = 0; i < 10; i++) { last = await api("/v1/events", k); expect(last.status).toBe(200); }
    expect(last!.headers.get("x-ratelimit-remaining")).toBe("0");
    const r = await api("/v1/events", k); expect(r.status).toBe(429); expect((await r.json()).error.code).toBe("rate_limited"); expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    const e = await newKey(["events:read"]); await patch(`api_keys?id=eq.${e.id}`, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const x = await api("/v1/events", e.key); expect(x.status).toBe(401); expect((await x.json()).error.code).toBe("expired");
    expect(((await rpc(admin, "api_key_list", { p_org: org })).data as any[]).find((i) => i.id === e.id).state).toBe("expired");
  });
  test("erro interno não vaza detalhes e a chave nunca aparece nos logs", async () => {
    const broken = await handleApi(new Request("https://x/functions/v1/api/v1/events", { headers: { Authorization: `Bearer ${key}` } }), { ...env, rest: "http://127.0.0.1:1/rest" });
    expect(broken.status).toBe(500); const t = await broken.text(); expect(t).toContain("internal_error"); expect(t).not.toMatch(/stack|ECONN|127\.0\.0\.1/i);
    const logs = (await rpc(admin, "integ_log_list", { p_org: org, p_source: "api" })).data as any[];
    expect(logs.length).toBeGreaterThan(5); expect(JSON.stringify(logs)).not.toContain("somos_live_"); expect(JSON.stringify(logs)).not.toContain(key);
    expect(logs.some((l) => l.level === "warn")).toBe(true); expect(logs.some((l) => l.event === "GET /v1/events" && l.detail.status === 200)).toBe(true);
    expect((await rpc(admin, "integ_log_list", { p_org: orgB })).data?.length ?? msg(await rpc(admin, "integ_log_list", { p_org: orgB }))).toBe("forbidden");
  });
});

describe("webhooks: cadastro", () => {
  const save = (u: any, p: any, id: string | null = null) => rpc(u, "wh_save", { p_org: org, p_id: id, p });
  test("validações de endereço, eventos e permissão financeira", async () => {
    const ok = { name: "CRM", url: "https://crm.exemplo.com.br/hook", events: ["person.created"] };
    for (const url of ["http://crm.exemplo.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://10.0.0.5/h", "https://192.168.0.2/h", "https://servidor.local/h", "https://api.interno.internal/h", "https://user:pw@crm.exemplo.com/h", "https://semponto/h", "ftp://a.com/h", "javascript:alert(1)", ""])
      expect(msg(await save(admin, { ...ok, url }))).toBe("integ_bad_url");
    expect(msg(await save(admin, { ...ok, events: [] }))).toBe("integ_invalid_events");
    expect(msg(await save(admin, { ...ok, events: ["person.deleted"] }))).toBe("integ_invalid_events");
    expect(msg(await save(admin, { ...ok, name: " " }))).toBe("integ_need_name");
    expect(msg(await save(gestor, { ...ok, events: ["contribution.recorded"] }))).toBe("integ_fin_denied"); // gestor sem fin_manage
    expect((await save(gestor, ok)).data.ok).toBe(true);
  });
  test("segredo aparece uma vez; listagem só mostra o final; trocar o segredo gera outro", async () => {
    const r = await save(admin, { name: "Financeiro", url: "https://contab.exemplo.com.br/hook", events: ["contribution.recorded", "event.created"] });
    expect(r.data.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    const l = (await rpc(admin, "wh_list", { p_org: org })).data as any[]; const me = l.find((x) => x.id === r.data.id);
    expect(me.secret_hint).toBe("…" + r.data.secret.slice(-4)); expect(JSON.stringify(l)).not.toContain(r.data.secret);
    const up = await save(admin, { name: "Financeiro 2", url: "https://contab.exemplo.com.br/hook2", events: ["event.created"] }, r.data.id); expect(up.data.secret).toBeUndefined();
    const rot = (await rpc(admin, "wh_rotate_secret", { p_id: r.data.id })).data.secret; expect(rot).not.toBe(r.data.secret);
    expect(msg(await rpc(membro, "wh_rotate_secret", { p_id: r.data.id }))).toBe("forbidden");
    expect(msg(await rpc(outroAdmin, "wh_set_active", { p_id: r.data.id, p_on: false }))).toBe("forbidden");
    expect(msg(await rpc(outroAdmin, "wh_delete", { p_id: r.data.id }))).toBe("forbidden");
    const h = (await rpc(admin, "org_inst_history", { p_org: org }));
    void h;
  });
  test("limite de 10 endereços por igreja", async () => {
    const o = (await newUser("Lim")); const oo = (await o.api.rpc("create_organization", { p_name: "Lim" })).data;
    for (let i = 0; i < 10; i++) expect((await rpc(o, "wh_save", { p_org: oo, p_id: null, p: { name: `Dest ${i}`, url: `https://d${i}.exemplo.com/h`, events: ["person.created"] } })).data.ok).toBe(true);
    expect(msg(await rpc(o, "wh_save", { p_org: oo, p_id: null, p: { name: "Dest 11", url: "https://d11.exemplo.com/h", events: ["person.created"] } }))).toBe("integ_limit_reached");
  });
});

describe("webhooks: eventos emitidos", () => {
  let epAll = "", epOther = "";
  const evs = async (type?: string) => rows(`webhook_events?org_id=eq.${org}${type ? `&event_type=eq.${type}` : ""}&select=id,event_type,payload&order=id`);
  beforeAll(async () => {
    await rows("webhook_events"); await fetch(`${REST}/webhook_events`, { method: "DELETE", headers: await sk() }); await fetch(`${REST}/webhook_endpoints?org_id=eq.${org}`, { method: "DELETE", headers: await sk() });
    epAll = (await rpc(admin, "wh_save", { p_org: org, p_id: null, p: { name: "Tudo", url: "https://tudo.exemplo.com/h", events: ["person.created", "person.updated", "event.created", "registration.created", "attendance.recorded", "contribution.recorded", "program.published"] } })).data.id;
    epOther = (await rpc(outroAdmin, "wh_save", { p_org: orgB, p_id: null, p: { name: "Outra", url: "https://outra.exemplo.com/h", events: ["person.created", "event.created"] } })).data.id;
  });
  test("pessoa cadastrada e atualizada: só dados mínimos; telefone/e-mail/CPF nunca saem", async () => {
    const p = (await ins("people", [{ org_id: org, full_name: "Maria Souza", classification: "visitor", status: "active", cpf: "52998224725", email: "maria@x.com", phone: "21999990000", birth_date: "1990-01-01" }]))[0];
    const c = await evs("person.created"); expect(c.length).toBe(1); expect(c[0].payload).toEqual({ id: p.id, full_name: "Maria Souza", classification: "visitor", status: "active" });
    const raw = JSON.stringify(await evs()); for (const n of ["52998224725", "maria@x.com", "21999990000", "1990"]) expect(raw).not.toContain(n);
    await patch(`people?id=eq.${p.id}`, { phone: "21888880000", city: "Rio" }); expect((await evs("person.updated")).length).toBe(0); // campos que não importam não geram evento
    await patch(`people?id=eq.${p.id}`, { classification: "member" });
    const u = await evs("person.updated"); expect(u.length).toBe(1); expect(u[0].payload.changed).toEqual(["classification"]); expect(u[0].payload.classification).toBe("member");
  });
  test("evento criado, inscrição e presença", async () => {
    const e = (await ins("ev_events", [{ org_id: org, title: "Retiro", starts_at: future(30), ends_at: future(31), status: "draft", audience: "member", registration: "open" }]))[0];
    expect((await evs("event.created")).map((x) => x.payload.title)).toEqual(["Retiro"]);
    const r = (await ins("ev_registrations", [{ event_id: e.id, org_id: org, name: "Pessoa Inscrita", guests: 1, status: "confirmed", code: "ABC123", source: "self" }]))[0];
    const reg = await evs("registration.created"); expect(reg.length).toBe(1); expect(reg[0].payload).toEqual({ id: r.id, event_id: e.id, status: "confirmed", guests: 1, source: "self" });
    expect(JSON.stringify(reg)).not.toContain("Pessoa Inscrita");
    await patch(`ev_registrations?id=eq.${r.id}`, { checked_in_at: new Date().toISOString(), checked_in_count: 2 });
    const att = await evs("attendance.recorded"); expect(att.length).toBe(1); expect(att[0].payload.count).toBe(2); expect(att[0].payload.event_id).toBe(e.id);
    await patch(`ev_registrations?id=eq.${r.id}`, { checked_in_count: 3 }); expect((await evs("attendance.recorded")).length).toBe(1); // não repete
  });
  test("contribuição: só receita baixada, sem pessoa nem doador", async () => {
    const acc = (await ins("fin_accounts", [{ org_id: org, name: "Caixa", kind: "cash" }]))[0].id;
    const pessoa = (await rows(`people?org_id=eq.${org}&select=id&limit=1`))[0].id;
    const base = { org_id: org, account_id: acc, due_date: hoje, amount: 250, person_id: pessoa, counterparty: "João Doador", description: "Oferta", method: "pix" };
    await ins("fin_entries", [{ ...base, kind: "income", status: "open", approval: "none" }]); expect((await evs("contribution.recorded")).length).toBe(0); // em aberto: nada
    const e = (await ins("fin_entries", [{ ...base, kind: "income", status: "settled", paid_at: hoje, approval: "none" }]))[0];
    await ins("fin_entries", [{ ...base, kind: "expense", status: "settled", paid_at: hoje, approval: "approved" }]); // despesa: nada
    const c = await evs("contribution.recorded"); expect(c.length).toBe(1); expect(Number(c[0].payload.amount)).toBe(250); expect(c[0].payload.id).toBe(e.id);
    const raw = JSON.stringify(c); for (const n of ["João Doador", pessoa, "person_id", "counterparty", "Oferta"]) expect(raw).not.toContain(n);
    const open = (await ins("fin_entries", [{ ...base, kind: "income", status: "open", approval: "none" }]))[0];
    await patch(`fin_entries?id=eq.${open.id}`, { status: "settled", paid_at: hoje }); expect((await evs("contribution.recorded")).length).toBe(2); // baixa depois também conta
  });
  test("programação publicada: só a pública, só ao publicar", async () => {
    const p = (await ins("prog_items", [{ org_id: org, name: "Vigília", status: "draft", visibility: "public", start_date: hoje, starts_time: "19:00", ends_time: "21:00" }]))[0];
    expect((await evs("program.published")).length).toBe(0);
    await patch(`prog_items?id=eq.${p.id}`, { status: "published" }); expect((await evs("program.published")).map((x) => x.payload.name)).toEqual(["Vigília"]);
    await ins("prog_items", [{ org_id: org, name: "Reunião interna", status: "published", visibility: "leaders", start_date: hoje, starts_time: "19:00", ends_time: "21:00" }]); expect((await evs("program.published")).length).toBe(1);
  });
  test("cada igreja só gera eventos para os próprios endereços; endereço desativado ou sem assinatura não recebe", async () => {
    expect((await rows(`webhook_deliveries?endpoint_id=eq.${epOther}&select=id`)).length).toBe(0); // eventos da igreja A não foram para a B
    await ins("people", [{ org_id: orgB, full_name: "Pessoa B", classification: "member", status: "active" }]);
    expect((await rows(`webhook_events?org_id=eq.${orgB}&select=event_type`)).map((x) => x.event_type)).toEqual(["person.created"]);
    expect((await rows(`webhook_deliveries?endpoint_id=eq.${epAll}&select=event_id,webhook_events(org_id)`)).every((d: any) => d.webhook_events.org_id === org)).toBe(true);
    await rpc(admin, "wh_set_active", { p_id: epAll, p_on: false });
    const antes = (await evs()).length; await ins("people", [{ org_id: org, full_name: "Sem destino", classification: "visitor", status: "active" }]); expect((await evs()).length).toBe(antes);
    await rpc(admin, "wh_set_active", { p_id: epAll, p_on: true });
    await fetch(`${REST}/webhook_endpoints?id=eq.${epAll}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ events: ["event.created"] }) });
    const a2 = (await evs()).length; await ins("people", [{ org_id: org, full_name: "Sem assinatura", classification: "visitor", status: "active" }]); expect((await evs()).length).toBe(a2);
  });
});

describe("webhooks: envio, assinatura, falhas e reenvio", () => {
  let ep = "", secret = "";
  const calls: { url: string; init: any }[] = []; let mode: "ok" | "500" | "throw" | "redirect" | "timeout" = "ok";
  const fetchFn = (async (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith(REST)) return fetch(url, init);
    calls.push({ url: u, init });
    if (mode === "throw") throw new Error("boom " + secret);
    if (mode === "timeout") { const e: any = new Error("t"); e.name = "TimeoutError"; throw e; }
    return new Response("ok " + secret, { status: mode === "500" ? 500 : mode === "redirect" ? 302 : 200, headers: mode === "redirect" ? { location: "https://x.com" } : {} });
  }) as typeof fetch;
  const deps = { fetchFn, resolveDns: async () => ["93.184.216.34"] };
  const dels = async (st?: string) => ((await rpc(admin, "wh_deliveries", { p_org: org, p_endpoint: ep, p_status: st ?? null })).data as any[]);
  const reset = async () => { await fetch(`${REST}/webhook_deliveries?endpoint_id=eq.${ep}`, { method: "DELETE", headers: await sk() }); calls.length = 0; mode = "ok"; };
  beforeAll(async () => {
    await fetch(`${REST}/webhook_endpoints?org_id=eq.${org}`, { method: "DELETE", headers: await sk() });
    await fetch(`${REST}/webhook_deliveries?id=gt.0`, { method: "DELETE", headers: await sk() }); // o despacho é global: começa sem entregas de outras igrejas
    const r = (await rpc(admin, "wh_save", { p_org: org, p_id: null, p: { name: "Receptor", url: "https://receptor.exemplo.com/hook", events: ["person.created"] } })).data; ep = r.id; secret = r.secret;
  });
  test("entrega assinada: corpo, cabeçalhos e HMAC conferem; histórico mostra sucesso", async () => {
    await reset(); await ins("people", [{ org_id: org, full_name: "Ana Webhook", classification: "member", status: "active" }]);
    const s = await dispatchWebhooks(env, deps); expect(s).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(calls.length).toBe(1); const { url, init } = calls[0]; expect(url).toBe("https://receptor.exemplo.com/hook"); expect(init.method).toBe("POST"); expect(init.redirect).toBe("manual");
    const h = init.headers; const body = String(init.body); const j = JSON.parse(body);
    expect(j.type).toBe("person.created"); expect(j.id).toMatch(/^evt_\d+$/); expect(j.data.full_name).toBe("Ana Webhook"); expect(body).not.toContain(secret);
    expect(h["X-Somos-Event"]).toBe("person.created"); expect(h["X-Somos-Signature"]).toBe(await signPayload(secret, Number(h["X-Somos-Timestamp"]), body)); expect(h["X-Somos-Delivery"]).toMatch(/^\d+$/);
    expect(h["X-Somos-Signature"]).not.toBe(await signPayload("outro-segredo", Number(h["X-Somos-Timestamp"]), body)); // segredo errado não confere
    const d = (await dels())[0]; expect(d).toMatchObject({ status: "success", attempts: 1, response_status: 200, event_type: "person.created" }); expect(d.error).toBeNull();
    expect((await dispatchWebhooks(env, deps)).claimed).toBe(0); // nada pendente: não reenvia
    expect(((await rpc(admin, "wh_list", { p_org: org })).data as any[]).find((x) => x.id === ep).last.status).toBe("success");
  });
  test("falha: espera crescente, 6 tentativas, depois abandonada; reenvio manual reativa", async () => {
    await reset(); mode = "500"; await ins("people", [{ org_id: org, full_name: "Falha Um", classification: "member", status: "active" }]);
    expect((await dispatchWebhooks(env, deps)).failed).toBe(1);
    let d = (await dels())[0]; expect(d).toMatchObject({ status: "failed", attempts: 1, response_status: 500 }); expect(d.error).toContain("500");
    const wait = new Date(d.next_attempt_at).getTime() - Date.now(); expect(wait).toBeGreaterThan(30_000); expect(wait).toBeLessThan(90_000); // ~1 min
    expect((await dispatchWebhooks(env, deps)).claimed).toBe(0); // ainda não venceu
    for (let i = 2; i <= 6; i++) {
      await fetch(`${REST}/webhook_deliveries?endpoint_id=eq.${ep}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }) });
      expect((await dispatchWebhooks(env, deps)).claimed).toBe(1); d = (await dels())[0]; expect(d.attempts).toBe(i);
    }
    expect(d.status).toBe("dead"); expect(d.next_attempt_at).toBeNull();
    await fetch(`${REST}/webhook_deliveries?endpoint_id=eq.${ep}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }) });
    expect((await dispatchWebhooks(env, deps)).claimed).toBe(0); // abandonada não volta sozinha
    expect(msg(await rpc(membro, "wh_retry", { p_delivery: d.id }))).toBe("forbidden"); expect(msg(await rpc(outroAdmin, "wh_retry", { p_delivery: d.id }))).toBe("forbidden");
    expect((await rpc(gestor, "wh_retry", { p_delivery: d.id })).data.ok).toBe(true);
    mode = "ok"; expect((await dispatchWebhooks(env, deps)).sent).toBe(1); expect((await dels())[0]).toMatchObject({ status: "success", attempts: 1 });
    expect(msg(await rpc(admin, "wh_retry", { p_delivery: d.id }))).toBe("integ_not_retryable"); // já entregue: não reenvia
  });
  test("redirecionamento, tempo esgotado e erro de conexão contam como falha, sem vazar o segredo", async () => {
    for (const [m, txt] of [["redirect", "redirecionamento"], ["timeout", "tempo esgotado"], ["throw", "falha de conexão"]] as const) {
      await reset(); mode = m; await ins("people", [{ org_id: org, full_name: `Erro ${m}`, classification: "member", status: "active" }]); await dispatchWebhooks(env, deps);
      const d = (await dels())[0]; expect(d.status).toBe("failed"); expect(d.error).toContain(txt); expect(JSON.stringify(d)).not.toContain(secret);
    }
    const all = JSON.stringify([(await rows("integration_logs?select=*")), await rows("webhook_deliveries?select=*")]); expect(all).not.toContain(secret); expect(all).not.toContain("whsec_" + secret.slice(6, 30));
  });
  test("destino em rede interna é bloqueado antes de enviar", async () => {
    await reset(); await ins("people", [{ org_id: org, full_name: "Interno", classification: "member", status: "active" }]);
    for (const ip of [["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["::1"], ["93.184.216.34", "192.168.1.1"], []]) {
      await fetch(`${REST}/webhook_deliveries?endpoint_id=eq.${ep}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ status: "pending", next_attempt_at: new Date(Date.now() - 1000).toISOString() }) });
      await dispatchWebhooks(env, { ...deps, resolveDns: async () => ip as string[] }); expect(calls.length).toBe(0);
    }
    expect((await dels())[0].error).toMatch(/bloqueado/);
    await fetch(`${REST}/webhook_deliveries?endpoint_id=eq.${ep}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ status: "pending", next_attempt_at: new Date(Date.now() - 1000).toISOString() }) });
    await dispatchWebhooks(env, { ...deps, resolveDns: async () => { throw new Error("nx"); } }); expect((await dels())[0].error).toMatch(/resolver/); expect(calls.length).toBe(0);
  });
  test("teste de conexão envia webhook.test mesmo sem assinar o evento", async () => {
    await reset(); expect((await rpc(admin, "wh_test", { p_id: ep })).data.ok).toBe(true); expect(msg(await rpc(membro, "wh_test", { p_id: ep }))).toBe("forbidden");
    await dispatchWebhooks(env, deps); expect(JSON.parse(String(calls[0].init.body)).type).toBe("webhook.test"); expect((await dels())[0].event_type).toBe("webhook.test");
  });
  test("endereço desativado não recebe; desativa sozinho após 30 falhas seguidas", async () => {
    await reset(); await ins("people", [{ org_id: org, full_name: "Pendente", classification: "member", status: "active" }]);
    await rpc(admin, "wh_set_active", { p_id: ep, p_on: false }); expect((await dispatchWebhooks(env, deps)).claimed).toBe(0); expect(calls.length).toBe(0);
    await rpc(admin, "wh_set_active", { p_id: ep, p_on: true });
    await fetch(`${REST}/webhook_endpoints?id=eq.${ep}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ failure_streak: 29 }) });
    mode = "500"; await dispatchWebhooks(env, deps);
    const e = (await rows(`webhook_endpoints?id=eq.${ep}&select=active,disabled_reason`))[0]; expect(e.active).toBe(false); expect(e.disabled_reason).toContain("30 falhas");
    expect(((await rpc(admin, "wh_list", { p_org: org })).data as any[]).find((x) => x.id === ep).disabled_reason).toContain("30 falhas");
    await rpc(admin, "wh_set_active", { p_id: ep, p_on: true }); expect((await rows(`webhook_endpoints?id=eq.${ep}&select=failure_streak,disabled_reason`))[0]).toEqual({ failure_streak: 0, disabled_reason: null });
  });
  test("agendamento: só com o segredo do cron", async () => {
    const h = dispatchHandler(env, deps);
    expect((await h(new Request("https://x/f"))).status).toBe(401); expect((await h(new Request("https://x/f", { headers: { "x-cron-secret": "errado" } }))).status).toBe(401);
    const ok = await h(new Request("https://x/f", { headers: { "x-cron-secret": "segredo-cron" } })); expect(ok.status).toBe(200); expect((await ok.json()).ok).toBe(true);
    expect((await dispatchHandler({ ...env, cronSecret: undefined }, deps)(new Request("https://x/f", { headers: { "x-cron-secret": "" } }))).status).toBe(401);
  });
});

describe("logs, limpeza e monitoramento", () => {
  test("limpeza de segredos: chaves sensíveis somem e textos ocultam chaves/segredos", async () => {
    const r = await svcRpc("integ_log", { p_org: org, p_source: "system", p_level: "info", p_event: "teste" }); void r;
    expect((await svcRpc("integ_clean", { j: { ok: 1, secret: "a", api_key: "b", Authorization: "c", token: "d", note: "usei whsec_abc123def456 e somos_live_deadbeef" } })).data).toEqual({ ok: 1, note: "usei [oculto] e [oculto]" });
    await svcRpc("wh_report", { p_results: [{ id: 999999, ok: false, error: "x" }] }); // entrega inexistente: ignora
  });
  test("relatório de falha com segredo no texto: salvo oculto", async () => {
    const e = (await rows(`webhook_endpoints?org_id=eq.${org}&select=id`))[0].id;
    const ev = (await ins("webhook_events", [{ org_id: org, event_type: "person.created", payload: {} }]))[0].id;
    const d = (await ins("webhook_deliveries", [{ endpoint_id: e, event_id: ev, attempts: 1, status: "pending" }]))[0].id;
    await svcRpc("wh_report", { p_results: [{ id: d, ok: false, status: 502, error: "falhou com whsec_aaaabbbbcccc1111 no corpo" }] });
    const row = (await rows(`webhook_deliveries?id=eq.${d}&select=error,status`))[0]; expect(row.error).toBe("falhou com [oculto] no corpo"); expect(row.status).toBe("failed");
    const lg = JSON.stringify(await rows("integration_logs?select=*")); expect(lg).not.toContain("whsec_aaaabbbbcccc1111");
  });
  test("status: pendências, falhas, chaves ativas, aparelhos de push e execução dos serviços", async () => {
    await svcRpc("integ_heartbeat", { p_source: "webhooks", p_ok: true, p_detail: { claimed: 0 } });
    await svcRpc("integ_heartbeat", { p_source: "push", p_ok: false, p_detail: { configured: false, token: "nao-grava" } });
    const s = (await rpc(admin, "integ_status", { p_org: org })).data;
    expect(s.webhooks.endpoints_active + s.webhooks.endpoints_disabled).toBeGreaterThan(0); expect(s.webhooks.pending).toBeGreaterThan(0); expect(s.webhooks.failed_24h).toBeGreaterThan(0);
    expect(s.api.keys_active).toBeGreaterThan(0); expect(s.api.requests_24h).toBeGreaterThan(5); expect(s.push.configured).toBe(false);
    expect(s.heartbeats.map((x: any) => [x.source, x.state])).toEqual([["push", "ok"], ["webhooks", "ok"]]); expect(JSON.stringify(s)).not.toContain("nao-grava");
    await patch("integration_heartbeats?source=eq.webhooks", { last_run_at: new Date(Date.now() - 3600_000).toISOString() });
    expect(((await rpc(admin, "integ_status", { p_org: org })).data.heartbeats as any[]).find((x) => x.source === "webhooks").state).toBe("late");
    expect(msg(await rpc(outroAdmin, "integ_status", { p_org: org }))).toBe("forbidden");
  });
  test("lista de logs filtra por origem e nível; cada igreja só vê os próprios", async () => {
    const w = (await rpc(admin, "integ_log_list", { p_org: org, p_source: "webhook" })).data as any[]; expect(w.length).toBeGreaterThan(0); expect(w.every((x) => x.source === "webhook")).toBe(true);
    const er = (await rpc(admin, "integ_log_list", { p_org: org, p_level: "error" })).data as any[]; expect(er.every((x) => x.level === "error")).toBe(true);
    const meus = JSON.stringify(((await rpc(admin, "wh_list", { p_org: org })).data as any[]).map((x) => x.id)); const dela = (await rpc(outroAdmin, "integ_log_list", { p_org: orgB })).data as any[];
    expect(dela.every((x) => !meus.includes(String(x.detail?.endpoint ?? "nenhum-id")))).toBe(true); // cada igreja só vê o que é dela
  });
  test("limpeza periódica apaga logs antigos e eventos entregues, e preserva o que ainda está pendente", async () => {
    const velho = new Date(Date.now() - 100 * 86400000).toISOString();
    await ins("integration_logs", [{ org_id: org, source: "system", level: "info", event: "antigo", created_at: velho }]);
    const e = (await rows(`webhook_endpoints?org_id=eq.${org}&select=id`))[0].id;
    const evOld = (await ins("webhook_events", [{ org_id: org, event_type: "person.created", payload: {}, created_at: velho }, { org_id: org, event_type: "person.created", payload: {}, created_at: velho }])).map((x) => x.id);
    await ins("webhook_deliveries", [{ endpoint_id: e, event_id: evOld[0], status: "success" }, { endpoint_id: e, event_id: evOld[1], status: "failed" }]);
    const r = (await svcRpc("integ_purge")).data; expect(r.logs).toBeGreaterThanOrEqual(1);
    expect((await rows(`webhook_events?id=eq.${evOld[0]}&select=id`)).length).toBe(0); expect((await rows(`webhook_events?id=eq.${evOld[1]}&select=id`)).length).toBe(1);
    expect((await rows("integration_logs?event=eq.antigo&select=id")).length).toBe(0);
  });
});

describe("funções auxiliares", () => {
  test("isPrivateIp cobre redes internas, loopback, link-local e nuvem", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:10.0.0.1", "abc"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.0.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  test("assinatura é determinística e muda com segredo, tempo ou corpo", async () => {
    const a = await signPayload("s", 1, "{}"); expect(a).toMatch(/^v1=[0-9a-f]{64}$/); expect(await signPayload("s", 1, "{}")).toBe(a);
    for (const b of [await signPayload("t", 1, "{}"), await signPayload("s", 2, "{}"), await signPayload("s", 1, "{ }")]) expect(b).not.toBe(a);
  });
});
