import time
TITLE = "Como montar slides no Estúdio de mídia"
ABOUT = "Criar a apresentação do culto, escolher os tipos de slide e baixar em PowerPoint."
USER = "ana"; START = "midia"; AUDIO = "v1"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a montar os slides do culto aqui no Somos.")
    r.say("Abra o menu e toque em Estúdio de mídia.", lambda: (r.click(p.locator("[data-act=menu]")), r.click(p.locator(".drawer a", has_text="Estúdio de mídia"))))
    p.wait_for_selector("#new")
    r.say("Toque em Novo, dê um nome para a apresentação e comece a montar.", lambda: (r.click(p.locator("#new")), r.type(p.locator("#dt"), "Culto de domingo"), r.click(p.locator("[data-mode=blank]"))))
    p.wait_for_selector("#add")
    r.say("Para cada slide, escolha o tipo: letra, título, versículo, tópicos, aviso, contagem, imagem ou branco.", lambda: r.click(p.locator("#add")))
    r.say("Escreva o texto e confira a prévia logo acima.", lambda: (r.click(p.locator("[data-k=versiculo]")), r.type(p.locator("[data-f=text]"), "O Senhor é o meu pastor, nada me faltará."), r.type(p.locator("[data-f=ref]"), "Salmo 23.1")))
    r.say("Para mudar o fundo, toque em Fundos e escolha uma imagem da biblioteca da igreja.", lambda: (p.locator(".sheet-wrap:not(.out) [data-bgc]").nth(2).scroll_into_view_if_needed(), r.click(p.locator(".sheet-wrap:not(.out) [data-bgc]").nth(2))))
    p.wait_for_selector("#ok")
    r.say("Se precisar, arraste os slides para mudar a ordem.", lambda: (r.click(p.locator(".sheet-wrap:not(.out) #ok")), r.click(p.locator("#add")), r.click(p.locator("[data-k=aviso]")), r.click(p.locator(".sheet-wrap:not(.out) #ok")), r.click(p.locator("[data-dn='0']"))))
    r.say("Quando terminar, toque em Baixar PowerPoint e leve a apresentação para o programa de projeção. Pronto!", lambda: r.click(p.locator("#pptx")))
