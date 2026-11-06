import time
TITLE = "Como usar o checklist pré-culto"
ABOUT = "Conferir os itens antes do culto e ver quem já marcou."
USER = "ana"; START = "midia"; AUDIO = "checklist-pre-culto"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a usar o checklist pré-culto.")
    r.say("Antes do culto, a equipe confere os itens do checklist. Abra a escala.", lambda: p.goto(f"http://127.0.0.1:8080/#/escala/{acc['sched']['midia']}"))
    p.wait_for_selector(".dtitle")
    r.say("Toque na aba Roteiro e role até o Checklist pré-culto.", lambda: r.click(p.locator("[data-dtab=rot]")))
    p.wait_for_selector(".li.check")
    r.say("Toque em cada item quando conferir. Todo mundo da equipe vê o que já foi marcado e por quem. Pronto!", lambda: [r.click(p.locator(".li.check").nth(i)) for i in range(3)])
