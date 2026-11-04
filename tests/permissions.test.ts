// Testes reais de usuários, organizações, times, convites, escalas, chat e isolamento (RLS).
// Requer: dev/stack.sh start
import { describe, expect, test, beforeAll } from "bun:test";
import { Api, newUser, anonKey, joinChurch } from "./helpers";

type U = Awaited<ReturnType<typeof newUser>>;
let ana: U, bruno: U, carla: U, davi: U, eva: U;
let orgA = "", orgB = "", louvor = "", jovens = "", vozes = "";

beforeAll(async () => {
  [ana, bruno, carla, davi, eva] = await Promise.all(["Ana Admin", "Bruno Líder", "Carla Vocal", "Davi Bateria", "Eva Outra"].map(newUser));
});

describe("contas e organizações", () => {
  test("cadastro cria perfil, mas não vincula a nenhuma organização", async () => {
    const p = await ana.api.get(`/profiles?id=eq.${ana.id}`);
    expect(p.data[0].full_name).toBe("Ana Admin");
    const orgs = await ana.api.get("/org_members?user_id=eq." + ana.id);
    expect(orgs.data).toHaveLength(0);
  });

  test("criar organização torna o criador administrador geral, com funções padrão", async () => {
    const r = await ana.api.rpc("create_organization", { p_name: "INVT Tijuca", p_accent: "#1EA7FF" });
    expect(r.status).toBe(200); orgA = r.data;
    const m = await ana.api.get(`/org_members?org_id=eq.${orgA}`);
    expect(m.data).toEqual([expect.objectContaining({ user_id: ana.id, role: "admin" })]);
    const roles = await ana.api.get(`/music_roles?org_id=eq.${orgA}&select=name`);
    expect(roles.data.map((x: any) => x.name)).toContain("Bateria");
  });

  test("não é possível inserir organização ou vínculo diretamente (só pela função)", async () => {
    const r = await eva.api.post("organizations", { name: "Hack" });
    expect(r.ok).toBe(false);
    const r2 = await eva.api.post("org_members", { org_id: orgA, user_id: eva.id, role: "admin" });
    expect(r2.ok).toBe(false);
  });

  test("administrador cria vários times, sem limite", async () => {
    for (const name of ["Louvor Domingo", "Jovens", "Vozes"]) {
      const r = await ana.api.post("teams", { org_id: orgA, name, accent_color: "#7C5CFF" });
      expect(r.status).toBe(201);
    }
    const t = await ana.api.get(`/teams?org_id=eq.${orgA}&order=name`);
    [jovens, louvor, vozes] = t.data.map((x: any) => x.id);
    expect(t.data).toHaveLength(3);
  });
});

describe("convites", () => {
  let token = "";
  test("líder/admin gera link; prévia funciona sem login", async () => {
    const r = await ana.api.rpc("create_team_invite", { p_team: louvor });
    expect(r.status).toBe(200); token = r.data;
    const anon = new Api(await anonKey());
    const p = await anon.rpc("get_invite", { p_token: token });
    expect(p.data.valid).toBe(true);
    expect(p.data.team.name).toBe("Louvor Domingo");
    expect(p.data.org.name).toBe("INVT Tijuca");
  });

  test("quem não gerencia o time não gera convite", async () => {
    const r = await eva.api.rpc("create_team_invite", { p_team: louvor });
    expect(r.ok).toBe(false);
  });

  test("time de ministério: quem não é membro da igreja não entra pelo link", async () => {
    const r = await bruno.api.rpc("accept_invite", { p_token: token });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toContain("not_church_member");
  });

  test("aceitar convite entra no time como integrante comum (sem liderança nem admin)", async () => {
    await joinChurch(ana.api, orgA, bruno, carla, davi);
    for (const u of [bruno, carla, davi]) {
      const r = await u.api.rpc("accept_invite", { p_token: token });
      expect(r.data.status).toBe("joined");
    }
    const om = await ana.api.get(`/org_members?org_id=eq.${orgA}&user_id=eq.${bruno.id}`);
    expect(om.data[0].role).toBe("member");
    const tm = await ana.api.get(`/team_members?team_id=eq.${louvor}&user_id=eq.${bruno.id}`);
    expect(tm.data[0].is_leader).toBe(false);
  });

  test("aceitar de novo informa que já faz parte", async () => {
    const r = await carla.api.rpc("accept_invite", { p_token: token });
    expect(r.data.status).toBe("already_member");
  });

  test("quem criou o convite é notificado", async () => {
    const n = await ana.api.get(`/notifications?kind=eq.invite_accepted`);
    expect(n.data.length).toBeGreaterThanOrEqual(3);
  });

  test("convite revogado deixa de funcionar", async () => {
    const t2 = (await ana.api.rpc("create_team_invite", { p_team: jovens })).data;
    await ana.api.patch(`invites?token=eq.${t2}`, { revoked_at: new Date().toISOString() });
    const r = await eva.api.rpc("accept_invite", { p_token: t2 });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toContain("invite_expired");
  });
});

