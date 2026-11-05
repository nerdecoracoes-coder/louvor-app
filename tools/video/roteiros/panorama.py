TITLE = "Como ver o Panorama de escalas"
ABOUT = "Ver quem foi escalado no mês e filtrar por dia e horário."
START = "louvor"

def run(r, p, acc, expect):
    r.say("O Panorama mostra o mês inteiro. Abra o menu, no canto de cima.", lambda: r.click(p.locator("[data-act=menu]")))
    r.say("Toque em Panorama de escalas.", lambda: r.click(p.locator(".drawer a", has_text="Panorama de escalas")))
    p.wait_for_selector(".pgrid")
    r.say("Cada coluna é um dia com escala, e cada linha é uma função. As fotos mostram quem está escalado.", None)
    r.say("O número mostra quantas pessoas serviram no mês. Toque nele para ver quantas vezes cada uma foi escalada.", lambda: r.click(p.locator("#ppeople")))
    r.say("Toque fora para fechar. Agora vamos usar o filtro, no canto de cima.", lambda: (p.locator(".sheet-wrap").click(position={"x": 5, "y": 5}), time.sleep(0.5), r.click(p.locator("#pfilter"))))
    r.say("Escolha a faixa de horas, um membro, ou os dias da semana que você quer ver.", lambda: r.click(p.locator("[data-dow='1']")))
    r.say("Toque em Aplicar e a tabela volta já filtrada.", lambda: r.click(p.locator("#fapply")))
import time
