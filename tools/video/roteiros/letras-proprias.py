import time
TITLE = "Como criar a letra de uma música e definir o padrão da tela"
ABOUT = "Criar letras no time de Multimídia e ajustar como elas aparecem no telão."
USER = "ana"; START = "midia"; AUDIO = "v2"

def run(r, p, acc, expect):
    r.say("Neste vídeo, você vai aprender a criar uma letra e a definir como ela aparece no telão.")
    r.say("No menu do time de Multimídia, toque em Letras.", lambda: (r.click(p.locator("[data-act=menu]")), r.click(p.locator(".drawer a", has_text="Letras"))))
    p.wait_for_selector("#newl")
    r.say("Toque em Nova letra, escreva o título da música e cole o texto.", lambda: (r.click(p.locator("#newl")), r.type(p.locator("#nt"), "Grande é o Senhor"), r.click(p.locator("#nl")), p.keyboard.type("[Verso 1]\nGrande é o Senhor\nE digno de louvor", delay=40)))
    r.say("Para separar as partes, deixe uma linha em branco entre elas.", lambda: p.keyboard.type("\n\n[Refrão]\nCantai ao Senhor", delay=40))
    r.say("Se o time de Louvor já cadastrou a letra, ela aparece aqui, e você só precisa ajustar.", lambda: r.click(p.locator("#nok")))
    p.wait_for_selector("#ltxt")
    r.say("Para definir o padrão de toda a igreja, toque em Padrão da letra na tela.", lambda: (p.go_back(), p.wait_for_selector("#newl"), r.click(p.locator("a", has_text="Padrão da letra na tela"))))
    p.wait_for_selector("#pv .thumb")
    r.say("Ajuste o tamanho, a posição e a cor digitando os números. Todas as músicas passam a seguir esse padrão.", lambda: (r.click(p.locator("[data-seg='align:l']")), r.click(p.locator("#ok"))))
    r.say("Se uma música precisar ficar diferente, abra essa música e mude o layout só nela.", lambda: (p.go_back(), p.wait_for_selector("#newl"), r.click(p.locator("#ll .li", has_text="Grande é o Senhor")), p.wait_for_selector("#lcustom"), r.click(p.locator("#lcustom"))))
    r.say("Toque em Salvar. Pronto!", lambda: r.click(p.locator("#save")))
