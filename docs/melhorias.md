# Melhorias anotadas (para implementar depois da revisão do app)

## 1. Organização = a igreja (revisado em 04/11/2026)
- A organização representa a **igreja** (ex.: "INVT Tijuca"). Não muda para "Ministério".
- Ajustar os textos da criação/configuração para deixar isso claro (ex.: campo "Nome da igreja").
- ~~Trocar "Organização" por "Ministério"~~ — descartado.

## 2. Tipo de time (na criação e nas configurações do time)
- A página continua se chamando **Times**.
- O campo **Descrição** do time passa a ser um campo selecionável **Tipo de time**, com opções prontas
  (a refinar): Louvor, Ministério Diaconal, Multimídia, …
- Opção **"Outro"**, com campo para digitar um tipo que não esteja na lista.
- Ideia para avaliar depois: o tipo do time ligar/desligar partes do app (ex.: player multitrack e repertório para Louvor;
  Multimídia/Diaconal talvez usem só escalas, integrantes, chat e avisos) e sugerir funções padrão conforme o tipo
  (ex.: Louvor → Ministro, Guitarra…; Multimídia → Projeção, Câmera, Transmissão…).

## 3. Recursos por tipo de time × recursos gerais da igreja (direção definida em 04/11/2026)
A maior parte do que já existe faz sentido só para certos tipos de time. A estrutura passa a ser:
- **Recursos gerais da igreja** (para todos, antes dos times) — a definir. Rascunho para discutir:
  perfil, avisos da igreja, calendário geral, aniversariantes, bloqueio de datas, notificações, convites e administração.
- **Recursos de todo time** (rascunho): integrantes, escalas, chat, arquivos, avisos do time.
- **Recursos por tipo de time**:
  - Louvor: repertório/biblioteca, player multitrack, integração com o Google Drive, funções musicais, músicas na escala.
  - Multimídia, Ministério Diaconal e outros: recursos próprios a criar.
- Decidido em 04/11/2026:
  - **Repertório e o menu Músicas ficam exclusivos de alguns tipos de time** (a princípio, Louvor). Quem não participa
    de um time desses não vê o menu nem o repertório. O repertório continua um só por igreja, compartilhado entre esses times.
  - Abrir o repertório para a igreja toda fica para o futuro, quando houver um jeito que faça sentido para todos.
  - Os recursos dos outros tipos de time serão definidos depois de uma pesquisa com os líderes de cada time.
- A definir: quais tipos de time, além de Louvor, terão acesso ao repertório.

## Implementado em 04/11/2026
- [x] Textos do app: "organização" → "igreja" (nome da igreja, cadastrar igreja, configurações da igreja…).
- [x] Campo **Tipo de time** (Louvor, Multimídia, Ministério Diaconal, Recepção, Ministério Infantil, Intercessão, Outro) no lugar da descrição.
- [x] Repertório, menu Músicas, player, músicas na escala e música no chat exclusivos de times de Louvor (regra também no banco).
- [x] O administrador cadastra os times da igreja sem precisar participar deles; no cadastro escolhe o **líder** (ou define depois).
- [x] Só o administrador geral define ou remove líderes (regra também no banco).
- [x] **Membros da igreja**: convite da igreja (sem time). A entrada nos times é só por convite/inclusão do líder ou do administrador; ninguém solicita entrada.
- [x] **Funções por tipo de time**: as funções atuais ficaram como funções do Louvor; novas funções podem ser criadas para cada tipo (ou para todos).

## 4. Entrada nos times e convidados de outras igrejas (em discussão, 04/11/2026)
- Regra geral: só **membros da igreja** podem ser adicionados a um time.
- Caso especial: culto especial com músicos de igrejas filiais participando de um louvor.
- Opções levantadas:
  - **Convidado do time**: o líder gera um convite "de convidado". A pessoa entra só naquele time (escala, chat, repertório e player),
    não vira membro da igreja, não aparece nas listas da igreja e o acesso expira numa data definida (ex.: depois do culto).
  - **Filiais como igrejas no app**: cada filial é uma igreja própria; a pessoa da filial já tem conta e é convidada como convidada.
  - **Time temporário**: um time criado para o evento, com os convidados, arquivado depois da data.
- Decidir: qual opção, quem pode convidar convidados (só admin ou também o líder) e por quanto tempo o acesso vale.
