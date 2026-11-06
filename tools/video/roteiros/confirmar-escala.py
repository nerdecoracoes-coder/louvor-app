TITLE = "Como confirmar que viu a escala"
ABOUT = "Abrir a escala em que você foi escalado e confirmar."
USER = "carla"; START = "louvor"; AUDIO = "confirmar-escala"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a confirmar que viu a sua escala.")
    r.say("Quando você é escalado, a escala aparece aqui no Início, em Minhas próximas escalas. Toque nela.", lambda: r.click(p.locator("#ups .scard").first))
    p.wait_for_selector(".dtitle")
    r.say("Aqui estão o dia, o horário e a sua função. Toque em Tomei conhecimento da escala, para avisar o líder que você viu.", lambda: r.click(p.locator("#seen")))
    r.say("Agora o líder sabe que você confirmou. Veja quem mais está escalado na aba Participantes.", lambda: r.click(p.locator("[data-dtab=par]")))
    r.say("As músicas estão na aba Músicas. Toque em uma música para abrir a cifra, a letra e o player. Pronto!", lambda: r.click(p.locator("[data-dtab=mus]")))
