// Gera um projeto REAPER de teste com áudios reais (sintetizados com ffmpeg), no mesmo formato de pasta
// usado pelo ministério: "<Música> - <Artista>/<Música> - <Artista> - <BPM> BPM (<Tom>).rpp" + "Tracks 1/*.wav".
// É apenas material de teste: não substitui a validação com um projeto real do Automate Pro.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

export interface FixtureOpts { root: string; folder?: string; rppName?: string; seconds?: number; variant?: "v1" | "v2" }

const guid = (n: number) => `{${n.toString(16).padStart(8, "0").toUpperCase()}-1111-2222-3333-444455556666}`;

export async function makeProject(o: FixtureOpts) {
  const folder = o.folder ?? "Emaús - Morada";
  const rppName = o.rppName ?? "Emaús - Morada - 140 BPM (B).rpp";
  const secs = o.seconds ?? 12;
  const dir = join(o.root, folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "Tracks 1"), { recursive: true });
  const t = (f: string) => join(dir, "Tracks 1", f);
  const sr = 48000;
  // Click: pulsos curtos a 140 BPM (0,4286 s), mono 16 bits
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=1500:sample_rate=${sr}:d=${secs}" -af "volume='if(lt(mod(t,0.428571),0.03),1,0)':eval=frame" -ac 1 -c:a pcm_s16le ${t("Click.wav")}`;
  // Guide: tom de 440 Hz, mono 24 bits
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=440:sample_rate=${sr}:d=${secs}" -ac 1 -c:a pcm_s24le ${t("Guide.wav")}`;
  // Drums: ruído em rajadas, estéreo 16 bits
  await $`ffmpeg -loglevel error -y -f lavfi -i "anoisesrc=d=${secs}:c=pink:r=${sr}:a=0.5" -af "volume='if(lt(mod(t,0.857),0.12),1,0.05)':eval=frame" -ac 2 -c:a pcm_s16le ${t("Drums.wav")}`;
  // Bass: 55 Hz, mono float 32 bits
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=55:sample_rate=${sr}:d=${secs}" -ac 1 -c:a pcm_f32le ${t("Bass.wav")}`;
  // Keys: acorde estéreo 16 bits
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=261.6:sample_rate=${sr}:d=${secs}" -f lavfi -i "sine=f=329.6:sample_rate=${sr}:d=${secs}" -filter_complex "[0][1]amerge=inputs=2" -ac 2 -c:a pcm_s16le ${t("Keys.wav")}`;
  // BGVs (duas vozes dentro de uma pasta)
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=587:sample_rate=${sr}:d=${secs}" -ac 1 -c:a pcm_s16le ${t("BGV Alto.wav")}`;
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=659:sample_rate=${sr}:d=${secs}" -ac 1 -c:a pcm_s16le ${t("BGV Tenor.wav")}`;
  // Pad em um segundo item, começando em 4 s com offset de 1 s na fonte
  await $`ffmpeg -loglevel error -y -f lavfi -i "sine=f=196:sample_rate=${sr}:d=${secs}" -ac 2 -c:a pcm_s16le ${t("Pad.wav")}`;

  const v2 = o.variant === "v2";
  const track = (n: number, name: string, body: string, extra = "") => `  <TRACK ${guid(n)}
    NAME "${name}"
    PEAKCOL ${16576 + n}
    BEAT -1
    AUTOMODE 0
${extra}    IPHASE 0
    PLAYOFFS 0 1
    MAINSEND 1 0
    NCHAN 2
${body}  >
`;
  const item = (file: string, pos: number, len: number, soffs = 0, vol = 1, fadeIn = 0) => `    <ITEM
      POSITION ${pos}
      SNAPOFFS 0
      LENGTH ${len}
      LOOP 0
      ALLTAKES 0
      FADEIN 1 ${fadeIn} 0 1 0 0 0
      FADEOUT 1 0 0 1 0 0 0
      MUTE 0 0
      SEL 0
      IGUID ${guid(pos * 1000 + len)}
      IID 1
      NAME "${file.split(/[\\/]/).pop()}"
      VOLPAN ${vol} 0 1 -1
      SOFFS ${soffs}
      PLAYRATE 1 1 0 -1 0 0.0025
      CHANMODE 0
      GUID ${guid(len * 7)}
      <SOURCE WAVE
        FILE "${file}"
      >
    >
`;
  const vp = (v: number, p: number, m = 0, s = 0) => `    VOLPAN ${v} ${p} -1 -1 1\n    MUTESOLO ${m} ${s} 0\n`;
  const rpp = `<REAPER_PROJECT 0.1 "7.27/win64" 1730000000
  <NOTES 0 2
  >
  RIPPLE 0
  GROUPOVERRIDE 0 0 0
  AUTOXFADE 129
  TEMPO 140 4 4
  PLAYRATE 1 0 0.25 4
  SAMPLERATE ${sr} 0 0
  MASTER_VOLUME ${v2 ? 0.8 : 1} 0 -1 -1 1
  MASTERMUTESOLO 0
  MARKER 1 0 "Intro" 0 0 1 B ${guid(901)} 0
  MARKER 2 3.428571 "Verso 1" 1 16711935 1 R ${guid(902)} 0
  MARKER 2 6.857143 "" 1
  MARKER 3 6.857143 "Refrão" 0 33488896 1 B ${guid(903)} 0
  MARKER 4 10.285714 "Final" 0 0 1 B ${guid(904)} 0
  <TEMPOENVEX
    EGUID ${guid(905)}
    ACT 0 -1
    VIS 1 0 1
  >
${track(1, "Click", item("Tracks 1\\Click.wav", 0, secs), vp(1, 0))}${track(2, "Guide", item("C:\\Users\\Ministerio\\Desktop\\Emaús - Morada\\Tracks 1\\Guide.wav", 0, secs), vp(v2 ? 0.5 : 0.7, 0))}${track(3, "Drums", item("Tracks 1/Drums.wav", 0, secs), vp(0.9, 0))}${track(4, "Bass", item("Bass.wav", 0, secs), vp(1.2, 0))}${track(5, "Keys", item("Tracks 1\\Keys.wav", 0, secs), vp(0.6, -0.4) + `    <FXCHAIN
      SHOW 0
      LASTSEL 0
      DOCKED 0
      BYPASS 0 0 0
      <VST "VST: ReaEQ (Cockos)" reaeq.dll 0 "" 1919247729<56535472656571726561657100000000> ""
        cWVlcu5e7f4CAAAAAQAAAAAAAAACAAAAAAAAAAIAAAABAAAAAAAAAAIAAAAAAAAAXAAAAAEAAAAAABAA
      >
      FLOATPOS 0 0 0 0
      FXID ${guid(906)}
      WAK 0 0
    >
