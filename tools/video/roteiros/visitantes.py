import time
TITLE = "Como registrar visitantes"
ABOUT = "Registrar quem visita a igreja e acompanhar o contato."
USER = "ana"; START = "diaconal"; AUDIO = "visitantes"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a registrar os visitantes da igreja.")
    r.say("No time de Diáconos, toque em Visitantes, na barra de baixo.", lambda: r.click(p.locator('.bottomnav a[data-nav=visitantes]')))
    r.say("Toque em Registrar para anotar um visitante.", lambda: r.click(p.locator("#addv")))
    r.say("Escreva o nome e o telefone.", lambda: (r.type(p.locator(".sheet input[name=name]"), "Paulo Lima"), r.type(p.locator(".sheet input[name=phone]"), "21988887777")))
    r.say("Escolha como ele conheceu a igreja.", lambda: (r.click(p.locator(".sheet select[name=how_known]")), p.select_option(".sheet select[name=how_known]", "Convite de alguém")))
    r.say("Toque em Salvar.", lambda: r.click(p.locator(".sheet button.primary")))
    r.say("Depois do culto, abra o visitante para ligar ou chamar no WhatsApp.", lambda: r.click(p.locator("[data-v]").first))
    r.say("Marque Contatado quando falar com ele, e Integrado quando ele passar a participar. Pronto!", lambda: r.click(p.locator("[data-st=contatado]")))
