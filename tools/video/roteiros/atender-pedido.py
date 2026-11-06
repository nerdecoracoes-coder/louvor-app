import time
TITLE = "Como atender um pedido de mídia"
ABOUT = "Acompanhar os pedidos e avisar quando estiver pronto."
USER = "ana"; START = "midia"; AUDIO = "atender-pedido"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a atender um pedido de mídia.")
    r.say("Os pedidos da igreja chegam na aba Pedidos, aqui embaixo.", lambda: r.click(p.locator('.bottomnav a[data-nav=pedidos]')))
    p.wait_for_selector("#rl")
    r.say("Toque em um pedido para ver os detalhes.", lambda: r.click(p.locator("#rl > *").first))
    p.wait_for_selector("[data-st]")
    r.say("Toque em Começar quando for fazer.", lambda: r.click(p.locator("[data-st=fazendo]")))
    r.say("Quando terminar, toque em Marcar como pronto. Quem pediu recebe o aviso. Pronto!", lambda: r.click(p.locator("[data-st=pronto]")))
