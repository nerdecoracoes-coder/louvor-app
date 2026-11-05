import time
TITLE = "Como criar uma escala"
ABOUT = "Passo a passo para montar uma escala, escolher os participantes e as músicas."

def run(r, p, acc, expect):
    nxt = time.strftime("%Y-%m-%d", time.localtime(time.time() + 4 * 86400))
    r.say("Vamos criar uma escala. Toque em Escalas, na barra de baixo.", lambda: r.click(p.locator('.bottomnav a[href*="/escalas"]')))
    r.say("Toque no botão mais para criar uma nova escala.", lambda: r.click(p.locator("#addsched")))
    p.wait_for_selector("input[name=title]")
    r.say("Escreva o nome do culto.", lambda: r.type(p.locator("input[name=title]"), "Culto de Domingo"))
    def datas():
        r.click(p.locator("input[name=date]")); p.fill("input[name=date]", nxt); p.locator("input[name=date]").dispatch_event("change"); time.sleep(1.2)
        r.click(p.locator("input[name=time]")); p.fill("input[name=time]", "19:00")
    r.say("Escolha a data e o horário de início. O término é opcional.", datas)
    r.say("Agora vamos escolher quem participa. Toque na aba Participantes.", lambda: r.click(p.locator("[data-etab=participantes]")))
    r.say("Toque em Sugerir escala e o aplicativo monta a equipe sozinho, pelas funções de cada pessoa.", lambda: r.click(p.locator("#suggest")))
    r.say("Revise os nomes. Para trocar alguém, toque no cartão da função.", None)
    r.say("Agora, na aba Músicas, escolha o repertório.", lambda: r.click(p.locator("[data-etab=musicas]")))
    def musica():
        r.click(p.locator("#addsong")); p.locator(".sheet [data-s]", has_text="Emaús").first.wait_for(); time.sleep(0.8)
        r.click(p.locator(".sheet [data-s]", has_text="Emaús").first); time.sleep(0.4); r.click(p.locator(".sheet #ok"))
    r.say("Toque em Adicionar músicas e marque as que vão ser tocadas.", musica)
    r.say("Pronto. Toque em Salvar. Os participantes recebem o aviso da escala.", lambda: r.click(p.locator("#savebtn")))
    p.wait_for_selector(".dtitle", timeout=15000)
    r.say("A escala está publicada. Aqui você vê os detalhes, as músicas e quem está escalado.", lambda: r.click(p.locator("[data-dtab=par]")))
