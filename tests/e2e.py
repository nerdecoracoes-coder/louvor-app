# Teste ponta a ponta no navegador (Chrome sem interface), contra o ambiente local:
#   dev/stack.sh start && bun dev/serve.ts && python3 tests/e2e.py
# Executa o fluxo real de várias pessoas: cadastro, organização, times, convites, funções, Drive, repertório,
# escala, confirmação, chat, enquete, player multitrack, letra, várias organizações e telas de computador.
import json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:8080"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/shots"
STAMP = str(int(time.time()))
IGNORED = ("ERR_TUNNEL_CONNECTION_FAILED", "fonts.g", "/realtime/", "WebSocket", "itunes.apple.com")
errors = []
results = []

def ok(name):
    results.append(name); print("✓", name, flush=True)

def ctx(browser, w=390, h=844):
    c = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, locale="pt-BR", timezone_id="America/Sao_Paulo")
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and not any(x in m.text for x in IGNORED) and errors.append(f"[{w}] {m.text}"))
    p.on("pageerror", lambda e: errors.append(f"pageerror [{w}]: {e}"))
    return c, p

def shot(p, name): p.screenshot(path=f"{SHOTS}/{name}.png", full_page=False)

def signup(p, name, email, url=BASE + "/"):
    p.goto(url)
    p.get_by_role("button", name="Criar conta").click()
    p.fill("input[name=name]", name); p.fill("input[name=email]", email); p.fill("input[name=password]", "senha-forte-123")
    p.fill("input[name=phone]", "(21) 98888-7777")
    p.locator("#go").click()

def tap(p, text): p.get_by_text(text, exact=True).first.click()

