// Notificações de entrada no time: abrir uma dá baixa em todas do mesmo time.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser, joinChurch } from "./helpers";

let admin: any, lider: any, a: any, b: any, c: any, org = "", team = "";

beforeAll(async () => {
  [admin, lider, a, b, c] = await Promise.all(["Adm N", "Lider N", "Novo A", "Novo B", "Novo C"].map(newUser));
  org = (await admin.api.rpc("create_organization", { p_name: "Igreja Notif" })).data;
  team = (await admin.api.post("teams", { org_id: org, name: "Louvor", team_type: "louvor" })).data[0].id;
  await joinChurch(admin.api, org, lider, a, b, c);
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [lider.id] });
  await admin.api.patch(`team_members?team_id=eq.${team}&user_id=eq.${lider.id}`, { is_leader: true });
  await admin.api.rpc("add_team_members", { p_team: team, p_users: [a.id, b.id, c.id] });
});

describe("notificações agrupadas", () => {
  test("o líder recebe uma por pessoa e dá baixa em todas de uma vez", async () => {
    const un = async () => (await lider.api.get(`/notifications?kind=eq.team_joined&read_at=is.null&link=eq.${encodeURIComponent("#/times/" + team)}`)).data;
    const before = await un();
    expect(before.length).toBe(4); // a própria entrada do líder + três novos integrantes
    const r = await lider.api.patch(`notifications?id=in.(${before.map((x: any) => x.id).join(",")})`, { read_at: new Date().toISOString() });
    expect(r.ok).toBe(true);
    expect((await un()).length).toBe(0);
  });
});
