import time
TITLE = "Como marcar um evento do time"
ABOUT = "Marcar reunião ou fraternização e confirmar presença."
USER = "ana"; START = "louvor"; AUDIO = "v4"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a marcar uma reunião ou uma fraternização para o seu time.")
    r.say("No menu do time, toque em Eventos do time.", lambda: (r.click(p.locator("[data-act=menu]")), r.click(p.locator(".drawer a", has_text="Eventos do time"))))
    p.wait_for_selector("#new")
    r.say("Toque em Marcar.", lambda: r.click(p.locator("#new")))
    p.wait_for_selector("#ef")
    r.say("Escolha o tipo: reunião, fraternização, ensaio, estudo ou outro.", lambda: (r.click(p.locator("#ef [name=kind]")), p.select_option("#ef [name=kind]", "fraternizacao")))
    r.say("Escreva o título e escolha a data, a hora e o local.", lambda: (r.type(p.locator("#ef [name=title]"), "Fraternização do louvor"), r.type(p.locator("#ef [name=location]"), "Casa do João")))
    r.say("Toque em Salvar. Todo o time recebe um aviso.", lambda: r.click(p.locator("#esave")))
    p.wait_for_selector(".evt")
    r.say("Quem recebe abre o evento e responde: Vou, Talvez ou Não vou.", lambda: (r.click(p.locator(".evt").first), p.wait_for_selector("[data-ans]"), r.click(p.locator("[data-ans=vou]"))))
    r.say("O líder acompanha, na mesma tela, quem já respondeu. Pronto!", lambda: p.mouse.wheel(0, 400))
