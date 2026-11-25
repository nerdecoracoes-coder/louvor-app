// Fase 2 — Eventos: gestão, inscrição, lista de espera, ingresso, check-in, cancelamento e permissões.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST } from "./helpers";

let admin: any, gestor: any, publicador: any, porteiro: any, visualiza: any, lider: any, dev: any, ana: any, bia: any, caio: any, vis: any, fora: any;
let org = "", team = "";
const sk = async () => { const k = await serviceKey(); return { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/json", Prefer: "return=representation" }; };
const rows = async (q: string) => (await (await fetch(`${REST}/${q}`, { headers: await sk() })).json()) as any[];
const msg = (r: any) => String(r.data?.message ?? "");
const iso = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
const rpc = (u: any, fn: string, a: any) => u.api.rpc(fn, a);
const save = (u: any, p: any, id: string | null = null) => rpc(u, "event_save", { p_org: org, p_id: id, p });
const status = (u: any, id: string, action: string, reason: string | null = null) => rpc(u, "event_set_status", { p_id: id, p_action: action, p_reason: reason });
const mk = async (p: any = {}, publish = true) => { const id = (await save(gestor, { title: "Evento", starts_at: iso(10), registration: "open", ...p })).data.id; if (publish) await status(publicador, id, "publish"); return id as string; };
const mine = async (u: any) => (await rpc(u, "events_for_me", { p_org: org })).data as any[];
const reg = (u: any, id: string, g = 0) => rpc(u, "event_register", { p_event: id, p_guests: g });
const notifs = async (u: any, kind: string) => (await rows(`notifications?user_id=eq.${u.id}&kind=eq.${kind}&select=title`)).length;

beforeAll(async () => {
  [admin, gestor, publicador, porteiro, visualiza, lider, dev, ana, bia, caio, vis, fora] = await Promise.all(["Adm", "Gestor", "Publ", "Porteiro", "Visual", "Lider", "Dev", "Ana", "Bia", "Caio", "Vis", "Fora"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Eventos" })).data;
  await joinChurch(admin.api, org, gestor, publicador, porteiro, visualiza, lider, dev, ana, bia, caio, vis);
  const grant = (u: any, t: string, a: string[]) => admin.api.rpc("grant_set", { p_org: org, p_user: u.id, p_role: "secretary", p_network: null, p_title: t, p_actions: a });
  await grant(gestor, "Gestor", ["ev_manage"]); await grant(publicador, "Publicador", ["ev_publish"]); await grant(porteiro, "Porteiro", ["ev_checkin"]); await grant(visualiza, "Visual", ["ev_view"]);
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor Ev", team_type: "louvor" })).data[0].id;
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await fetch(`${REST}/team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_leader: true }) });
  await fetch(`${REST}/profiles?id=eq.${dev.id}`, { method: "PATCH", headers: await sk(), body: JSON.stringify({ is_developer: true }) });
  for (const [u, c] of [[ana, "member"], [bia, "member"], [caio, "attender"], [vis, "visitor"]] as any) await admin.api.rpc("people_link_users", { p_org: org, p_user_ids: [u.id], p_classification: c });
});

describe("permissões", () => {
  test("liderança de time, desenvolvedor e membro comum não têm acesso à gestão", async () => {
    for (const u of [lider, dev, ana, fora]) {
      expect(msg(await rpc(u, "event_list", { p_org: org }))).toMatch(/forbidden/);
      expect(msg(await save(u, { title: "X", starts_at: iso(1) }))).toMatch(/forbidden/);
    }
  });
  test("cada permissão faz só o seu papel", async () => {
    expect(msg(await save(publicador, { title: "X", starts_at: iso(1) }))).toBe("forbidden");
    const id = await mk({}, false);
    expect(msg(await status(gestor, id, "publish"))).toBe("forbidden");
    expect((await status(publicador, id, "publish")).data.ok).toBe(true);
    expect(msg(await rpc(porteiro, "event_save", { p_org: org, p_id: id, p: { title: "Y", starts_at: iso(2) } }))).toBe("forbidden");
    expect((await rpc(visualiza, "event_get", { p_id: id })).data.event.id).toBe(id);
    expect(msg(await rpc(visualiza, "event_checkin", { p_event: id, p_code: "X" }))).toBe("forbidden");
    expect((await rpc(admin, "event_list", { p_org: org })).data.events.length).toBeGreaterThan(0);
  });
  test("tabelas fechadas para leitura e escrita diretas", async () => {
    expect((await ana.api.get(`/ev_events?org_id=eq.${org}`)).ok).toBe(false);
    expect((await ana.api.get(`/ev_registrations?org_id=eq.${org}`)).ok).toBe(false);
  });
});

describe("cadastro do evento", () => {
  test("validações", async () => {
    expect(msg(await save(gestor, { title: "", starts_at: iso(1) }))).toBe("title_required");
    expect(msg(await save(gestor, { title: "X" }))).toBe("date_required");
    expect(msg(await save(gestor, { title: "X", starts_at: iso(2), ends_at: iso(1) }))).toBe("invalid_period");
    expect(msg(await save(gestor, { title: "X", starts_at: iso(2), audience: "todos" }))).toBe("invalid_audience");
    expect(msg(await save(gestor, { title: "X", starts_at: iso(2), capacity: 0 }))).toBe("invalid_data");
    expect(msg(await save(gestor, { title: "X", starts_at: iso(2), max_guests: 99 }))).toBe("invalid_data");
  });
  test("rascunho não aparece para o público; publicado aparece; voltar a rascunho só sem inscritos", async () => {
    const id = await mk({ title: "Rascunho" }, false);
    expect((await mine(ana)).some((e) => e.id === id)).toBe(false);
    await status(publicador, id, "publish");
    expect((await mine(ana)).some((e) => e.id === id)).toBe(true);
    await reg(ana, id);
    expect(msg(await status(publicador, id, "draft"))).toBe("invalid_status");
  });
  test("público do evento: só quem pertence à classificação enxerga", async () => {
    const id = await mk({ title: "Só membros", audience: "member" });
    expect((await mine(ana)).some((e) => e.id === id)).toBe(true);
    expect((await mine(vis)).some((e) => e.id === id)).toBe(false);
    expect(msg(await reg(vis, id))).toBe("not_found");
  });
});

describe("inscrição, vagas e lista de espera", () => {
  let ev = "", ra: any, rb: any, rc: any;
  test("inscrição confirma, gera ingresso e avisa; não duplica", async () => {
    ev = await mk({ title: "Retiro", capacity: 3, max_guests: 2 });
    ra = (await reg(ana, ev, 1)).data; expect(ra.status).toBe("confirmed"); expect(ra.code).toHaveLength(10);
    expect(msg(await reg(ana, ev))).toBe("already_registered");
    expect(await notifs(ana, "event_registered")).toBeGreaterThan(0);
    expect(msg(await reg(bia, ev, 3))).toBe("invalid_guests");
  });
  test("capacidade conta acompanhantes; excedente vai para a espera, na ordem", async () => {
    rb = (await reg(bia, ev, 0)).data; expect(rb.status).toBe("confirmed");       // 2 + 1 = 3 vagas
    rc = (await reg(caio, ev, 0)).data; expect(rc.status).toBe("waitlist");
    const m = (await mine(caio)).find((e) => e.id === ev); expect(m.state).toBe("full"); expect(m.spots).toBe(0);
    const t = (await rpc(caio, "event_my_tickets", { p_org: org })).data.find((x: any) => x.event_id === ev); expect(t.position).toBe(1);
  });
  test("cancelar libera a vaga: o primeiro da espera é promovido e avisado", async () => {
    expect(msg(await rpc(bia, "event_unregister", { p_reg: ra.id }))).toBe("forbidden");   // ninguém cancela a inscrição de outra pessoa
    expect((await rpc(ana, "event_unregister", { p_reg: ra.id })).data.ok).toBe(true);
    const m = (await mine(caio)).find((e) => e.id === ev); expect(m.mine.status).toBe("confirmed");
    expect(await notifs(caio, "event_promoted")).toBe(1);
    expect(msg(await rpc(ana, "event_unregister", { p_reg: ra.id }))).toBe("already_cancelled");
    expect((await reg(ana, ev, 0)).data.status).toBe("confirmed");    // pode se inscrever de novo (1 vaga livre)
  });
  test("janelas de inscrição e inscrições fechadas", async () => {
    const futuro = await mk({ title: "Em breve", reg_opens_at: iso(2) });
    const vencida = await mk({ title: "Vencida", reg_closes_at: iso(-1), reg_opens_at: iso(-2) });
    const so = await mk({ title: "Só divulgação", registration: "none" });
    const fechado = await mk({ title: "Fechado", registration: "closed" });
    expect(msg(await reg(ana, futuro))).toBe("registration_not_yet");
    expect(msg(await reg(ana, vencida))).toBe("registration_closed");
    expect(msg(await reg(ana, so))).toBe("registration_none");
    expect(msg(await reg(ana, fechado))).toBe("registration_closed");
    const ended = await mk({ title: "Já passou", starts_at: iso(-3), ends_at: iso(-2) });
    expect(msg(await reg(ana, ended))).toBe("registration_ended");
  });
  test("reduzir a capacidade abaixo do que já foi confirmado é recusado; aumentar promove a espera", async () => {
    expect(msg(await save(gestor, { title: "Retiro", starts_at: iso(10), registration: "open", capacity: 1, max_guests: 2 }, ev))).toBe("capacity_below_registered");
    const id = await mk({ title: "Pequeno", capacity: 1 });
    await reg(ana, id); const w = (await reg(bia, id)).data; expect(w.status).toBe("waitlist");
    await save(gestor, { title: "Pequeno", starts_at: iso(10), registration: "open", capacity: 2 }, id);
    expect((await mine(bia)).find((e) => e.id === id).mine.status).toBe("confirmed");
  });
  test("inscrição feita pela equipe: respeita a capacidade, a menos que force", async () => {
    const id = await mk({ title: "Lotado", capacity: 1 });
    await reg(ana, id);
    const a = (await rpc(gestor, "event_register_admin", { p_event: id, p_person: null, p_name: "Dona Maria", p_guests: 0, p_force: false })).data; expect(a.status).toBe("waitlist");
    const b = (await rpc(gestor, "event_register_admin", { p_event: id, p_person: null, p_name: "Seu José", p_guests: 0, p_force: true })).data; expect(b.status).toBe("confirmed");
    expect(msg(await rpc(porteiro, "event_register_admin", { p_event: id, p_person: null, p_name: "X", p_guests: 0, p_force: false }))).toBe("forbidden");
    expect(msg(await rpc(gestor, "event_register_admin", { p_event: id, p_person: null, p_name: "", p_guests: 0, p_force: false }))).toBe("name_required");
  });
});

describe("check-in", () => {
  let ev = "", ra: any, rb: any;
  test("por código do ingresso (com ou sem o prefixo do QR) e pela lista", async () => {
    ev = await mk({ title: "Culto especial", capacity: 10, max_guests: 3 });
    ra = (await reg(ana, ev, 2)).data; rb = (await reg(bia, ev)).data;
    const r1 = (await rpc(porteiro, "event_checkin", { p_event: ev, p_code: "EV-" + ra.code.toLowerCase(), p_count: 2 })).data;
    expect(r1).toMatchObject({ result: "ok", name: expect.any(String), count: 2 });
    expect((await rpc(porteiro, "event_checkin", { p_event: ev, p_code: ra.code })).data.result).toBe("already");
    const regs = (await rpc(admin, "event_get", { p_id: ev })).data.regs; const idB = regs.find((g: any) => g.status === "confirmed" && !g.checked_in_at).id;
    expect((await rpc(porteiro, "event_checkin", { p_event: ev, p_code: null, p_reg: idB })).data.result).toBe("ok");
    const c = (await rpc(admin, "event_get", { p_id: ev })).data.counts; expect(c.present).toBe(3); expect(c.checked).toBe(2);
  });
  test("recusa: código inexistente, de outro evento, na espera, cancelada e de evento cancelado", async () => {
    expect((await rpc(porteiro, "event_checkin", { p_event: ev, p_code: "ZZZZZZZZZZ" })).data.result).toBe("not_found");
    const other = await mk({ title: "Outro" }); const ro = (await reg(caio, other)).data;
    expect((await rpc(porteiro, "event_checkin", { p_event: ev, p_code: ro.code })).data.result).toBe("other_event");
    const cheio = await mk({ title: "Cheio", capacity: 1 }); await reg(ana, cheio); const w = (await reg(bia, cheio)).data;
    expect((await rpc(porteiro, "event_checkin", { p_event: cheio, p_code: w.code })).data.result).toBe("waitlist");
    const rcn = (await reg(vis, other)).data; await rpc(vis, "event_unregister", { p_reg: rcn.id });
    expect((await rpc(porteiro, "event_checkin", { p_event: other, p_code: rcn.code })).data.result).toBe("cancelled");
    await status(publicador, other, "cancel", "Chuva forte");
    expect((await rpc(porteiro, "event_checkin", { p_event: other, p_code: ro.code })).data.result).toBe("event_cancelled");
  });
  test("desfazer exige motivo; quem já entrou não cancela a inscrição", async () => {
    expect(msg(await rpc(porteiro, "event_checkin_undo", { p_reg: rb.id, p_reason: "" }))).toBe("reason_required");
    expect(msg(await rpc(ana, "event_unregister", { p_reg: ra.id }))).toBe("already_checked_in");
    expect((await rpc(porteiro, "event_checkin_undo", { p_reg: ra.id, p_reason: "Entrada marcada por engano" })).data.ok).toBe(true);
    expect((await rpc(admin, "event_get", { p_id: ev })).data.counts.present).toBe(1);
    expect(msg(await rpc(ana, "event_checkin_undo", { p_reg: ra.id, p_reason: "x" }))).toBe("forbidden");
  });
});

describe("cancelar e encerrar evento", () => {
  test("cancelamento exige motivo, avisa os inscritos e some da lista de quem não se inscreveu", async () => {
    const id = await mk({ title: "Vai cancelar" }); await reg(ana, id); await reg(bia, id);
    expect(msg(await status(publicador, id, "cancel", ""))).toBe("reason_required");
    expect((await status(publicador, id, "cancel", "Local indisponível")).data.ok).toBe(true);
    expect(await notifs(ana, "event_cancelled")).toBeGreaterThan(0);
    expect((await mine(ana)).find((e) => e.id === id).cancel_reason).toBe("Local indisponível");
    expect((await mine(caio)).some((e) => e.id === id)).toBe(false);
    expect(msg(await save(gestor, { title: "Y", starts_at: iso(3) }, id))).toBe("event_closed");
    expect(msg(await reg(caio, id))).toBe("not_found");
  });
  test("encerrar só depois do início; nada é apagado e a auditoria registra", async () => {
    const id = await mk({ title: "Futuro" });
    expect(msg(await status(publicador, id, "finish"))).toBe("invalid_status");
    const passado = await mk({ title: "Começou", starts_at: iso(-0.1), ends_at: iso(1) });
    expect((await status(publicador, passado, "finish")).data.ok).toBe(true);
    const aud = (await rows(`mod_audit?org_id=eq.${org}&module=eq.events&select=action`)).map((a) => a.action);
    expect(aud).toEqual(expect.arrayContaining(["create", "update", "publish", "cancel", "finish", "checkin", "checkin_undo", "unregister"]));
    expect((await rows(`ev_events?org_id=eq.${org}&status=eq.cancelled&select=id`)).length).toBeGreaterThan(0);
  });
});

describe("menu e cards", () => {
  test("Eventos e Meus ingressos no menu conforme a situação; card leva a #/eventos", async () => {
    const m = (u: any) => rpc(u, "my_menu", { p_org: org }).then((r: any) => r.data);
    expect((await m(ana)).events).toBe(true);
    expect((await m(ana)).tickets).toBe(true);
    expect((await m(lider)).tickets).toBe(false);
    const cards = (await rpc(lider, "home_discover", { p_org: org })).data.cards;
    const c = cards.find((x: any) => x.key === "events"); expect(c.route).toBe("#/eventos");
  });
});