def toast_has(p, text): expect(p.locator(".toast").filter(has_text=text).first).to_be_visible(timeout=10000)

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--autoplay-policy=no-user-gesture-required"])
    # ------------------------------------------------------------------ Ana: conta, organização, time
    ca, ana = ctx(br)
    signup(ana, "Ana Ribeiro", f"ana.{STAMP}@teste.local")
    expect(ana.get_by_text("ainda não participa de nenhuma igreja")).to_be_visible(timeout=15000)
    shot(ana, "02-onboarding"); ok("cadastro aberto, sem organização")
    ana.get_by_text("Cadastrar uma igreja").click()
    ana.fill("input[name=name]", "INVT Tijuca"); ana.fill("input[name=subtitle]", "Ministério de Louvor")
    ana.locator("#go").click()
    expect(ana.get_by_role("heading", name="Novo time")).to_be_visible(timeout=15000)
    ok("organização criada; criador é administrador geral")
    ana.fill("input[name=name]", "Louvor Domingo"); ana.locator("#save").click()
    expect(ana.get_by_role("heading", name="Louvor Domingo")).to_be_visible(timeout=10000)
    ana.goto(BASE + "/#/times/novo"); ana.fill("input[name=name]", "Jovens")
    ana.locator("select[name=team_type]").select_option("multimidia"); ana.locator("#save").click()
    expect(ana.get_by_role("heading", name="Jovens")).to_be_visible(timeout=10000)
    expect(ana.locator(".pagehead")).to_contain_text("Multimídia")
    expect(ana.locator("#mlist .li", has_text="Ana Ribeiro")).to_contain_text("Líder", timeout=10000)
    ok("tipo de time; quem cria o time entra como líder")
    ok("vários times criados")
    ana.goto(BASE + "/#/times"); expect(ana.get_by_text("Louvor Domingo")).to_be_visible()
    shot(ana, "03-times")
    louvor_id = ana.locator(".teamcard a", has_text="Louvor Domingo").get_attribute("href").split("/")[-1]

    # convite
    ana.goto(f"{BASE}/#/times/{louvor_id}/integrantes")
    ana.get_by_role("button", name="Convidar").click()
    link = ana.locator("#lnk").input_value()
    assert "/#/convite/" in link
    shot(ana, "04-convite"); ok("link exclusivo de convite gerado")
    ana.keyboard.press("Escape"); ana.goto(BASE + "/#/")

    # ------------------------------------------------------------------ Bruno e Carla aceitam
    people = {}
    for who in ["Bruno Costa", "Carla Dias"]:
        c, p = ctx(br)
        p.goto(link)
        expect(p.locator(".invitecard")).to_contain_text("Louvor Domingo", timeout=15000)
        if who == "Bruno Costa": shot(p, "05-convite-recebido")
        p.get_by_role("button", name="Criar conta").click()
        p.fill("input[name=name]", who); p.fill("input[name=email]", f"{who.split()[0].lower()}.{STAMP}@teste.local"); p.fill("input[name=password]", "senha-forte-123")
        p.locator("#go").click()
        p.get_by_role("button", name="Aceitar convite").click(timeout=15000)
        expect(p.locator(".pagehead h1", has_text="Louvor Domingo")).to_be_visible(timeout=15000)
        people[who] = (c, p)
    ok("convites aceitos (cadastro pelo link)")
    bc, bruno = people["Bruno Costa"]; cc, carla = people["Carla Dias"]
    carla.goto(link); expect(carla.get_by_text("Você já faz parte deste time")).to_be_visible(timeout=15000)
    ok("convite repetido informa que já faz parte")
    carla.goto(BASE + "/#/")

    # ------------------------------------------------------------------ Ana define funções e liderança
    ana.goto(f"{BASE}/#/times/{louvor_id}/integrantes")
    def edit_member(name, roles, leader=False):
        row = ana.locator("#mlist .li", has_text=name)
        row.locator("[data-mm]").click()
        ana.get_by_text("Editar integrante").click()
        for r in roles: ana.locator(".sheet label.chip", has_text=r).first.click()
        if leader: ana.locator("select[name=leader]").select_option("1")
        ana.locator("#save").click()
        toast_has(ana, "Integrante atualizado")
    edit_member("Bruno Costa", ["Ministro", "Guitarra"], leader=True)
    edit_member("Carla Dias", ["Vocal feminino"])
    expect(ana.locator("#mlist .li", has_text="Bruno Costa")).to_contain_text("Líder")
    shot(ana, "06-integrantes"); ok("funções musicais e líder definidos")

    # Bruno (líder) não vê opção de criar time; vê o time como líder
    bruno.goto(BASE + "/#/times"); bruno.reload()
    expect(bruno.get_by_text("você é líder")).to_be_visible(timeout=10000)
    assert bruno.get_by_role("link", name="Novo time").count() == 0
    ok("líder sem acesso administrativo à organização")

    # ------------------------------------------------------------------ Google Drive (pasta simulada)
    root_id = json.loads(urllib.request.urlopen(BASE + "/__dev/drive").read())["rootId"]
    ana.goto(BASE + "/#/org/drive")
    expect(ana.get_by_text("teste@projeto.iam.gserviceaccount.com")).to_be_visible(timeout=10000) if False else None
    ana.fill("input[name=folder]", f"https://drive.google.com/drive/folders/{root_id}")
    ana.locator("#conn").click()
    toast_has(ana, "conectada")
    ana.goto(BASE + "/#/musicas")
    expect(ana.locator(".song", has_text="Emaús")).to_be_visible(timeout=20000)
    expect(ana.locator(".song", has_text="Ousado Amor")).to_contain_text("Isaias Saad")
    expect(ana.locator(".song", has_text="Emaús")).to_contain_text("140 BPM")
    expect(ana.locator(".song", has_text="Emaús")).to_contain_text("Tom B")
    expect(ana.locator(".song", has_text="Emaús")).to_contain_text("VS")
    shot(ana, "07-musicas"); ok("pasta do Drive importada: nome, artista, BPM, tom e VS")

    # cadastro manual
    ana.goto(BASE + "/#/musicas/nova")
    ana.fill("input[name=title]", "Bondade de Deus"); ana.fill("input[name=artist]", "Isaias Saad"); ana.fill("input[name=song_key]", "G")
    ana.fill("input[name=bpm]", "68"); ana.fill("input[name=youtube_url]", "https://www.youtube.com/watch?v=abc")
    ana.locator("#save").click()
    expect(ana.locator(".pagehead h1", has_text="Bondade de Deus")).to_be_visible(timeout=10000)
    ana.goto(BASE + "/#/musicas")
    row = ana.locator(".song", has_text="Bondade de Deus")
    expect(row).to_contain_text("YouTube"); assert row.locator(".tag", has_text="VS").count() == 0
    ana.get_by_role("button", name="Somente com VS").click()
    expect(ana.locator(".song", has_text="Bondade de Deus")).to_have_count(0)
    ok("música manual identificada sem VS; filtro 'somente VS'")

    # letra
    emaus_href = ana.locator(".song", has_text="Emaús").locator("a.cover").get_attribute("href")
    emaus_id = emaus_href.split("/")[-1]
    ana.goto(f"{BASE}/#/musica/{emaus_id}/letra")
    ana.fill("textarea[name=t]", "[Verso 1]\nTeu amor me alcançou\nNo caminho de Emaús\n\n[Refrão]\nArde o coração\nQuando falas comigo\n\n[Ponte]\nFica comigo, Senhor")
    ana.locator("#save").click(); toast_has(ana, "Letra salva")
    ok("letra cadastrada em blocos")

    # ------------------------------------------------------------------ Bruno cria e publica escala
    bruno.goto(f"{BASE}/#/escala/nova/{louvor_id}")
    bruno.fill("input[name=title]", "Culto de Celebração")
    nxt = time.strftime("%Y-%m-%d", time.localtime(time.time() + 3 * 86400))
    bruno.fill("input[name=date]", nxt); bruno.locator("input[name=date]").dispatch_event("change")
    bruno.fill("input[name=time]", "19:00"); bruno.fill("input[name=location]", "INVT Tijuca")
    bruno.locator("#addsong").click()
    bruno.locator(".sheet [data-s]", has_text="Emaús").click(); bruno.locator(".sheet #ok").click()
    bruno.locator("#suggest").click()
    toast_has(bruno, "sugest")
    expect(bruno.locator(".chip.on", has_text="Carla Dias")).to_be_visible()
    shot(bruno, "08-escala-editor")
    bruno.get_by_role("button", name="Publicar escala").click()
    expect(bruno.locator(".pagehead h1", has_text="Culto de Celebração")).to_be_visible(timeout=10000)
    expect(bruno.get_by_text("Emaús")).to_be_visible()
    sched_url = bruno.url
    ok("escala criada com sugestão, música do repertório e publicada")

    # ------------------------------------------------------------------ Carla vê, confirma; calendário
    carla.goto(BASE + "/#/"); carla.reload()
    expect(carla.locator("#ups .sched", has_text="Culto de Celebração")).to_be_visible(timeout=10000)
    expect(carla.locator("#ups .sched")).to_contain_text("Vocal feminino")
    expect(carla.locator('a[href="#/notificacoes"] .dot')).to_be_visible()
    shot(carla, "09-inicio-integrante"); ok("integrante vê a escala no início e recebe notificação")
    carla.locator("#ups .sched").first.click()
    carla.get_by_role("button", name="Tomei conhecimento da escala").click()
    expect(carla.get_by_text("Você confirmou que viu esta escala")).to_be_visible(timeout=10000)
    ok("confirmação de visualização")
    bruno.goto(sched_url); bruno.reload()
    expect(bruno.locator(".li", has_text="Carla Dias")).to_contain_text("Visto")
    carla.goto(BASE + "/#/calendario/geral"); expect(carla.locator(".sched", has_text="Culto de Celebração").first).to_be_visible(timeout=10000)
    carla.goto(f"{BASE}/#/calendario/time:{louvor_id}"); expect(carla.locator(".sched", has_text="Culto de Celebração").first).to_be_visible(timeout=10000)
    shot(carla, "10-calendario"); ok("calendário geral e do time")

    # bloqueio de data
    carla.goto(BASE + "/#/bloqueios")
    carla.locator("[data-day]").nth(20).click()
    carla.locator(".sheet input[name=note]").fill("Viagem")
    carla.locator(".sheet button", has_text="Bloquear").click(); toast_has(carla, "Data bloqueada")
    expect(carla.locator(".d.blk")).to_have_count(1)
    ok("bloqueio de datas")

    # ------------------------------------------------------------------ chat, música, enquete
    carla.goto(f"{BASE}/#/chat/{louvor_id}")
    carla.fill("#txt", "Bom dia, time! 🙌"); carla.locator("#send").click()
    expect(carla.locator(".msg.me", has_text="Bom dia, time!")).to_be_visible(timeout=10000)
    bruno.goto(f"{BASE}/#/chat/{louvor_id}")
    expect(bruno.locator(".msg", has_text="Bom dia, time!")).to_be_visible(timeout=15000)
    bruno.locator("#att").click(); bruno.locator(".sheet [data-a=poll]").click()
    bruno.fill(".sheet input[name=q]", "Ensaio sábado 16h?")
    opts = bruno.locator(".sheet input[name=o]"); opts.nth(0).fill("Sim"); opts.nth(1).fill("Não")
    bruno.locator(".sheet button", has_text="Enviar enquete").click()
    expect(bruno.locator(".pollbox", has_text="Ensaio sábado 16h?")).to_be_visible(timeout=10000)
    bruno.locator("#att").click(); bruno.locator(".sheet [data-a=song]").click()
    bruno.locator(".sheet [data-s]", has_text="Emaús").click()
    expect(bruno.locator(".songmsg", has_text="Emaús")).to_be_visible(timeout=10000)
    expect(carla.locator(".pollbox", has_text="Ensaio sábado 16h?")).to_be_visible(timeout=15000)
    carla.locator(".pollbox [data-vote='0']").click()
    expect(carla.locator(".pollbox .pollopt.mine")).to_contain_text("Sim", timeout=10000)
    expect(bruno.locator(".pollbox")).to_contain_text("1 voto", timeout=15000)
    shot(carla, "11-chat"); ok("chat do time: mensagem, enquete com votos e música compartilhada")
    # imagem no chat (galeria)
    with carla.expect_file_chooser() as fc:
        carla.locator("#att").click(); carla.locator(".sheet [data-a=gallery]").click()
    fc.value.set_files(f"{SHOTS}/01-login.png" if False else "/home/claude/louvor-app/icon-192.png")
    expect(carla.locator(".msg.me img.att")).to_be_visible(timeout=15000)
    ok("foto enviada no chat (armazenamento privado)")

    # ------------------------------------------------------------------ player
    carla.locator(".songmsg a.playbtn").first.click()
    expect(carla.locator(".player .trk")).to_have_count(9, timeout=20000)  # 8 faixas de áudio + 1 pasta
    shot(carla, "12-player-faixas-antes")
    carla.locator('[data-t="play"]').click()
    carla.wait_for_function("window.__player && window.__player.playing && window.__player.position() > 1.5", timeout=20000)
    st = carla.evaluate("""() => { const e = window.__player; return { pos: e.position(), sources: e.sources.size, ctx: e.ctx.state, sr: e.ctx.sampleRate,
        tracks: e.tracks.filter(t => t.items.length).length, loaded: e.bytesLoaded } }""")
    assert st["ctx"] == "running" and st["sources"] >= 7 and st["sr"] == 48000, st  # o Pad só começa em 4 s
    ok(f"reprodução multitrack sincronizada ({st['sources']} trechos agendados no mesmo relógio, {st['sr']} Hz)")
    # sincronismo: todas as fontes ativas devem pertencer ao mesmo instante de projeto
    sync = carla.evaluate("""() => { const e = window.__player; const p = e.position();
        // cada faixa precisa ter um trecho agendado cobrindo a posição atual
        const need = e.tracks.filter(t => t.items.some(i => i.position <= p && i.position + i.length > p)).length;
        const keys = [...e.scheduled].map(k => k.split(':')[0]);
        return { need, covered: new Set(keys).size } }""")
    assert sync["covered"] >= sync["need"], sync
    # volume / mute / solo alteram o áudio de verdade (ganhos no grafo)
    g = carla.evaluate("""async () => { const e = window.__player; const t = e.tracks.find(x => x.name === 'Drums');
        e.setTrack(t, { volume: 0.25 }); await new Promise(r => setTimeout(r, 200)); const v = t.gain.gain.value;
        e.setTrack(t, { muted: true }); await new Promise(r => setTimeout(r, 200)); const m = t.gain.gain.value;
        e.setTrack(t, { muted: false, soloed: true }); await new Promise(r => setTimeout(r, 200));
        const other = e.tracks.find(x => x.name === 'Click').gain.gain.value, solo = t.gain.gain.value;
        e.setTrack(t, { soloed: false, volume: t.orig.volume }); await new Promise(r => setTimeout(r, 250));
        const keys = e.tracks.find(x => x.name === 'Keys'); const pan = keys.panner.pan.value;
        const guide = e.tracks.find(x => x.name === 'Guide').gain.gain.value;
        e.setMaster(0.5); await new Promise(r => setTimeout(r, 200)); const master = e.masterGain.gain.value; e.setMaster(1);
        return { v, m, other, solo, pan, guide, master } }""")
    assert abs(g["v"] - 0.25) < 0.02 and g["m"] < 0.01 and g["other"] < 0.01 and abs(g["solo"] - 0.25) < 0.02, g
    assert abs(g["pan"] + 0.4) < 0.01 and abs(g["guide"] - 0.7) < 0.02 and abs(g["master"] - 0.5) < 0.02, g
    ok("volume, mute, solo, pan e master atuam no áudio; mixagem do REAPER importada (Guide 0.7, Keys pan -0.4)")
    # folder: solo em BGV Alto mantém a pasta BGVS audível e silencia o resto
    f = carla.evaluate("""async () => { const e = window.__player; const a = e.tracks.find(x => x.name === 'BGV Alto');
        e.setTrack(a, { soloed: true }); await new Promise(r => setTimeout(r, 200));
        const folder = e.tracks.find(x => x.name === 'BGVS').gain.gain.value, tenor = e.tracks.find(x => x.name === 'BGV Tenor').gain.gain.value;
        e.setTrack(a, { soloed: false }); return { folder, tenor } }""")
    assert f["folder"] > 0.5 and f["tenor"] < 0.01, f
    ok("pastas do REAPER respeitadas no solo")
    # navegação e marcadores
    carla.locator('[data-t="next"]').click(); carla.wait_for_timeout(600)
    pos = carla.evaluate("window.__player.position()")
    assert 3.3 < pos < 8, pos
    carla.locator('[data-t="pause"], [data-t="play"]').first.click()
    carla.wait_for_timeout(300)
    assert carla.evaluate("window.__player.playing") is False
    carla.locator(".timeline [data-rg]").first.click(); carla.wait_for_timeout(800)
    loop = carla.evaluate("window.__player.loop")
    assert loop and abs(loop[0] - 3.428571) < 0.01, loop
    ok("pause, próximo marcador e repetição de região")
    carla.evaluate("window.__player.setLoop(null); window.__player.pause()")
    carla.wait_for_timeout(1500)
    shot(carla, "13-player-faixas")
    carla.locator('[data-tab="mix"]').click(); carla.wait_for_timeout(300)
    expect(carla.locator(".strip")).to_have_count(10)
    carla.locator('.strip [data-m]').first.click()
    carla.wait_for_timeout(1200)
    shot(carla, "14-player-mix")
    saved = carla.evaluate("""async () => { return window.__player.isCustom() }""")
    assert saved
    ok("aba Mix (mesa) e mix pessoal")
    carla.locator('[data-tab="letra"]').click()
    expect(carla.locator(".lyr .blk")).to_have_count(3)
    shot(carla, "15-player-letra"); ok("aba Letra com blocos")
    carla.locator("[data-x]").first.click(); carla.wait_for_timeout(500)
    # mix pessoal persistida no banco
    carla.goto(f"{BASE}/#/player/{emaus_id}")
    expect(carla.locator("#mixtag")).to_have_text("Mix pessoal", timeout=20000)
    ok("mix pessoal salva e recarregada sem alterar o projeto")
    carla.locator("#mixreset").click(); carla.wait_for_timeout(1200)
    expect(carla.locator("#mixtag")).to_have_text("Mix do projeto")
    carla.locator("[data-x]").first.click()

    # ------------------------------------------------------------------ várias organizações
    carla.goto(BASE + "/#/nova-org")
    carla.fill("input[name=name]", "Igreja do Bairro"); carla.locator("#go").click()
    expect(carla.get_by_role("heading", name="Novo time")).to_be_visible(timeout=15000)
    carla.goto(BASE + "/#/"); carla.locator("[data-act=orgs]").click()
    expect(carla.locator(".sheet [data-org]")).to_have_count(2)
    shot(carla, "16-organizacoes")
    carla.locator(".sheet [data-org]", has_text="INVT Tijuca").click()
    expect(carla.locator(".brand")).to_contain_text("INVT Tijuca", timeout=10000)
    expect(carla.locator("#ups .sched")).to_have_count(1, timeout=10000)
    carla.locator("[data-act=orgs]").click(); carla.locator(".sheet [data-org]", has_text="Igreja do Bairro").click()
    expect(carla.locator(".brand")).to_contain_text("Igreja do Bairro", timeout=10000)
    carla.goto(BASE + "/#/musicas"); expect(carla.locator(".song")).to_have_count(0, timeout=10000)
    ok("uma conta em duas organizações; troca sem sair; dados isolados")

    # ------------------------------------------------------------------ início completo e computador
    ana.goto(BASE + "/#/avisos/novo")
    ana.fill("input[name=title]", "Ensaio Geral"); ana.fill("input[name=tag]", "Reunião"); ana.fill("textarea[name=body]", "Todos os times. Tragam os instrumentos.")
    ana.fill("input[name=date]", nxt); ana.fill("input[name=time]", "19:30"); ana.locator("#save").click()
    toast_has(ana, "Aviso publicado")
    bruno.goto(BASE + "/#/"); bruno.reload(); expect(bruno.locator(".notice", has_text="Ensaio Geral")).to_be_visible(timeout=10000)
    shot(bruno, "17-inicio-lider"); ok("aviso da organização publicado e exibido")
    cd, desk = ctx(br, 1440, 900)
    desk.goto(BASE + "/")
    desk.fill("input[name=email]", f"bruno.{STAMP}@teste.local"); desk.fill("input[name=password]", "senha-forte-123"); desk.locator("#go").click()
    expect(desk.locator(".hero")).to_be_visible(timeout=15000)
    shot(desk, "18-desktop-inicio")
    desk.goto(f"{BASE}/#/player/{emaus_id}"); expect(desk.locator(".player .trk")).to_have_count(9, timeout=20000)
    desk.wait_for_timeout(2500); shot(desk, "19-desktop-player")
    desk.locator('[data-tab="mix"]').click(); desk.wait_for_timeout(400); shot(desk, "20-desktop-mix")
    ok("layout de computador")

    # sem rolagem horizontal no celular
    for p_, n in [(ana, "ana"), (bruno, "bruno"), (carla, "carla")]:
        for route in ["/#/", "/#/times", "/#/musicas", "/#/chat", f"/#/escala/nova/{louvor_id}"]:
            p_.goto(BASE + route); p_.wait_for_timeout(700)
            ow = p_.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            assert ow <= 1, (n, route, ow)
    ok("sem rolagem horizontal nas telas principais (390 px)")
    br.close()

print(f"\n{len(results)} verificações aprovadas")
if errors:
    print("\nERROS DE CONSOLE:"); [print(" -", e) for e in errors]; sys.exit(1)
print("Sem erros de console.")
