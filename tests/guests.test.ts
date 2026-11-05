// Times abertos a convidados: pessoas de outras igrejas participam só do time para o qual foram convidadas.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch, serviceKey, REST, Api } from "./helpers";

let admin: any, lider: any, membro: any, conv: any, conv2: any, fora: any;
let org = "", chega = "", louvor = "", tokOpen = "", song = "";

beforeAll(async () => {
  [admin, lider, membro, conv, conv2, fora] = await Promise.all(["Admin G", "Lider Chega", "Membro G", "Convidado Filial", "Convidado 2", "Fora G"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja G" })).data;
  chega = (await admin.api.post("teams", { org_id: org, name: "Chega Mais", team_type: "louvor", category: "open" })).data[0].id;
  louvor = (await admin.api.post("teams", { org_id: org, name: "INVT music", team_type: "louvor", category: "ministry" })).data[0].id;
  await joinChurch(admin.api, org, lider, membro);
  await admin.api.rpc("add_team_members", { p_team: chega, p_users: [lider.id, membro.id] });
  await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [membro.id] });
  await admin.api.patch(`team_members?team_id=eq.${chega}&user_id=eq.${lider.id}`, { is_leader: true });
  song = (await admin.api.post("songs", { org_id: org, title: "Emaús" })).data[0].id;
  await admin.api.post("announcements", { org_id: org, title: "Aviso interno da igreja", created_by: admin.id });
  tokOpen = (await lider.api.rpc("create_team_invite", { p_team: chega })).data;
});

