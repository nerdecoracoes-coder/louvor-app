import time
TITLE = "Como baixar o pacote do culto"
ABOUT = "Baixar de uma vez as letras e os slides de todas as músicas do culto."
USER = "ana"; START = "midia"

def run(r, p, acc, expect):
    r.say("O pacote do culto reúne tudo do domingo. Primeiro, toque em Escalas.", lambda: r.click(p.locator('.bottomnav a[data-nav=escalas]')))
    p.wait_for_selector(".cal, .tl-day")
    r.say("Abra a escala do culto.", lambda: p.goto(__import__("os").environ.get("BASE", "http://127.0.0.1:8080") + f"/#/escala/{acc['sched']['midia']}"))
    p.wait_for_selector(".dtitle")
    r.say("Toque em Pacote do culto.", lambda: r.click(p.locator("[data-goto=pkg]")))
    r.say("Pronto. O arquivo traz a ordem do culto, um PowerPoint com todas as músicas e um arquivo para cada música.", None)
