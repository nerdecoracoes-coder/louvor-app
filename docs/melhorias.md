# Melhorias anotadas (para implementar depois da revisão do app)

## 1. "Organização" passa a se chamar "Ministério" (pedido em 04/11/2026)
- Trocar no app todos os textos visíveis: "Criar organização" → "Criar novo ministério", "Organizações" → "Ministérios",
  "Administrador geral da organização" → "do ministério", seletor de organização → seletor de ministério etc.
- No banco os nomes internos podem continuar (`organizations`, `org_id`), para não refazer o que já foi testado; muda só o que o usuário vê.

## 2. "Subtítulo" vira "Tipo de ministério" (campo selecionável)
- Opções prontas (a refinar): Louvor, Multimídia, Equipe diaconal, … 
- Opção "Outro", com campo para digitar um tipo que não esteja na lista.
- Ideia futura: o app ser usado por várias áreas da igreja. Avaliar se o tipo de ministério liga/desliga módulos
  (ex.: player multitrack e repertório fazem sentido para Louvor; Multimídia/Diaconal talvez usem só escalas, times, chat e avisos)
  e se as funções padrão (Ministro, Guitarra…) mudam conforme o tipo.
