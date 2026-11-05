import time
TITLE = "Como preparar as letras para a projeção"
ABOUT = "Ajustar fonte, cores e partes da letra e baixar em PowerPoint."
START = "midia"

def run(r, p, acc, expect):
    r.say("Para preparar as letras em casa, toque em Time, na barra de baixo.", lambda: r.click(p.locator('.bottomnav a[data-nav=time]')))
    r.say("Toque em Letras para a mídia.", lambda: r.click(p.locator("a", has_text="Letras para a mídia")))
    r.say("Aqui estão as músicas que o Louvor cadastrou, já divididas em partes. Escolha uma.", lambda: r.click(p.locator("#ll .li", has_text="Emaús")))
    p.wait_for_selector(".thumb")
    r.say("Você pode editar o texto de cada parte. Para separar, deixe uma linha em branco entre elas.", lambda: r.click(p.locator("#ltxt")))
    r.say("Escolha a fonte da letra.", lambda: (r.click(p.locator("#sfont")), p.select_option("#sfont", "Verdana")))
    r.say("Escolha a cor do fundo e a cor da letra.", lambda: (r.click(p.locator('[data-sw="bg:#0B1F3A"]')), r.click(p.locator('[data-sw="color:#FFE066"]'))))
    r.say("Defina quantas linhas aparecem em cada slide. Veja a prévia logo abaixo.", lambda: (r.click(p.locator("#sper")), p.select_option("#sper", "1")))
    r.say("Toque em PowerPoint para baixar o arquivo. Depois é só abrir no programa de projeção.", lambda: r.click(p.locator("#dpptx")))
    r.say("Toque em Salvar minha versão. A letra original do Louvor continua igual.", lambda: r.click(p.locator("#save")))
