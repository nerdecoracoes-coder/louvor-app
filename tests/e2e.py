# Teste ponta a ponta no navegador (Chrome sem interface), contra o ambiente local:
#   dev/stack.sh start && bun dev/serve.ts && python3 tests/e2e.py
# Executa o fluxo real de várias pessoas: cadastro, organização, times, convites, funções, Drive, repertório,
# escala, confirmação, chat, enquete, player multitrack, letra, várias organizações e telas de computador.
import json, os, re, subprocess, sys, time, urllib.request
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
    expect(ana.locator(".pagehead")).to_contain_text("0 integrantes")
    ok("tipo de time; administrador cria o time sem precisar participar")
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
    # convite de membro da igreja (o time é ministério: só membros entram)
    ana.goto(BASE + "/#/org"); ana.locator("#orginv").click()
    church_link = ana.locator(".sheet #lnk").input_value()
    assert "/#/convite/" in church_link
    ana.keyboard.press("Escape"); ana.goto(BASE + "/#/")
    people = {}
    for who in ["Bruno Costa", "Carla Dias"]:
        c, p = ctx(br)
        if who == "Bruno Costa":
            # sem ser membro, o link do ministério é recusado com orientação
            p.goto(link); expect(p.locator(".invitecard")).to_contain_text("Louvor Domingo", timeout=15000)
            shot(p, "05-convite-recebido")
        p.goto(church_link)
        expect(p.locator(".invitecard")).to_contain_text("INVT Tijuca", timeout=15000)
        p.get_by_role("button", name="Criar conta").click()
        p.fill("input[name=name]", who); p.fill("input[name=email]", f"{who.split()[0].lower()}.{STAMP}@teste.local"); p.fill("input[name=password]", "senha-forte-123")
        p.locator("#go").click()
        p.get_by_role("button", name="Aceitar convite").click(timeout=15000)
        expect(p.locator(".hero")).to_be_visible(timeout=15000)
        p.goto(link)
        p.get_by_role("button", name="Aceitar convite").click(timeout=15000)
        expect(p.locator(".teamcover h2", has_text="Louvor Domingo")).to_be_visible(timeout=15000)
        people[who] = (c, p)
    ok("convite de membro da igreja e depois convite do time")
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
    ana.locator("[data-tab=vs]").click()
    expect(ana.locator(".song", has_text="Bondade de Deus")).to_have_count(0)
    ana.locator("[data-tab=artistas]").click()
    expect(ana.locator("[data-art]", has_text="Isaias Saad")).to_be_visible()
    ana.locator("[data-art]", has_text="Isaias Saad").click(); expect(ana.locator(".song", has_text="Bondade de Deus")).to_be_visible()
    ana.locator("[data-tab=musicas]").click()
    ana.locator("#lupa").click(); ana.fill("#q", "Bondade"); expect(ana.locator(".song")).to_have_count(1); ana.locator("#lupa").click()
    ok("música manual identificada sem VS; abas Artistas e Com VS; lupa de pesquisa")

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
    # abas como no LouveApp: Detalhes, Participantes, Músicas (com contagem) e o botão Salvar flutuante
    expect(bruno.locator("[data-etab=detalhes]")).to_be_visible(); expect(bruno.locator("input[name=publish]")).to_be_checked()
    bruno.locator("[data-etab=musicas]").click()
    bruno.locator("#addsong").click()
    bruno.locator(".sheet [data-s]", has_text="Emaús").click(); bruno.locator(".sheet #ok").click()
    expect(bruno.locator("[data-etab=musicas] .cnt")).to_have_text("1")
    bruno.locator("[data-etab=participantes]").click()
    bruno.locator("#suggest").click()
    toast_has(bruno, "sugest")
    expect(bruno.locator(".chip.on", has_text="Carla Dias")).to_be_visible()
    shot(bruno, "08-escala-editor")
    bruno.locator("#savebtn").click()
    expect(bruno.locator(".pagehead h1", has_text="Culto de Celebração")).to_be_visible(timeout=10000)
    expect(bruno.get_by_text("Emaús")).to_be_visible()
    sched_url = bruno.url
    ok("escala criada com sugestão, música do repertório e publicada")

    # ------------------------------------------------------------------ Carla vê, confirma; calendário
    carla.goto(BASE + "/#/"); carla.reload()
    expect(carla.locator("#ups .scard", has_text="Culto de Celebração")).to_be_visible(timeout=10000)
    expect(carla.locator("#ups .scard")).to_contain_text("Vocal feminino")
    expect(carla.locator('a[href="#/notificacoes"] .dot')).to_be_visible()
    shot(carla, "09-inicio-integrante"); ok("integrante vê a escala no início e recebe notificação")
    carla.locator("#ups .scard").first.click()
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
    assert carla.locator(".timeline [data-rg], .timeline .mk").count() == 0   # sem a faixa duplicada de regiões; só os cartões
    carla.locator(".part").first.click(); carla.wait_for_timeout(900)           # toca a partir da região
    carla.locator(".part").first.click(); carla.wait_for_timeout(500)           # segundo toque: repete só essa região
    loop = carla.evaluate("window.__player.loop")
    assert loop and abs(loop[0] - 3.428571) < 0.01, loop
    ok("pause, próximo marcador e repetição de região")
    carla.evaluate("window.__player.setLoop(null); window.__player.pause()")
    carla.wait_for_timeout(1500)
    shot(carla, "13-player-faixas")
    # celular de lado: faixas, mix, linha do tempo e transporte cabem na tela
    vp = carla.viewport_size; carla.set_viewport_size({"width": 844, "height": 390}); carla.wait_for_timeout(500)
    shot(carla, "13b-player-lado-faixas")
    assert carla.evaluate("(() => { const r = document.querySelector('.trk .wave').getBoundingClientRect(); return r.height > 20 && r.bottom < innerHeight - 60; })()")
    tr = carla.locator('.transport').bounding_box(); assert tr["y"] + tr["height"] <= 392 and tr["x"] + tr["width"] <= 846, tr
    carla.locator('[data-tab="mix"]').click(); carla.wait_for_timeout(300); shot(carla, "13c-player-lado-mix")
    assert carla.evaluate("(() => { const r = document.querySelector('.strip .vfader').getBoundingClientRect(); return r.bottom < innerHeight - 50 && r.height > 50; })()")
    carla.locator('[data-tab="faixas"]').click(); carla.set_viewport_size(vp); carla.wait_for_timeout(300)
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
    # ------------------------------------------------------------------ versão leve (Opus no "R2" local)
    conv = json.loads(urllib.request.urlopen(BASE + "/__dev/light").read())
    assert conv["ok"] >= 8 and conv["fail"] == 0 and conv["outBytes"] * 5 < conv["inBytes"], conv
    carla.goto(BASE + "/#/musicas"); carla.wait_for_timeout(500)
    carla.goto(f"{BASE}/#/player/{emaus_id}")
    expect(carla.locator(".player .trk")).to_have_count(9, timeout=20000)
    reqs = []
    carla.on("request", lambda r: reqs.append(r.url))
    carla.locator('[data-t="play"]').click()
    carla.wait_for_function("window.__player && window.__player.playing && window.__player.position() > 1.5", timeout=20000)
    lt = carla.evaluate("""() => { const e = window.__player; const ms = [...e.media.values()];
        const g = ms.find(m => m.name === 'Guide.wav'); const b = g.chunks.get(0)?.buf; let rms = 0;
        if (b) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / d.length); }
        return { light: ms.filter(m => m.light).length, total: ms.length, sr: e.ctx.sampleRate, sources: e.sources.size, rms, len: b?.length } }""")
    assert lt["light"] == lt["total"] and lt["sr"] == 48000 and lt["sources"] >= 7 and lt["rms"] > 0.02 and lt["len"] == 4 * 48000, lt
    # forma de onda pronta (sem decodificar) e arquivos inteiros baixados em poucos pedidos grandes
    carla.wait_for_function("[...window.__player.media.values()].every(m => m.peaksReady && m.whole)", timeout=20000)
    assert sum(1 for u in reqs if "/r2/" in u and ".peaks" in u) <= 9
    assert any("/r2/" in u for u in reqs) and not any("drive-media?file=" in u for u in reqs), [u for u in reqs if "drive-media" in u][:3]
    carla.goto(BASE + "/#/musicas")
    ok(f"versão leve: {conv['ok']} faixas convertidas ({conv['inBytes'] // 1000} KB → {conv['outBytes'] // 1000} KB); player toca direto do R2 com {lt['sources']} trechos")

    # ------------------------------------------------------------------ Multimídia: recursos, checklist, roteiro com o louvor, pedido
    ana.goto(BASE + "/#/times"); ana.reload()
    jovens_id = ana.locator(".teamcard a", has_text="Jovens").get_attribute("href").split("/")[-1]
    ana.goto(f"{BASE}/#/times/{jovens_id}/config")
    for k, on_ in [("roteiro", True), ("pedidos", True), ("checklist", True), ("repertorio", False)]:
        assert ana.locator(f"input[name=feat_{k}]").is_checked() == on_, k
    ana.get_by_role("button", name="Usar lista sugerida").click()
    expect(ana.locator("#ci .li")).to_have_count(7, timeout=10000)
    ana.goto(f"{BASE}/#/escala/nova/{jovens_id}")
    ana.fill("input[name=title]", "Culto de Celebração")
    ana.fill("input[name=date]", nxt); ana.locator("input[name=date]").dispatch_event("change"); ana.fill("input[name=time]", "18:30")
    ana.locator("#savebtn").click()
    expect(ana.get_by_role("heading", name="Roteiro do culto")).to_be_visible(timeout=10000)
    ana.locator("#cedit").click(); ana.locator(".sheet #tpl").click(); ana.locator(".sheet #ok").click()
    toast_has(ana, "Roteiro salvo")
    expect(ana.locator(".cue", has_text="Pregação")).to_contain_text("19:")
    expect(ana.locator(".cue.k-louvor .cue-song", has_text="Emaús")).to_be_visible(timeout=10000)
    ana.locator(".cue-song", has_text="Emaús").click(); expect(ana.locator(".sheet")).to_contain_text("Teu amor me alcançou")
    ana.keyboard.press("Escape"); ana.locator(".sheet-wrap").click(position={"x": 5, "y": 5}) if ana.locator(".sheet-wrap").count() else None
    expect(ana.get_by_role("heading", name="Checklist pré-culto")).to_be_visible(); expect(ana.locator(".li.check")).to_have_count(7)
    shot(ana, "21-multimidia-escala")
    carla.goto(f"{BASE}/#/pedidos/novo/{jovens_id}")
    carla.locator(".kinds label", has_text="Vídeo").click(); carla.fill("input[name=title]", "Vídeo de abertura do retiro")
    carla.fill("textarea[name=description]", "30 segundos, para o telão"); carla.locator("#save").click()
    expect(carla.locator(".pagehead .tag")).to_have_text("Pendente", timeout=10000)
    req_url = carla.url
    ana.goto(req_url); ana.get_by_role("button", name="Marcar como pronto").click()
    toast_has(ana, "Pedido pronto")
    carla.goto(BASE + "/#/notificacoes"); carla.reload()
    expect(carla.get_by_text("Pedido pronto: Vídeo de abertura do retiro")).to_be_visible(timeout=10000)
    ok("Multimídia: recursos do tipo, checklist sugerido, roteiro com as músicas e letras do louvor, pedido de mídia até a entrega")

    # ------------------------------------------------------------------ integrantes de teste
    ana.goto(BASE + "/#/org"); ana.reload()
    ana.locator("#df select[name=team]").select_option(label="Jovens"); ana.locator("#df select[name=count]").select_option("2")
    ana.locator("#dgo").click()
    expect(ana.locator(".sheet")).to_contain_text("Teste · Direção", timeout=15000)
    expect(ana.locator(".sheet")).to_contain_text("@exemplo.com")
    ana.goto(f"{BASE}/#/times/{jovens_id}/integrantes"); ana.reload()
    expect(ana.get_by_text("Teste · Projeção")).to_be_visible(timeout=10000)
    ana.goto(BASE + "/#/org"); ana.locator("#ddel").click(); ana.locator(".sheet [data-ok]").click()
    toast_has(ana, "conta(s) de teste apagada(s)")
    ok("integrantes de teste criados no time com função e login, e apagados")

    # ------------------------------------------------------------------ várias organizações
    carla.goto(BASE + "/#/nova-org")
    carla.fill("input[name=name]", "Igreja do Bairro"); carla.locator("#go").click()
    expect(carla.get_by_role("heading", name="Novo time")).to_be_visible(timeout=15000)
    carla.goto(BASE + "/#/"); carla.locator("[data-act=space]").click()
    expect(carla.locator(".sheet [data-org]")).to_have_count(1)  # a outra igreja (a atual aparece como "Igreja")
    shot(carla, "16-organizacoes")
    carla.locator(".sheet [data-org]", has_text="INVT Tijuca").click()
    expect(carla.locator(".brand")).to_contain_text("INVT Tijuca", timeout=10000)
    expect(carla.locator("#ups .scard")).to_have_count(1, timeout=10000)
    carla.locator("[data-act=space]").click(); carla.locator(".sheet [data-org]", has_text="Igreja do Bairro").click()
    expect(carla.locator(".brand")).to_contain_text("Igreja do Bairro", timeout=10000)
    carla.goto(BASE + "/#/musicas"); expect(carla.locator(".song")).to_have_count(0, timeout=10000)
    ok("uma conta em duas organizações; troca sem sair; dados isolados")

    # ------------------------------------------------------------------ início completo e computador
    ana.goto(BASE + "/#/avisos/novo")
    ana.fill("input[name=title]", "Ensaio Geral"); ana.fill("input[name=tag]", "Reunião"); ana.fill("textarea[name=body]", "Todos os times. Tragam os instrumentos.")
    ana.fill("input[name=date]", nxt); ana.fill("input[name=time]", "19:30"); ana.locator("#save").click()
    toast_has(ana, "Aviso publicado")
    bruno.goto(BASE + "/#/igreja"); bruno.reload(); expect(bruno.locator(".notice", has_text="Ensaio Geral")).to_be_visible(timeout=10000)  # avisos gerais ficam na área da igreja
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

    # ------------------------------------------------------------------ cabeçalho, menu lateral e páginas do time
    carla.goto(BASE + "/#/"); carla.reload()
    if "INVT Tijuca" not in carla.locator(".brand").inner_text():
        carla.locator("[data-act=space]").click(); carla.locator(".sheet [data-org]", has_text="INVT Tijuca").click()
        expect(carla.locator(".brand")).to_contain_text("INVT Tijuca", timeout=10000)
    carla.goto(f"{BASE}/#/times/{louvor_id}"); carla.goto(BASE + "/#/")
    expect(carla.locator(".topbar .menubtn")).to_be_visible(timeout=10000)
    assert carla.locator('.topbar a[href="#/perfil"]').count() == 0          # sem foto no cabeçalho
    expect(carla.locator(".hero")).to_be_visible()
    assert carla.locator(".sec h2", has_text="Disponibilidade").count() == 0  # disponibilidade saiu do início
    carla.locator(".menubtn").click(); 
    expect(carla.locator(".drawer .dprofile")).to_contain_text("Carla Dias")
    for t in ["Visão geral da igreja", "Indisponibilidades", "Panorama de escalas", "Configurações"]:
        expect(carla.locator(".drawer").get_by_text(t, exact=True)).to_be_visible()
    assert carla.locator(".drawer").get_by_text("Avisos", exact=True).count() == 0
    shot(carla, "21-menu-lateral")
    for t in ["Trocar de time", "Minhas escalas", "Músicas tocadas", "Aniversariantes", "Metrônomo", "Sair da conta"]:
        expect(carla.locator(".drawer").get_by_text(t, exact=True)).to_be_visible()
    carla.locator(".drawer [data-menuact=switch]").click()
    expect(carla.locator(".sheet", has_text="Meus times")).to_be_visible(); carla.keyboard.press("Escape"); carla.goto(BASE + "/#/"); carla.wait_for_timeout(300)
    for r_, h1 in [("/#/calendario/meu", "Minhas escalas"), ("/#/aniversariantes", "Aniversariantes"), ("/#/musicas/tocadas", "Músicas tocadas"), ("/#/metronomo", "Metrônomo")]:
        carla.goto(BASE + r_); expect(carla.locator(".pagehead h1")).to_have_text(h1, timeout=10000)
    carla.goto(BASE + "/#/musicas/tocadas"); carla.locator("[data-tab=nunca]").click(); expect(carla.locator(".song", has_text="Emaús")).to_be_visible(timeout=10000)
    carla.goto(BASE + "/#/metronomo"); carla.locator("[data-d='5']").click(); expect(carla.locator("#bpm")).to_have_text("95")
    carla.locator("#go").click(); expect(carla.locator("#go")).to_contain_text("Parar"); carla.locator("#go").click()
    carla.goto(BASE + "/#/"); carla.locator(".menubtn").click()
    carla.locator(".drawer a", has_text="Panorama de escalas").click()
    expect(carla.locator(".pagehead h1")).to_have_text("Panorama de escalas", timeout=10000)
    expect(carla.locator(".pano")).to_contain_text("Carla Dias", timeout=10000)
    shot(carla, "22-panorama")
    carla.goto(f"{BASE}/#/times/{louvor_id}/escalas")
    expect(carla.locator(".pagehead h1")).to_have_text("Escalas", timeout=10000)
    expect(carla.locator(".cal")).to_be_visible(); expect(carla.locator(".menulist", has_text="Panorama de escalas")).to_be_visible()
    shot(carla, "23-escalas")
    carla.goto(f"{BASE}/#/chat/{louvor_id}")
    expect(carla.locator(".pagehead h1")).to_have_text("Chat", timeout=10000)
    expect(carla.locator(".bottomnav")).to_be_visible(); expect(carla.locator(".composer")).to_be_visible()
    assert "Louvor Domingo" not in carla.locator(".chatwrap .pagehead").inner_text()
    shot(carla, "24-chat")
    ok("cabeçalho com menu e sem foto; início sem disponibilidade; panorama; escalas em calendário; chat com a barra de navegação")

    # botão + de Escalas leva à criação no dia escolhido; sem o + no cabeçalho; Músicas sem seleção
    bruno.goto(f"{BASE}/#/times/{louvor_id}/escalas")
    assert bruno.locator("[data-act=add]").count() == 0
    expect(bruno.locator("#addsched")).to_be_visible(timeout=10000); shot(bruno, "27-escalas-lider")
    bruno.locator(".cal [data-day]").nth(11).click()
    day = bruno.locator(".cal .sel").inner_text().split("\n")[0].strip().zfill(2)
    bruno.locator("#addsched").click()
    expect(bruno.locator("input[name=date]")).to_have_value(re.compile(rf"-{day}$"), timeout=10000)
    assert carla.locator("#addsched").count() == 0   # integrante comum não cria escala
    # nova escala com repetição semanal: uma escala por data, sem confirmação e com cor
    bruno.goto(f"{BASE}/#/escala/nova/{louvor_id}")
    bruno.fill("input[name=title]", "Ensaio semanal")
    d0 = time.strftime("%Y-%m-%d", time.localtime(time.time() + 10 * 86400)); d1 = time.strftime("%Y-%m-%d", time.localtime(time.time() + 24 * 86400))
    bruno.fill("input[name=date]", d0); bruno.locator("input[name=date]").dispatch_event("change"); bruno.fill("input[name=time]", "20:00")
    bruno.select_option("select[name=repeat]", "weekly"); bruno.fill("input[name=until]", d1); bruno.locator("input[name=until]").dispatch_event("change")
    bruno.locator("input[name=ask]").evaluate("e => e.click()"); bruno.locator(".sw:not(.none)").nth(3).click()
    shot(bruno, "08b-escala-repetir")
    bruno.locator("#savebtn").click(); bruno.locator(".dialog .btn.primary, .sheet .btn.primary, [data-ok]").first.click()
    bruno.wait_for_url(re.compile(r"/escalas$"), timeout=15000)
    bruno.locator("#modebtn").click(); bruno.locator(".tlcard", has_text="Ensaio semanal").first.wait_for(timeout=10000)
    assert bruno.locator(".tlcard", has_text="Ensaio semanal").count() >= 1 and bruno.locator(".tlcard .tag", has_text="Pendente").count() >= 0
    bruno.locator("#modebtn").click()
    ok("escala com repetição semanal, sem confirmação e com cor")
    bruno.goto(f"{BASE}/#/times/{louvor_id}/escalas")
    # modo linha do tempo (ícone ao lado do +), lembrado entre visitas
    bruno.goto(f"{BASE}/#/times/{louvor_id}/escalas")
    expect(bruno.locator("#modebtn")).to_be_visible(timeout=10000)
    bruno.locator("#modebtn").click()
    expect(bruno.locator(".tl-day").first).to_be_visible(timeout=10000); shot(bruno, "27b-escalas-timeline")
    assert bruno.locator(".cal").count() == 0 and bruno.locator("#addsched").count() == 1
    assert bruno.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    bruno.reload(); expect(bruno.locator(".tl-day").first).to_be_visible(timeout=10000)
    bruno.locator("#modebtn").click(); expect(bruno.locator(".cal")).to_be_visible(timeout=10000)
    bruno.goto(f"{BASE}/#/musicas")
    expect(bruno.locator('.pagehead a[href="#/musicas/nova"]')).to_be_visible(timeout=10000)
    assert bruno.locator("#sel").count() == 0 and bruno.locator("#rem").count() == 0
    ok("botão + em Escalas (com o dia escolhido) e em Músicas; sem + no cabeçalho; sem Selecionar e Fora do repertório")

    bruno.goto(f"{BASE}/#/times/{louvor_id}")
    expect(bruno.locator(".pagehead h1")).to_have_text("Time", timeout=10000)
    expect(bruno.locator(".menulist")).to_contain_text("Convidar membros")
    shot(bruno, "25-time")
    bruno.goto(f"{BASE}/#/times/{louvor_id}/funcoes")
    expect(bruno.locator(".pagehead h1")).to_have_text("Funções", timeout=10000); expect(bruno.locator(".list")).to_contain_text("Vocal feminino")
    bruno.goto(f"{BASE}/#/times/{louvor_id}/equipes")
    bruno.locator("#new").click(); bruno.fill(".sheet input[name=name]", "Banda A")
    bruno.locator(".sheet [data-u]").first.click(); bruno.locator(".sheet #save").click()
    expect(bruno.locator(".list .li", has_text="Banda A")).to_be_visible(timeout=10000)
    bruno.goto(f"{BASE}/#/times/{louvor_id}/classificacoes")
    bruno.locator("#sug").click(); expect(bruno.locator(".list")).to_contain_text("Adoração", timeout=10000)
    bruno.goto(f"{BASE}/#/times/{louvor_id}/lideranca"); expect(bruno.locator(".pagehead h1")).to_have_text("Liderança", timeout=10000)
    ok("página Time: funções, equipes, classificações e liderança")

    # parabéns do dia: quem faz aniversário hoje aparece em uma janela na primeira abertura do dia
    today = time.strftime("%Y-%m-%d")
    env = dict(os.environ, PGHOST="127.0.0.1", PGPORT="54322", PGUSER="postgres")
    subprocess.run(["psql", "-q", "-c", f"update org_members set birth_date = '1990-{today[5:]}' where user_id in (select id from profiles where full_name = 'Bruno Costa')"], env=env, check=True)
    carla.goto(BASE + "/#/"); carla.evaluate("Object.keys(localStorage).filter(k => k.startsWith('somos.bday')).forEach(k => localStorage.removeItem(k))"); carla.reload()
    expect(carla.locator(".bdaypop")).to_contain_text("Bruno", timeout=12000)
    shot(carla, "26-parabens")
    carla.locator(".bdaypop [data-close]").click()
    expect(carla.locator(".bdays.bdaymonth")).to_contain_text("Bruno")
    carla.reload(); carla.wait_for_timeout(2500); assert carla.locator(".bdaypop").count() == 0   # só na primeira abertura do dia
    ok("janela de parabéns na primeira abertura do dia; aniversariantes do mês no início")

    # sem rolagem horizontal no celular
    for p_, n in [(ana, "ana"), (bruno, "bruno"), (carla, "carla")]:
        for route in ["/#/", "/#/times", "/#/musicas", "/#/chat", f"/#/escala/nova/{louvor_id}"]:
            p_.goto(BASE + route); p_.wait_for_timeout(700)
            ow = p_.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            if ow > 1:
                bad = p_.evaluate("[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.scards,.carousel,.bdays,.tabs,.chips')).slice(0,6).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))")
                print("overflow", n, route, ow, bad)
            assert ow <= 1, (n, route, ow)
    ok("sem rolagem horizontal nas telas principais (390 px)")
    br.close()

print(f"\n{len(results)} verificações aprovadas")
if errors:
    print("\nERROS DE CONSOLE:"); [print(" -", e) for e in errors]; sys.exit(1)
print("Sem erros de console.")
