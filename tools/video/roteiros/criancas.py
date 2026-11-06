import time
TITLE = "Como cadastrar crianças e fazer entrada e saída"
ABOUT = "Cadastro com alergias e responsável, entrada com código e saída segura."
USER = "ana"; START = "infantil"; AUDIO = "criancas"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a cadastrar crianças e a fazer a entrada e a saída.")
    r.say("No Ministério Infantil, toque em Crianças, na barra de baixo.", lambda: r.click(p.locator('.bottomnav a[data-nav=criancas]')))
    r.say("Toque em Cadastrar para incluir uma criança.", lambda: r.click(p.locator("#addkid")))
    r.say("Preencha o nome da criança, o responsável e o telefone dele.", lambda: (r.type(p.locator(".sheet input[name=name]"), "Lia Souza"), r.type(p.locator(".sheet input[name=guardian_name]"), "Marta Souza"), r.type(p.locator(".sheet input[name=guardian_phone]"), "21999990000")))
    r.say("Escreva as alergias e cuidados. Eles aparecem em vermelho para toda a equipe.", lambda: r.type(p.locator(".sheet input[name=allergies]"), "amendoim"))
    r.say("Toque em Salvar.", lambda: r.click(p.locator(".sheet button.primary")))
    code = {}
    r.say("No dia do culto, toque em Entrada quando a criança chegar.", lambda: r.click(p.locator("[data-in]").first))
    p.wait_for_selector(".kcode"); code["v"] = p.locator(".kcode").inner_text().strip()
    r.say("O aplicativo mostra um código. Entregue ao responsável, porque ele será pedido na saída.", lambda: r.click(p.locator(".sheet [data-close]")))
    r.say("Na hora de entregar, toque em Saída.", lambda: r.click(p.locator("[data-out]").first))
    r.say("Digite o código que o responsável mostrar e toque em Confirmar saída. Pronto!", lambda: (r.type(p.locator("#kc"), code["v"]), r.click(p.locator("#kok"))))