describe("líderes e permissões por time", () => {
  test("admin torna Bruno líder do Louvor Domingo", async () => {
    const r = await ana.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${bruno.id}`, { is_leader: true });
    expect(r.data[0].is_leader).toBe(true);
    const n = await bruno.api.get(`/notifications?kind=eq.leader`);
    expect(n.data).toHaveLength(1);
  });

  test("integrante comum não consegue se tornar líder", async () => {
    const r = await carla.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${carla.id}`, { is_leader: true });
    expect(r.data ?? []).toHaveLength(0);
    const tm = await ana.api.get(`/team_members?team_id=eq.${louvor}&user_id=eq.${carla.id}`);
    expect(tm.data[0].is_leader).toBe(false);
  });

  test("líder define funções musicais do integrante", async () => {
    const roles = (await bruno.api.get(`/music_roles?org_id=eq.${orgA}`)).data;
    const id = (n: string) => roles.find((r: any) => r.name === n).id;
    expect((await bruno.api.rpc("set_member_roles", { p_team: louvor, p_user: carla.id, p_roles: [id("Vocal feminino"), id("Soprano")] })).status).toBe(204);
    expect((await bruno.api.rpc("set_member_roles", { p_team: louvor, p_user: davi.id, p_roles: [id("Bateria")] })).status).toBe(204);
    expect((await bruno.api.rpc("set_member_roles", { p_team: louvor, p_user: bruno.id, p_roles: [id("Ministro"), id("Guitarra")] })).status).toBe(204);
    const r = await carla.api.get(`/team_member_roles?team_id=eq.${louvor}&user_id=eq.${carla.id}`);
    expect(r.data).toHaveLength(2);
  });

  test("líder de um time não administra outro time", async () => {
    const r = await bruno.api.patch(`teams?id=eq.${jovens}`, { name: "Invadido" });
    expect(r.data ?? []).toHaveLength(0);
    const inv = await bruno.api.rpc("create_team_invite", { p_team: jovens });
    expect(inv.ok).toBe(false);
    const add = await bruno.api.rpc("add_team_members", { p_team: jovens, p_users: [carla.id] });
    expect(add.ok).toBe(false);
  });

  test("líder não pode criar times nem mudar a organização", async () => {
    expect((await bruno.api.post("teams", { org_id: orgA, name: "Novo" })).ok).toBe(false);
    const r = await bruno.api.patch(`organizations?id=eq.${orgA}`, { name: "X" });
    expect(r.data ?? []).toHaveLength(0);
  });

  test("admin adiciona vários usuários já cadastrados a outro time de uma vez", async () => {
    const r = await ana.api.rpc("add_team_members", { p_team: jovens, p_users: [carla.id, davi.id, eva.id] });
    expect(r.data).toBe(2); // Eva não é da organização e é ignorada
  });

  test("copiar integrante para outro time leva as funções", async () => {
    const r = await ana.api.rpc("copy_team_member", { p_from: louvor, p_to: vozes, p_user: carla.id, p_move: false });
    expect(r.status).toBe(204);
    const roles = await ana.api.get(`/team_member_roles?team_id=eq.${vozes}&user_id=eq.${carla.id}`);
    expect(roles.data).toHaveLength(2);
  });

  test("admin concede administração geral a outra pessoa; não é possível ficar sem admin", async () => {
    expect((await bruno.api.rpc("set_org_admin", { p_org: orgA, p_user: bruno.id, p_admin: true })).ok).toBe(false);
    expect((await ana.api.rpc("set_org_admin", { p_org: orgA, p_user: davi.id, p_admin: true })).status).toBe(204);
    expect((await davi.api.patch(`organizations?id=eq.${orgA}`, { subtitle: "Ministério de Louvor" })).data).toHaveLength(1);
    await ana.api.rpc("set_org_admin", { p_org: orgA, p_user: davi.id, p_admin: false });
    const last = await ana.api.rpc("set_org_admin", { p_org: orgA, p_user: ana.id, p_admin: false });
    expect(JSON.stringify(last.data)).toContain("last_admin");
  });

  test("remover do time não apaga a conta", async () => {
    await ana.api.del(`team_members?team_id=eq.${vozes}&user_id=eq.${carla.id}`);
    const p = await carla.api.get(`/profiles?id=eq.${carla.id}`);
    expect(p.data).toHaveLength(1);
  });
});

