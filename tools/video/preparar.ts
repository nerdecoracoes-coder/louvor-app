// Cria dados fictícios para gravar os tutoriais: igreja, 4 times, integrantes com funções, músicas com letra,
// escalas do Louvor e da Multimídia e o checklist. Uso (ambiente local no ar): bun tools/video/preparar.ts > /tmp/claude-0/conta.json
import { newUser, joinChurch } from "../../tests/helpers";

const names = ["Ana Souza", "Bruno Costa", "Carla Dias", "Davi Lima", "Edu Martins", "Fabi Rocha", "Gabi Alves", "Hugo Nunes"];
const [ana, bruno, carla, davi, edu, fabi, gabi, hugo] = await Promise.all(names.map(newUser));
const org = (await ana.api.rpc("create_organization", { p_name: "Igreja Exemplo" })).data;
const mk = async (name: string, team_type: string) => (await ana.api.post("teams", { org_id: org, name, team_type })).data[0].id as string;
const louvor = await mk("Louvor Domingo", "louvor"), midia = await mk("Multimídia", "multimidia"), infantil = await mk("Ministério Infantil", "infantil"), diaconal = await mk("Diáconos", "diaconal");
await joinChurch(ana.api, org, bruno, carla, davi, edu, fabi, gabi, hugo);
const add = async (team: string, ...u: { id: string }[]) => ana.api.rpc("add_team_members", { p_team: team, p_users: u.map((x) => x.id) });
await add(louvor, ana, bruno, carla, davi); await add(midia, ana, edu, fabi); await add(infantil, ana, gabi); await add(diaconal, ana, hugo);
for (const t of [louvor, midia, infantil, diaconal]) await ana.api.patch(`team_members?team_id=eq.${t}&user_id=eq.${ana.id}`, { is_leader: true });
const roles = (await ana.api.get(`/music_roles?org_id=eq.${org}&select=id,name,team_type`)).data as { id: string; name: string; team_type: string | null }[];
const role = (n: string, tt?: string) => roles.find((r) => r.name === n && (!tt || r.team_type === tt || !r.team_type))!.id;
for (const [team, u, n] of [[louvor, bruno, "Ministro"], [louvor, carla, "Vocal feminino"], [louvor, davi, "Bateria"], [midia, edu, "Projeção"], [midia, fabi, "Transmissão/Corte"]] as const)
  await ana.api.post("team_member_roles", { team_id: team, user_id: u.id, org_id: org, role_id: role(n) });

const letra = (...b: [string, string][]) => ({ blocks: b.map(([label, text], i) => ({ id: `b${i}`, label, text, start: null })), source: "manual", synced: false });
const songs: Record<string, string> = {};
for (const [title, artist, key, lyrics] of [
  ["Emaús", "Morada", "B", letra(["Verso 1", "Teu amor me alcançou\nNo caminho de Emaús"], ["Refrão", "Arde o coração\nQuando falas comigo"], ["Ponte", "Fica comigo, Senhor\nPorque a noite vem"])],
  ["Aleluia", "Gabriel Guedes", "G", letra(["Verso 1", "Sobre tudo és Senhor\nMajestade e louvor"], ["Refrão", "Aleluia, aleluia\nTu és digno de louvor"])],
] as const) {
  songs[title] = (await ana.api.post("songs", { org_id: org, title, artist, song_key: key, status: "ready", lyrics })).data[0].id;
}
const when = new Date(Date.now() + 4 * 864e5); when.setUTCHours(22, 0, 0, 0);
const sched = async (team: string, title: string, at: Date) => (await ana.api.post("schedules", { org_id: org, team_id: team, title, starts_at: at.toISOString(), status: "published" })).data[0].id as string;
const sL = await sched(louvor, "Culto de Domingo", when), sM = await sched(midia, "Culto de Domingo", new Date(when.getTime() - 30 * 60e3));
let pos = 1;
for (const [title, artist, key] of [["Emaús", "Morada", "B"], ["Aleluia", "Gabriel Guedes", "G"]]) {
  await ana.api.post("schedule_songs", { schedule_id: sL, org_id: org, team_id: louvor, song_id: songs[title], title_snapshot: title, artist_snapshot: artist, song_key: key, position: pos++ });
}
await ana.api.post("schedule_assignments", [[bruno, "Ministro"], [carla, "Vocal feminino"], [davi, "Bateria"]].map(([u, r]: any) => ({ schedule_id: sL, org_id: org, team_id: louvor, user_id: u.id, role_name: r })));
await ana.api.post("schedule_assignments", [[edu, "Projeção"], [fabi, "Transmissão/Corte"]].map(([u, r]: any) => ({ schedule_id: sM, org_id: org, team_id: midia, user_id: u.id, role_name: r })));
const itens = ["Projetor / TV ligados e testados", "Letras e slides conferidos", "Câmeras posicionadas, com bateria e cartão", "Mesa de corte funcionando", "Transmissão testada (imagem e som)", "Iluminação conferida", "Internet estável no local"];
await ana.api.post("team_checklist_items", itens.map((label, i) => ({ org_id: org, team_id: midia, label, position: i + 1 })));
const acc = (u: { email: string }) => ({ email: u.email, password: "senha-forte-123" });
console.log(JSON.stringify({ ana: acc(ana), carla: acc(carla), bruno: acc(bruno), teams: { louvor, midia, infantil, diaconal }, sched: { louvor: sL, midia: sM } }));
