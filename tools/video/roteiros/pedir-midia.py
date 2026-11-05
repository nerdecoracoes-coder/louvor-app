import time
TITLE = "Como pedir uma arte ou um vídeo"
ABOUT = "Qualquer time pode pedir material à Multimídia."
USER = "ana"; START = "louvor"

def run(r, p, acc, expect):
    r.say("Para pedir uma arte, um vídeo ou slides, abra o menu.", lambda: r.click(p.locator("[data-act=menu]")))
    r.say("Toque em Pedir arte ou vídeo.", lambda: r.click(p.locator(".drawer a", has_text="Pedir arte ou vídeo")))
    p.wait_for_selector("input[name=title]")
    r.say("Escolha o que você precisa: arte, vídeo, slide ou foto.", lambda: r.click(p.locator(".kinds label", has_text="Vídeo")))
    r.say("Dê um nome ao pedido.", lambda: r.type(p.locator("input[name=title]"), "Vídeo de abertura do retiro"))
    r.say("Explique o que você quer e, se tiver, escolha a data limite.", lambda: r.type(p.locator("textarea[name=description]"), "Vídeo de 30 segundos para o telão"))
    r.say("Toque em Enviar pedido. A Multimídia recebe o aviso.", lambda: r.click(p.locator("#save")))
