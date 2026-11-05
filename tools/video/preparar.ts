// Cria dados fictícios para gravar os tutoriais (igreja, time de Louvor, integrantes com funções e uma música).
// Uso (com o ambiente local no ar): bun tools/video/preparar.ts > /tmp/video-conta.json
import { newUser, joinChurch } from "../../tests/helpers";

const [ana, bruno, carla, davi] = await Promise.all(["Ana Souza", "Bruno Costa", "Carla Dias", "Davi Lima"].map(newUser));
const org = (await ana.api.rpc("create_organization", { p_name: "Igreja Exemplo" })).data;
const team = (await ana.api.post("teams", { org_id: org, name: "Louvor Domingo", team_type: "louvor" })).data[0].id;
await joinChurch(ana.api, org, bruno, carla, davi);
await ana.api.rpc("add_team_members", { p_team: team, p_users: [ana.id, bruno.id, carla.id, davi.id] });
await ana.api.patch(`team_members?team_id=eq.${team}&user_id=eq.${ana.id}`, { is_leader: true });
const roles = (await ana.api.get(`/music_roles?org_id=eq.${org}&select=id,name`)).data as { id: string; name: string }[];
const role = (n: string) => roles.find((r) => r.name === n)!.id;
for (const [u, n] of [[bruno, "Ministro"], [carla, "Vocal feminino"], [davi, "Bateria"]] as const) {
  await ana.api.post("team_member_roles", { team_id: team, user_id: u.id, org_id: org, role_id: role(n) });
}
await ana.api.post("songs", { org_id: org, title: "Emaús", artist: "Morada", song_key: "B", status: "ready", lyrics: { blocks: [{ label: "Verso 1", text: "Teu amor me alcançou\nNo caminho de Emaús" }] } });
console.log(JSON.stringify({ email: ana.email, password: "senha-forte-123", team }));
