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

## 4. Categoria do time: Ministério da igreja × Ocasião especial (definido em 04/11/2026)
- Ao criar um time, o administrador escolhe a **categoria**:
  - **Ministério da igreja**: só podem entrar **membros cadastrados** da igreja. O link de convite do time
    não serve para quem não é membro (a pessoa precisa antes receber o convite de membro da igreja).
  - **Ocasião especial**: podem ser convidadas pessoas que **não são membros** (ex.: músicos das filiais).
    Elas entram como **convidados**: participam só daquele time (escalas, chat, repertório e player),
    não viram membros da igreja e não aparecem nas listas da igreja.
- Quem convida: o **líder do time** (e o administrador).
- Convidado aparece no time como "Convidado · Igreja de origem". Acesso permanente por padrão, com data de término opcional.
- A confirmar: o time Chega Mais (culto jovem, usado sempre, com membros de filiais) entra como "Ocasião especial"?
- Status: **a implementar** no próximo pacote.

## 5. Foto de perfil dos membros (anotado em 04/11/2026)
- Todo membro deve conseguir colocar foto no perfil. Hoje existe o botão "Trocar foto" em Meu perfil (tocar no avatar
  no canto superior direito), mas ele não ficou visível/fácil para o usuário.
- Fazer: deixar a opção de foto evidente (tocar na própria foto no perfil e na tela inicial), oferecer no primeiro acesso
  e conferir o envio no Supabase real (Storage).
- Status: **a implementar** no próximo pacote.

## Implementado em 04/11/2026
- [x] Textos do app: "organização" → "igreja" (nome da igreja, cadastrar igreja, configurações da igreja…).
- [x] Campo **Tipo de time** (Louvor, Multimídia, Ministério Diaconal, Recepção, Ministério Infantil, Intercessão, Outro) no lugar da descrição.
- [x] Repertório, menu Músicas, player, músicas na escala e música no chat exclusivos de times de Louvor (regra também no banco).
- [x] O administrador cadastra os times da igreja sem precisar participar deles; no cadastro escolhe o **líder** (ou define depois).
- [x] Só o administrador geral define ou remove líderes (regra também no banco).
- [x] **Membros da igreja**: convite da igreja (sem time). A entrada nos times é só por convite/inclusão do líder ou do administrador; ninguém solicita entrada.
- [x] **Funções por tipo de time**: as funções atuais ficaram como funções do Louvor; novas funções podem ser criadas para cada tipo (ou para todos).

## 4. Entrada nos times e convidados de outras igrejas (definido, 04/11/2026)
- Regra geral: só **membros da igreja** podem ser adicionados a um time.
- Escolhida a opção **Convidado do time**: a pessoa de outra igreja (ex.: filiais) entra só naquele time
  (escalas, chat, repertório e player daquele time), **não** vira membro da igreja e não aparece nas listas da igreja.
- O acesso do convidado é **permanente por padrão** (ex.: time "Chega Mais", do culto jovem, que mistura membros
  da igreja e de filiais e é usado sempre). Opcionalmente, uma data de término para casos pontuais (culto especial).
- Mostrar no time que a pessoa é convidada e de qual igreja ela vem.
- **Quem convida**: o líder do time (e o administrador).
- Status: **a implementar** junto com as próximas melhorias.