describe("várias organizações e isolamento", () => {
  test("Carla cria sua própria organização e participa das duas com a mesma conta", async () => {
    orgB = (await carla.api.rpc("create_organization", { p_name: "Igreja Bairro", p_accent: "#FF6A3D" })).data;
    const mine = await carla.api.get(`/org_members?user_id=eq.${carla.id}&select=org_id,role`);
    expect(mine.data).toHaveLength(2);
    const roles = Object.fromEntries(mine.data.map((m: any) => [m.org_id, m.role]));
    expect(roles[orgA]).toBe("member");
    expect(roles[orgB]).toBe("admin");
  });

  test("admin da organização A não vê nem altera nada da organização B", async () => {
    expect((await ana.api.get(`/organizations?id=eq.${orgB}`)).data).toHaveLength(0);
    expect((await ana.api.get(`/teams?org_id=eq.${orgB}`)).data).toHaveLength(0);
    expect((await ana.api.get(`/music_roles?org_id=eq.${orgB}`)).data).toHaveLength(0);
    expect((await ana.api.patch(`organizations?id=eq.${orgB}`, { name: "X" })).data ?? []).toHaveLength(0);
    expect((await ana.api.post("teams", { org_id: orgB, name: "Intruso" })).ok).toBe(false);
  });

  test("Eva (sem organização) não vê nada de ninguém", async () => {
    for (const t of ["organizations", "teams", "team_members", "schedules", "songs", "messages", "announcements", "unavailability"]) {
      expect((await eva.api.get("/" + t)).data).toHaveLength(0);
    }
    expect((await eva.api.get(`/profiles?id=eq.${ana.id}`)).data).toHaveLength(0);
  });

  test("perfis só aparecem para quem divide organização", async () => {
    expect((await bruno.api.get(`/profiles?id=eq.${carla.id}`)).data).toHaveLength(1);
    expect((await bruno.api.get(`/profiles?id=eq.${eva.id}`)).data).toHaveLength(0);
  });
});

