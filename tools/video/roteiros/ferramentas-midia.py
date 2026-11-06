import time
TITLE = "Como criar imagens, vídeos e legendas"
ABOUT = "Editor de imagem, vídeos prontos e legendas no Estúdio de mídia."
USER = "ana"; START = "midia"; AUDIO = "v3"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai conhecer as ferramentas do Estúdio de mídia para criar imagens, vídeos e legendas.")
    r.say("Abra o Estúdio de mídia e toque em Ferramentas.", lambda: (r.click(p.locator("[data-act=menu]")), r.click(p.locator(".drawer a", has_text="Estúdio de mídia"))))
    p.wait_for_selector("#new")
    r.say("No editor de imagem, escolha uma foto, corte, ajuste e salve.", lambda: r.click(p.locator("a", has_text="Editor de imagem")))
    p.wait_for_selector("#pick, #cv, #png")
    r.say("Para criar um vídeo pronto, escolha o modelo, escreva o texto e toque em Gerar vídeo.", lambda: (p.go_back(), p.wait_for_selector("#new"), r.click(p.locator("a", has_text="Vídeos prontos")), p.wait_for_selector("#gen"), r.click(p.locator("#kind")), r.type(p.locator("#title"), "Culto de domingo")))
    r.say("Para as legendas, escreva o texto com os tempos e toque em Baixar legenda.", lambda: (p.go_back(), p.wait_for_selector("#new"), r.click(p.locator("a", has_text="Legendas")), p.wait_for_selector(".pagehead h1")))
    r.say("Os arquivos ficam prontos para usar na transmissão ou na projeção. Pronto!", lambda: p.go_back())
