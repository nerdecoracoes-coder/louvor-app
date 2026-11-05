import time
TITLE = "Como montar o roteiro do culto"
ABOUT = "Montar a ordem do culto com horários, responsáveis e as músicas do Louvor."
USER = "ana"; START = "midia"

def run(r, p, acc, expect):
    r.say("O roteiro mostra a ordem do culto para toda a equipe. Abra a escala da Multimídia.", lambda: p.goto(f"http://127.0.0.1:8080/#/escala/{acc['sched']['midia']}"))
    p.wait_for_selector(".dtitle")
    r.say("Toque na aba Roteiro.", lambda: r.click(p.locator("[data-dtab=rot]")))
    r.say("Toque em Montar.", lambda: r.click(p.locator("#cedit")))
    r.say("Use o modelo pronto e depois ajuste: abertura, louvor, avisos, oferta, pregação e encerramento.", lambda: r.click(p.locator(".sheet #tpl")))
    r.say("Toque em Salvar. As músicas do Louvor aparecem dentro do momento do louvor.", lambda: r.click(p.locator(".sheet #ok")))
