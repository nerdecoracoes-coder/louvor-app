import time, os
TITLE = "Como postar o devocional da semana"
ABOUT = "Gravar ou escolher o vídeo e postar para o time."
USER = "ana"; START = "louvor"; AUDIO = "v5"
VIDEO = "/tmp/claude-0/devocional-exemplo.mp4"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a postar o devocional da semana para o seu time.")
    r.say("No menu do time, toque em Devocional.", lambda: (r.click(p.locator("[data-act=menu]")), r.click(p.locator(".drawer a", has_text="Devocional"))))
    p.wait_for_selector("#post")
    r.say("Toque em Postar.", lambda: r.click(p.locator("#post")))
    p.wait_for_selector("#dtl")
    r.say("Escreva o título e uma mensagem curta.", lambda: (r.type(p.locator("#dtl"), "Devocional da semana"), r.type(p.locator("#dds"), "Uma palavra de ânimo para o time.")))
    def pick():
        with p.expect_file_chooser() as fc: r.click(p.locator("#dpick"))
        fc.value.set_files(VIDEO)
    r.say("Toque em Gravar ou escolher vídeo. Para vídeos grandes, escolha pelo gerenciador de arquivos do celular.", pick)
    r.say("Se preferir, cole o link de um vídeo do YouTube ou do Drive.", lambda: r.click(p.locator("#dlink")))
    r.say("Toque em Postar para o time e espere o envio terminar, com a tela ligada.", lambda: r.click(p.locator("#dok")))
    p.wait_for_selector(".li:has-text('Devocional da semana')", timeout=30000)
    r.say("O devocional aparece na tela Início de todo o time, e todos recebem um aviso. Pronto!", lambda: (p.goto("http://127.0.0.1:8080/#/"), p.wait_for_selector(".devo", timeout=15000)))