describe("escalas", () => {
  let sched = "", songId = "";
  const when = new Date(Date.now() + 7 * 864e5); when.setUTCHours(22, 0, 0, 0);

  test("líder cadastra música manual no repertório geral", async () => {
    const r = await bruno.api.post("songs", { org_id: orgA, title: "Emaús", artist: "Morada", song_key: "B", bpm: 140 });
    expect(r.status).toBe(201); songId = r.data[0].id;
    expect(r.data[0].source).toBe("manual");
    // integrante comum não cadastra
    expect((await carla.api.post("songs", { org_id: orgA, title: "X" })).ok).toBe(false);
    // ninguém finge ser música do Drive
    expect((await bruno.api.post("songs", { org_id: orgA, title: "Y", source: "drive", drive_folder_id: "abc" })).ok).toBe(false);
  });

  test("indisponibilidade é considerada pelos candidatos", async () => {
    const d = when.toISOString().slice(0, 10);
    expect((await davi.api.post("unavailability", { org_id: orgA, user_id: davi.id, start_date: d, end_date: d, note: "Viagem" })).status).toBe(201);
    // não dá para registrar indisponibilidade em nome de outra pessoa
    expect((await davi.api.post("unavailability", { org_id: orgA, user_id: carla.id, start_date: d, end_date: d })).ok).toBe(false);
    const c = await bruno.api.rpc("schedule_candidates", { p_team: louvor, p_starts: when.toISOString() });
    const daviRow = c.data.find((x: any) => x.user_id === davi.id);
    expect(daviRow.available).toBe(false);
    expect(daviRow.unavailable_note).toBe("Viagem");
    expect(c.data.find((x: any) => x.user_id === carla.id).available).toBe(true);
    expect((await carla.api.rpc("schedule_candidates", { p_team: louvor, p_starts: when.toISOString() })).ok).toBe(false);
  });

  test("criar rascunho, atribuir integrantes e selecionar músicas", async () => {
    const r = await bruno.api.post("schedules", { org_id: orgA, team_id: louvor, title: "Culto de Celebração", starts_at: when.toISOString(), location: "INVT Tijuca" });
    expect(r.status).toBe(201); sched = r.data[0].id;
    const roles = (await bruno.api.get(`/music_roles?org_id=eq.${orgA}`)).data;
    const id = (n: string) => roles.find((x: any) => x.name === n).id;
    const a = await bruno.api.post("schedule_assignments", [
      { schedule_id: sched, org_id: orgA, team_id: louvor, user_id: carla.id, role_id: id("Vocal feminino"), role_name: "Vocal feminino" },
      { schedule_id: sched, org_id: orgA, team_id: louvor, user_id: bruno.id, role_id: id("Guitarra"), role_name: "Guitarra" },
    ]);
    expect(a.status).toBe(201);
    // não dá para escalar quem não é do time
    const bad = await bruno.api.post("schedule_assignments", { schedule_id: sched, org_id: orgA, team_id: louvor, user_id: eva.id });
    expect(bad.ok).toBe(false);
    const s = await bruno.api.post("schedule_songs", { schedule_id: sched, org_id: orgA, team_id: louvor, song_id: songId, position: 0, title_snapshot: "" });
    expect(s.data[0].title_snapshot).toBe("Emaús");
  });

  test("rascunho fica invisível para integrantes; ninguém é notificado ainda", async () => {
    expect((await carla.api.get(`/schedules?id=eq.${sched}`)).data).toHaveLength(0);
    expect((await carla.api.get(`/notifications?kind=eq.schedule_published`)).data).toHaveLength(0);
  });

  test("publicar notifica os escalados e aparece no perfil do integrante", async () => {
    const r = await bruno.api.patch(`schedules?id=eq.${sched}`, { status: "published" });
    expect(r.data[0].published_at).toBeTruthy();
    const n = await carla.api.get(`/notifications?kind=eq.schedule_published`);
    expect(n.data).toHaveLength(1);
    const mine = await carla.api.get(`/schedule_assignments?user_id=eq.${carla.id}&select=*,schedules(title,starts_at,status)`);
    expect(mine.data[0].schedules.title).toBe("Culto de Celebração");
  });

  test("integrante confirma que visualizou", async () => {
    expect((await carla.api.rpc("mark_schedule_seen", { p_schedule: sched })).status).toBe(204);
    const a = await bruno.api.get(`/schedule_assignments?schedule_id=eq.${sched}&user_id=eq.${carla.id}`);
    expect(a.data[0].seen_at).toBeTruthy();
    // integrante não altera atribuições
    expect((await carla.api.patch(`schedule_assignments?schedule_id=eq.${sched}`, { role_name: "x" })).data ?? []).toHaveLength(0);
  });

  test("alterar horário notifica os escalados", async () => {
    const later = new Date(when.getTime() + 3600e3).toISOString();
    await bruno.api.patch(`schedules?id=eq.${sched}`, { starts_at: later });
    expect((await carla.api.get(`/notifications?kind=eq.schedule_changed`)).data).toHaveLength(1);
  });

  test("calendário geral: integrante de outro time da organização vê a escala publicada", async () => {
    // Davi está nos Jovens e no Louvor; Eva não é da org
    expect((await davi.api.get(`/schedules?org_id=eq.${orgA}`)).data.length).toBeGreaterThan(0);
    expect((await eva.api.get(`/schedules?id=eq.${sched}`)).data).toHaveLength(0);
  });

  test("candidatos contam escalas do mês (limite mensal)", async () => {
    await bruno.api.patch(`team_members?team_id=eq.${louvor}&user_id=eq.${carla.id}`, { monthly_limit: 1, avoid_with: [davi.id, carla.id, eva.id] });
    const tm = (await bruno.api.get(`/team_members?team_id=eq.${louvor}&user_id=eq.${carla.id}`)).data[0];
    expect(tm.avoid_with).toEqual([davi.id]); // remove a própria pessoa e quem não é da organização
    const c = await bruno.api.rpc("schedule_candidates", { p_team: louvor, p_starts: when.toISOString() });
    const row = c.data.find((x: any) => x.user_id === carla.id);
    expect(row.month_count).toBe(1);
    expect(row.monthly_limit).toBe(1);
  });

  test("histórico preservado quando a música sai do repertório", async () => {
    await bruno.api.del(`songs?id=eq.${songId}`);
    const s = await bruno.api.get(`/schedule_songs?schedule_id=eq.${sched}`);
    expect(s.data[0].song_id).toBeNull();
    expect(s.data[0].title_snapshot).toBe("Emaús");
  });
});