describe("convidados", () => {
  test("líder do time aberto convida; pessoa de fora entra como convidada, com a igreja de origem", async () => {
    const prev = (await conv.api.rpc("get_invite", { p_token: tokOpen })).data;
    expect(prev.team.category).toBe("open"); expect(prev.is_church_member).toBe(false);
    const r = await conv.api.rpc("accept_invite", { p_token: tokOpen, p_church: "Nova Vida Niterói" });
    expect(r.data.status).toBe("joined");
    const tm = (await lider.api.get(`/team_members?team_id=eq.${chega}&user_id=eq.${conv.id}`)).data[0];
    expect(tm).toMatchObject({ is_guest: true, guest_church: "Nova Vida Niterói", is_leader: false });
    expect((await admin.api.get(`/org_members?org_id=eq.${org}&user_id=eq.${conv.id}`)).data[0].role).toBe("guest");
  });

  test("membro da igreja que entra pelo link do time aberto não vira convidado", async () => {
    const outro = await newUser("Membro Novo");
    await joinChurch(admin.api, org, outro);
    await outro.api.rpc("accept_invite", { p_token: tokOpen });
    expect((await admin.api.get(`/team_members?team_id=eq.${chega}&user_id=eq.${outro.id}`)).data[0].is_guest).toBe(false);
  });

  test("convidado vê só o seu time: escalas, chat e repertório", async () => {
    expect((await conv.api.get(`/teams?org_id=eq.${org}`)).data.map((t: any) => t.name)).toEqual(["Chega Mais"]);
    expect((await conv.api.get(`/organizations?id=eq.${org}`)).data).toHaveLength(1);
    expect((await conv.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(1);       // Chega Mais é de Louvor
    expect((await conv.api.get(`/team_members?team_id=eq.${louvor}`)).data).toHaveLength(0);
    expect((await conv.api.get(`/announcements?org_id=eq.${org}`)).data).toHaveLength(0); // avisos internos da igreja não
    expect((await conv.api.post("messages", { org_id: org, team_id: chega, user_id: conv.id, body: "Olá, Chega Mais!" })).status).toBe(201);
    expect((await conv.api.post("messages", { org_id: org, team_id: louvor, user_id: conv.id, body: "x" })).ok).toBe(false);
    const when = new Date(Date.now() + 2 * 864e5).toISOString();
    const s1 = (await lider.api.post("schedules", { org_id: org, team_id: chega, title: "Culto Jovem", starts_at: when, status: "published" })).data[0].id;
    await lider.api.post("schedule_assignments", { schedule_id: s1, org_id: org, team_id: chega, user_id: conv.id, role_name: "Guitarra" });
    await admin.api.post("schedules", { org_id: org, team_id: louvor, title: "Culto Domingo", starts_at: when, status: "published" });
    expect((await conv.api.get(`/schedules?org_id=eq.${org}`)).data.map((x: any) => x.title)).toEqual(["Culto Jovem"]);
    expect((await conv.api.get(`/schedule_assignments?user_id=eq.${conv.id}`)).data).toHaveLength(1);
  });

  test("convidado vê só as pessoas do seu time; membros veem o convidado", async () => {
    const om = (await conv.api.get(`/org_members?org_id=eq.${org}`)).data.map((m: any) => m.user_id).sort();
    expect(om).toContain(lider.id); expect(om).not.toContain(admin.id);
    expect((await conv.api.get(`/profiles?id=eq.${admin.id}`)).data).toHaveLength(0);
    expect((await conv.api.get(`/profiles?id=eq.${lider.id}`)).data).toHaveLength(1);
    expect((await membro.api.get(`/profiles?id=eq.${conv.id}`)).data).toHaveLength(1);
  });

  test("convidado não entra em time de ministério por inclusão nem por cópia (só pelo convite do time)", async () => {
    expect((await admin.api.rpc("add_team_members", { p_team: louvor, p_users: [conv.id] })).data).toBe(0);
    const c = await admin.api.rpc("copy_team_member", { p_from: chega, p_to: louvor, p_user: conv.id, p_move: false });
    expect(JSON.stringify(c.data)).toContain("not_church_member");
    expect((await admin.api.rpc("set_org_admin", { p_org: org, p_user: conv.id, p_admin: true })).ok).toBe(false);
  });

  test("quem ainda não é membro e aceita o convite de um ministério entra no time e vira membro da igreja", async () => {
    const tokMin = (await admin.api.rpc("create_team_invite", { p_team: louvor })).data;
    const r = await fora.api.rpc("accept_invite", { p_token: tokMin });
    expect(r.data.status).toBe("joined");
    expect((await admin.api.get(`/org_members?org_id=eq.${org}&user_id=eq.${fora.id}`)).data[0].role).toBe("member");
    expect((await admin.api.get(`/team_members?team_id=eq.${louvor}&user_id=eq.${fora.id}`)).data[0].is_guest).toBe(false);
  });

  test("convidado de um time aberto que aceita o convite de um ministério passa a membro", async () => {
    const g = await newUser("Convidado Vira Membro");
    await g.api.rpc("accept_invite", { p_token: tokOpen, p_church: "Filial Y" });
    expect((await admin.api.get(`/org_members?org_id=eq.${org}&user_id=eq.${g.id}`)).data[0].role).toBe("guest");
    const tokMin = (await admin.api.rpc("create_team_invite", { p_team: louvor })).data;
    expect((await g.api.rpc("accept_invite", { p_token: tokMin })).data.status).toBe("joined");
    expect((await admin.api.get(`/org_members?org_id=eq.${org}&user_id=eq.${g.id}`)).data[0].role).toBe("member");
    expect((await admin.api.get(`/team_members?team_id=eq.${chega}&user_id=eq.${g.id}`)).data[0].is_guest).toBe(false);
  });

  test("time com convidados não pode virar ministério", async () => {
    const r = await admin.api.patch(`teams?id=eq.${chega}`, { category: "ministry" });
    expect(JSON.stringify(r.data)).toContain("team_has_guests");
  });

  test("acesso com data de término: vencido, o convidado deixa de ver o time", async () => {
    await conv2.api.rpc("accept_invite", { p_token: tokOpen, p_church: "Filial X" });
    expect((await conv2.api.get(`/teams?org_id=eq.${org}`)).data).toHaveLength(1);
    await lider.api.patch(`team_members?team_id=eq.${chega}&user_id=eq.${conv2.id}`, { access_until: "2020-01-01" });
    expect((await conv2.api.get(`/teams?org_id=eq.${org}`)).data).toHaveLength(0);
    expect((await conv2.api.get(`/songs?org_id=eq.${org}`)).data).toHaveLength(0);
    expect((await conv2.api.post("messages", { org_id: org, team_id: chega, user_id: conv2.id, body: "x" })).ok).toBe(false);
  });

  test("convidado que vira membro pelo convite da igreja deixa de ser convidado", async () => {
    await joinChurch(admin.api, org, conv);
    expect((await admin.api.get(`/org_members?org_id=eq.${org}&user_id=eq.${conv.id}`)).data[0].role).toBe("member");
    expect((await admin.api.get(`/team_members?team_id=eq.${chega}&user_id=eq.${conv.id}`)).data[0].is_guest).toBe(false);
  });

  test("convidado removido do último time perde o vínculo com a igreja", async () => {
    await lider.api.del(`team_members?team_id=eq.${chega}&user_id=eq.${conv2.id}`);
    const db = new Api(await serviceKey());
    expect((await db.get(`/org_members?org_id=eq.${org}&user_id=eq.${conv2.id}`)).data).toHaveLength(0);
    void REST;
  });
});