`)}${track(6, "BGVS", "", "    ISBUS 1 1\n" + vp(0.8, 0))}${track(7, "BGV Alto", item("Tracks 1\\BGV Alto.wav", 0, secs), "    ISBUS 0 0\n" + vp(1, -0.5))}${track(8, "BGV Tenor", item("Tracks 1\\BGV Tenor.wav", 0, secs), "    ISBUS 2 -1\n" + vp(1, 0.5, v2 ? 1 : 0))}${track(9, "Pad", item("Tracks 1\\Pad.wav", 4, secs - 5, 1, 0.5, 0.5), vp(1, 0) + `    <VOLENV2
      EGUID ${guid(907)}
      ACT 1 -1
      VIS 1 1 1
      ARM 0
      DEFSHAPE 0 -1 -1
      PT 0 1 0
      PT 6 0.3 0
    >
`)}${track(10, "LETRA", `    <ITEM
      POSITION 3.428571
      LENGTH 3.428571
      NAME "Verso 1"
      <NOTES
        |Linha de teste 1
        |Linha de teste 2
      >
      <SOURCE EMPTY
      >
    >
`, vp(1, 0))}>
`;
  writeFileSync(join(dir, rppName), rpp);
  // backup do REAPER que deve ser ignorado
  writeFileSync(join(dir, rppName.replace(/\.rpp$/i, ".rpp-bak")), rpp);
  return { dir, rppPath: join(dir, rppName) };
}

if (import.meta.main) {
  const root = process.argv[2] ?? "/tmp/claude-0/fixtures";
  await makeProject({ root });
  console.log("ok", root);
}