describe("chat, enquetes e avisos", () => {
  test("mensagens só para integrantes do time", async () => {
    expect((await carla.api.post("messages", { org_id: orgA, team_id: louvor, user_id: carla.id, body: "Bom dia!" })).status).toBe(201);
    expect((await bruno.api.get(`/messages?team_id=eq.${louvor}`)).data).toHaveLength(1);
    // Ana é admin mas não é do time: não lê o chat
    expect((await ana.api.get(`/messages?team_id=eq.${louvor}`)).data).toHaveLength(0);
    expect((await eva.api.post("messages", { org_id: orgA, team_id: louvor, user_id: eva.id, body: "oi" })).ok).toBe(false);
    // não dá para enviar como outra pessoa
    expect((await carla.api.post("messages", { org_id: orgA, team_id: louvor, user_id: bruno.id, body: "fake" })).ok).toBe(false);
  });

  test("notificação de chat é agrupada por time", async () => {
    await carla.api.post("messages", { org_id: orgA, team_id: louvor, user_id: carla.id, body: "Segunda mensagem" });
    const n = await bruno.api.get(`/notifications?kind=eq.message`);
    expect(n.data).toHaveLength(1);
    expect(n.data[0].body).toContain("Segunda mensagem");
    const ov = await bruno.api.rpc("chat_overview", { p_org: orgA });
    expect(ov.data.find((x: any) => x.team_id === louvor).unread).toBe(2);
  });

  test("enquete: criar, votar, resultado", async () => {
    const p = await bruno.api.post("polls", { org_id: orgA, team_id: louvor, question: "Ensaio sábado?", options: ["Sim", "Não"], created_by: bruno.id });
    const pid = p.data[0].id;
    await bruno.api.post("messages", { org_id: orgA, team_id: louvor, user_id: bruno.id, kind: "poll", poll_id: pid });
    expect((await carla.api.post("poll_votes", { poll_id: pid, user_id: carla.id, option_index: 0 })).status).toBe(201);
    expect((await davi.api.post("poll_votes", { poll_id: pid, user_id: davi.id, option_index: 5 })).ok).toBe(false);
    expect((await davi.api.post("poll_votes", { poll_id: pid, user_id: davi.id, option_index: 1 })).status).toBe(201);
    const v = await bruno.api.get(`/poll_votes?poll_id=eq.${pid}`);
    expect(v.data).toHaveLength(2);
    expect((await eva.api.get(`/poll_votes?poll_id=eq.${pid}`)).data).toHaveLength(0);
  });

  test("aviso da organização: só admin/líder publica, todos recebem", async () => {
    expect((await carla.api.post("announcements", { org_id: orgA, title: "X", created_by: carla.id })).ok).toBe(false);
    expect((await ana.api.post("announcements", { org_id: orgA, title: "Ensaio Geral", body: "Quinta 19:30", tag: "Reunião", created_by: ana.id })).status).toBe(201);
    expect((await davi.api.get(`/notifications?kind=eq.announcement`)).data).toHaveLength(1);
    expect((await eva.api.get(`/announcements`)).data).toHaveLength(0);
  });

  test("aviso do time só para o time (e admins)", async () => {
    await bruno.api.post("announcements", { org_id: orgA, team_id: louvor, title: "Trazer pedal", created_by: bruno.id });
    const ok = await carla.api.get(`/announcements?team_id=eq.${louvor}`);
    expect(ok.data).toHaveLength(1);
  });
});

describe("dados de sincronização protegidos", () => {
  test("membros não escrevem em projetos/faixas/integração", async () => {
    expect((await ana.api.post("multitrack_projects", { org_id: orgA })).ok).toBe(false);
    expect((await ana.api.post("drive_integrations", { org_id: orgA, folder_id: "x" })).ok).toBe(false);
    expect((await ana.api.post("project_media", { org_id: orgA })).ok).toBe(false);
  });
  test("notificações são privadas", async () => {
    const n = await bruno.api.get(`/notifications?user_id=eq.${carla.id}`);
    expect(n.data).toHaveLength(0);
  });
});

describe("Storage (políticas)", () => {
  test("checagem de caminhos", async () => {
    const chk = (u: U, bucket: string, path: string) => u.api.rpc("storage_can_write", { p_bucket: bucket, p_name: path }).then((r) => r.data);
    expect(await chk(carla, "private", `chat/${orgA}/${louvor}/a.jpg`)).toBe(true);
    expect(await chk(eva, "private", `chat/${orgA}/${louvor}/a.jpg`)).toBe(false);
    expect(await chk(carla, "private", `chat/${orgA}/${vozes}/a.jpg`)).toBe(false);
    expect(await chk(ana, "media", `orgs/${orgA}/logo.png`)).toBe(true);
    expect(await chk(ana, "media", `orgs/${orgB}/logo.png`)).toBe(false);
    expect(await chk(carla, "media", `avatars/${carla.id}/me.jpg`)).toBe(true);
    expect(await chk(carla, "media", `avatars/${ana.id}/me.jpg`)).toBe(false);
    expect(await chk(carla, "media", `../avatars/x`)).toBe(false);
  });
});
