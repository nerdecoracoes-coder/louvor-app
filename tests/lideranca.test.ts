// Lideranca da igreja: ordem hierarquica gravada por quem administra; quem nao e administrador nao consegue alterar.
import { describe, expect, test, beforeAll } from "bun:test";
import { newUser } from "./helpers";

let adm: any, org = "";
beforeAll(async () => {
  adm = await newUser("Admin Lideranca");
  org = (await adm.api.rpc("create_organization", { p_name: "Igreja Lideranca" })).data;
});

describe("lideranca em ordem", () => {
  test("o administrador define cargo e posicao e a leitura traz a ordem", async () => {
    const up = await adm.api.patch(`org_members?org_id=eq.${org}&user_id=eq.${adm.id}`, { church_title: "Bispo", church_rank: 1 });
    expect(up.ok).toBe(true);
    const r = await adm.api.get(`/org_members?org_id=eq.${org}&select=user_id,church_title,church_rank`);
    const me = (r.data || []).find((m: any) => m.user_id === adm.id);
    expect(me.church_title).toBe("Bispo");
    expect(me.church_rank).toBe(1);
  });
  test("quem nao e administrador nao altera a ordem", async () => {
    const outro = await newUser("Outro Lideranca");
    const up = await outro.api.patch(`org_members?org_id=eq.${org}&user_id=eq.${adm.id}`, { church_rank: 9 });
    expect(Array.isArray(up.data) ? up.data.length : 0).toBe(0);
    const r = await adm.api.get(`/org_members?org_id=eq.${org}&user_id=eq.${adm.id}&select=church_rank`);
    expect(r.data[0].church_rank).toBe(1);
  });
});
