// Fase 4B — Cuidado com Pessoas: pedidos de oração, intercessão, atendimento pastoral e confidencialidade.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, intercessor: any, pastor: any, gestor: any, membro: any, outro: any, lider: any, dev: any, fora: any, gmember: any;
let org = "", team = "", grp = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const msg = (r: any) => String(r.data?.message ?? "");
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const SECRET = "segredo-do-pedido-123";
const create = (u: any, p: any) => rpc(u, "prayer_request_create", { p_org: org, p: { body: SECRET, ...p } });

beforeAll(async () => {
  [admin, intercessor, pastor, gestor, membro, outro, lider, dev, fora, gmember] = await Promise.all(["Adm", "Interc", "Pastor", "Gestor", "Membro", "Outro", "Lider", "Dev", "Fora", "GMember"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Cuidado" })).data;
  await joinChurch(admin.api, org, intercessor, pastor, gestor, membro, outro, lider, dev, gmember);
  const grant = (u: any, t: string, a: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: t, p_actions: a });
  await grant(intercessor, "Intercessor", ["care_prayer"]); await grant(pastor, "Pastoral", ["care_pastoral"]); await grant(gestor, "Gestor", ["care_manage"]);
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Cu", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_leader: true }) });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
  grp = (await rpc(gestor, "care_group_save", { p_org: org, p_id: null, p: { name: "Intercessores" } })).data.id;
  await rpc(gestor, "care_group_member_set", { p_group: grp, p_user: gmember.id, p_in: true });
});

describe("permissões e fechamento das tabelas", () => {
  test("liderança de time, desenvolvedor, membro comum e quem está fora não acessam as áreas de gestão", async () => {
    for (const u of [lider, dev, membro, fora]) {
      expect(msg(await rpc(u, "prayer_inbox", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "pastoral_inbox", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "pastoral_session_list", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "care_report", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "care_access_log", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await rpc(u, "care_group_list", { p_org: org }))).toMatch(/forbidden/);
    }
    expect(msg(await rpc(fora, "care_overview", { p_org: org }))).toMatch(/forbidden/);
    expect(msg(await create(fora, {}))).toMatch(/forbidden/);
  });
  test("cada permissão faz só o seu papel", async () => {
    expect(msg(await rpc(intercessor, "pastoral_inbox", { p_org: org }))).toMatch(/forbidden/);
    expect(msg(await rpc(pastor, "prayer_inbox", { p_org: org }))).toMatch(/forbidden/);
    expect(msg(await rpc(intercessor, "care_report", { p_org: org }))).toMatch(/forbidden/);
    expect(msg(await rpc(pastor, "care_group_save", { p_org: org, p_id: null, p: { name: "X" } }))).toMatch(/forbidden/);
    expect(msg(await rpc(gestor, "prayer_inbox", { p_org: org }))).toMatch(/forbidden/); // gerir não dá leitura dos pedidos
  });
  test("nenhuma tabela é legível pelas chaves do app (nem pelo administrador)", async () => {
    await create(membro, {});
    for (const t of ["prayer_requests", "prayer_events", "pastoral_requests", "pastoral_sessions", "prayer_groups", "prayer_group_members", "care_access", "care_settings"]) {
      for (const u of [admin, membro, intercessor, pastor]) {
        const r = await u.api.get(`/${t}?select=*`);
        expect(Array.isArray(r.data) ? r.data.length : 0).toBe(0);
      }
    }
  });
});

describe("pedidos de oração", () => {
  test("só liderança autorizada: o conteúdo chega à caixa autorizada e a nenhum outro membro", async () => {
    const id = (await create(membro, { privacy: "leadership" })).data.id;
    const inbox = (await rpc(intercessor, "prayer_inbox", { p_org: org })).data as any[];
    expect(inbox.find((r) => r.id === id).body).toBe(SECRET);
    expect(msg(await rpc(outro, "prayer_request_get", { p_id: id }))).toBe("forbidden");
    expect(msg(await rpc(lider, "prayer_request_get", { p_id: id }))).toBe("forbidden");
    expect(msg(await rpc(gmember, "prayer_request_get", { p_id: id }))).toBe("forbidden");
    expect(msg(await rpc(gmember, "prayer_request_pray", { p_id: id }))).toBe("forbidden");
    expect((await rpc(membro, "prayer_request_get", { p_id: id })).data.mine).toBe(true);
  });
  test("compartilhado com grupo: só o grupo e a liderança autorizada leem; outros não", async () => {
    const id = (await create(membro, { privacy: "group", group_id: grp })).data.id;
    const gi = (await rpc(gmember, "prayer_group_inbox", { p_org: org })).data as any[];
    expect(gi.some((r) => r.id === id && r.body === SECRET)).toBe(true);
    expect(msg(await rpc(outro, "prayer_group_inbox", { p_org: org }))).toBe("forbidden");
    expect(msg(await rpc(outro, "prayer_request_get", { p_id: id }))).toBe("forbidden");
    expect((await rpc(gmember, "prayer_request_pray", { p_id: id })).data.ok).toBe(true);
    expect((await rpc(gmember, "prayer_group_inbox", { p_org: org })).data.find((r: any) => r.id === id).prayers).toBe(1);
    // o grupo não altera situação nem responsável
    expect(msg(await rpc(gmember, "prayer_request_update", { p_id: id, p: { status: "closed" } }))).toBe("forbidden");
  });
  test("grupo inválido, privacidade inválida e texto vazio são recusados", async () => {
    expect(msg(await create(membro, { privacy: "group", group_id: null }))).toBe("care_invalid_group");
    expect(msg(await create(membro, { privacy: "todos" }))).toBe("care_invalid_privacy");
    expect(msg(await create(membro, { body: "  " }))).toBe("care_body_required");
  });
  test("anônimo: só se a igreja permitir; a identidade nunca é devolvida", async () => {
    expect(msg(await create(membro, { anonymous: true }))).toBe("care_anonymous_off");
    expect(msg(await rpc(intercessor, "care_settings_save", { p_org: org, p: { allow_anonymous: true } }))).toBe("forbidden");
    expect((await rpc(gestor, "care_settings_save", { p_org: org, p: { allow_anonymous: true } })).data.ok).toBe(true);
    const id = (await create(outro, { anonymous: true })).data.id;
    const item = ((await rpc(intercessor, "prayer_inbox", { p_org: org })).data as any[]).find((r) => r.id === id);
    expect(item.requester).toBeNull();
    const got = (await rpc(intercessor, "prayer_request_get", { p_id: id })).data;
    expect(got.request.requester).toBeNull();
    expect(JSON.stringify(got)).not.toContain(outro.id);
    expect(JSON.stringify(item)).not.toContain(outro.id);
    // o próprio autor ainda enxerga e acompanha
    expect(((await rpc(outro, "prayer_my_requests", { p_org: org })).data as any[]).some((r) => r.id === id)).toBe(true);
  });
  test("situação e responsável: só da liderança autorizada; avisa o autor sem conteúdo", async () => {
    const id = (await create(membro, {})).data.id;
    expect(msg(await rpc(intercessor, "prayer_request_update", { p_id: id, p: { assigned_to: membro.id } }))).toBe("care_invalid_assignee");
    expect((await rpc(intercessor, "prayer_request_update", { p_id: id, p: { assigned_to: intercessor.id, status: "in_prayer", note: "Orando" } })).data.ok).toBe(true);
    const notes = await rows(`notifications?user_id=eq.${membro.id}&kind=eq.care_prayer_update&select=title,body,data`);
    expect(notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(notes)).not.toContain(SECRET);
    const mine = ((await rpc(membro, "prayer_my_requests", { p_org: org })).data as any[]).find((r) => r.id === id);
    expect(mine.status).toBe("in_prayer");
    expect(JSON.stringify(mine.events)).not.toContain("Orando"); // anotação interna não vai ao autor
    expect(msg(await rpc(intercessor, "prayer_request_update", { p_id: id, p: { status: "xx" } }))).toBe("care_invalid_status");
  });
  test("notificações de novo pedido não carregam o conteúdo e não chegam a quem não é autorizado", async () => {
    const all = await rows(`notifications?org_id=eq.${org}&kind=like.care_*&select=user_id,title,body,link`);
    expect(JSON.stringify(all)).not.toContain(SECRET);
    expect(all.some((n) => [lider.id, dev.id, outro.id].includes(n.user_id))).toBe(false);
    expect(all.some((n) => n.user_id === intercessor.id)).toBe(true);
  });
  test("o autor pode encerrar o próprio pedido; nenhum outro pode", async () => {
    const id = (await create(membro, {})).data.id;
    expect(msg(await rpc(outro, "prayer_my_close", { p_id: id }))).toBe("not_found");
    expect((await rpc(membro, "prayer_my_close", { p_id: id })).data.ok).toBe(true);
    expect(msg(await rpc(membro, "prayer_my_close", { p_id: id }))).toBe("care_already_closed");
  });
  test("limite de pedidos por dia", async () => {
    const u = await newUser("Spam"); await joinChurch(admin.api, org, u);
    for (let i = 0; i < 5; i++) expect((await create(u, {})).data.ok).toBe(true);
    expect(msg(await create(u, {}))).toBe("care_rate_limit");
  });
});

describe("atendimento pastoral", () => {
  let reqId = "";
  test("solicitação é separada do registro; só a equipe pastoral vê a lista; o autor vê o próprio status", async () => {
    reqId = (await rpc(membro, "pastoral_request_create", { p_org: org, p: { topic: "counsel", body: SECRET } })).data.id;
    const inbox = (await rpc(pastor, "pastoral_inbox", { p_org: org })).data;
    expect(inbox.items.some((i: any) => i.id === reqId)).toBe(true);
    expect(msg(await rpc(outro, "pastoral_request_get", { p_id: reqId }))).toBe("forbidden");
    expect(msg(await rpc(intercessor, "pastoral_request_get", { p_id: reqId }))).toBe("forbidden");
    expect(((await rpc(membro, "pastoral_my_requests", { p_org: org })).data as any[])[0].status).toBe("requested");
    expect(msg(await rpc(membro, "pastoral_request_create", { p_org: org, p: { topic: "zzz" } }))).toBe("care_invalid_topic");
  });
  test("agendar exige responsável autorizado e data; encaminhar exige motivo", async () => {
    expect(msg(await rpc(pastor, "pastoral_request_update", { p_id: reqId, p: { status: "scheduled" } }))).toBe("care_schedule_required");
    expect(msg(await rpc(pastor, "pastoral_request_update", { p_id: reqId, p: { status: "scheduled", responsible: membro.id, scheduled_at: new Date(Date.now() + 864e5).toISOString() } }))).toBe("care_invalid_assignee");
    expect((await rpc(pastor, "pastoral_request_update", { p_id: reqId, p: { status: "scheduled", responsible: pastor.id, scheduled_at: new Date(Date.now() + 864e5).toISOString() } })).data.ok).toBe(true);
    const mine = ((await rpc(membro, "pastoral_my_requests", { p_org: org })).data as any[])[0];
    expect(mine.status).toBe("scheduled"); expect(mine.scheduled_at).toBeTruthy();
    expect(msg(await rpc(pastor, "pastoral_request_update", { p_id: reqId, p: { status: "referred" } }))).toBe("care_referral_required");
    const notes = await rows(`notifications?user_id=eq.${membro.id}&kind=eq.care_pastoral_update&select=title,body`);
    expect(JSON.stringify(notes)).not.toContain(SECRET);
  });
  test("registro realizado: observação restrita só o autor lê; outro da equipe vê que existe, mas não o texto", async () => {
    const p2 = await newUser("Pastor2"); await joinChurch(admin.api, org, p2);
    await admin.api.rpc("grant_set", { p_org: org, p_user: p2.id, p_role: "secretary", p_network: null, p_title: "Pastoral 2", p_actions: ["care_pastoral"] });
    const s = (await rpc(pastor, "pastoral_session_save", { p_org: org, p_id: null, p: { request_id: reqId, held_at: new Date(Date.now() - 36e5).toISOString(), summary: "Conversa realizada", restricted_note: "NOTA-RESTRITA" } })).data;
    expect(s.ok).toBe(true);
    const mineList = (await rpc(pastor, "pastoral_session_list", { p_org: org })).data as any[];
    expect(mineList.find((x) => x.id === s.id).restricted_note).toBe("NOTA-RESTRITA");
    const other = (await rpc(p2, "pastoral_session_list", { p_org: org })).data as any[];
    expect(other.find((x) => x.id === s.id).has_restricted).toBe(true);
    expect(JSON.stringify(other)).not.toContain("NOTA-RESTRITA");
    expect(msg(await rpc(p2, "pastoral_session_save", { p_org: org, p_id: s.id, p: { held_at: new Date().toISOString() } }))).toBe("forbidden");
    // a solicitação passou a "realizada"
    expect(((await rpc(membro, "pastoral_my_requests", { p_org: org })).data as any[])[0].status).toBe("done");
    expect(msg(await rpc(pastor, "pastoral_session_save", { p_org: org, p_id: null, p: { held_at: new Date(Date.now() + 864e6).toISOString() } }))).toBe("care_future_date");
  });
  test("o autor pode cancelar uma solicitação aberta, não uma realizada", async () => {
    const id = (await rpc(outro, "pastoral_request_create", { p_org: org, p: { topic: "visit" } })).data.id;
    expect((await rpc(outro, "pastoral_my_cancel", { p_id: id })).data.ok).toBe(true);
    expect(msg(await rpc(outro, "pastoral_my_cancel", { p_id: id }))).toBe("care_not_open");
    expect(msg(await rpc(membro, "pastoral_my_cancel", { p_id: reqId }))).toBe("care_not_open");
  });
});

describe("grupos de intercessão, relatório, auditoria e confidencialidade", () => {
  test("só membros da igreja entram em grupo; gestão lista candidatos e autorizados", async () => {
    expect(msg(await rpc(gestor, "care_group_member_set", { p_group: grp, p_user: fora.id, p_in: true }))).toBe("care_invalid_member");
    const l = (await rpc(gestor, "care_group_list", { p_org: org })).data;
    expect(l.groups[0].members.length).toBeGreaterThan(0);
    expect(l.authorized.length).toBeGreaterThan(0);
    expect(msg(await rpc(gestor, "care_group_save", { p_org: org, p_id: null, p: { name: "intercessores" } }))).toBe("name_taken");
  });
  test("menu mostra Pedidos do grupo só para quem participa", async () => {
    expect((await rpc(gmember, "my_menu", { p_org: org })).data.intercession).toBe(true);
    expect((await rpc(membro, "my_menu", { p_org: org })).data.intercession).not.toBe(true);
  });
  test("relatório só tem contagens (sem texto dos pedidos)", async () => {
    const r = (await rpc(gestor, "care_report", { p_org: org })).data;
    expect(r.prayer.total).toBeGreaterThan(3);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
  test("acessos de leitura ficam registrados; auditoria geral não contém o texto", async () => {
    const log = (await rpc(gestor, "care_access_log", { p_org: org })).data as any[];
    expect(log.some((l) => l.action === "list" && l.entity === "prayer")).toBe(true);
    expect(log.some((l) => l.action === "read")).toBe(true);
    const audit = await rows(`mod_audit?org_id=eq.${org}&module=eq.care&select=*`);
    expect(audit.length).toBeGreaterThan(5);
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain("NOTA-RESTRITA");
  });
  test("nenhuma outra função (segmentação, relatórios, busca) lê as tabelas de cuidado", async () => {
    const r = await rows(`prayer_requests?org_id=eq.${org}&select=id`);
    expect(r.length).toBeGreaterThan(3); // o serviço enxerga; o app não (testado acima)
    const { execSync } = await import("node:child_process");
    const out = execSync(`psql -h 127.0.0.1 -p 54322 -U postgres -Atc "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname !~ '^(care_|prayer_|pastoral_)' and prosrc ~* '(prayer_requests|prayer_events|pastoral_requests|pastoral_sessions)'"`).toString().trim();
    expect(out).toBe("");
  });
});
