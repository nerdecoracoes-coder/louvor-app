# Somos — a igreja organizada em times

Aplicativo instalável (PWA) para organizações, times, escalas, repertório, chat e **player multitrack** dos projetos preparados no REAPER com Automate Pro.

Site estático publicado no **Cloudflare Pages** (endereço próprio, sem dividir espaço com outros apps) + **Supabase** (login, banco PostgreSQL com RLS, arquivos e funções). É um projeto **separado**: repositório próprio e projeto Supabase próprio, sem nenhum dado em comum com o Evolute.

```
index.html, sw.js, manifest.json, config.js   app instalável (sem etapa de build)
app/                                          telas, cliente Supabase e player
  player/engine.js                            motor de áudio multitrack (Web Audio API)
supabase/migrations/                          banco: tabelas, RLS, funções e gatilhos
supabase/functions/                           Edge Functions: drive-sync e drive-media
  _shared/rpp.ts                              leitor de projetos .RPP
  _shared/sync.ts                             sincronização com o Google Drive
supabase/setup/                               SQL pronto para colar no Supabase
tests/                                        testes automáticos (banco, importação, funções, navegador)
dev/                                          ambiente local de testes
```

---

## Colocar no ar (passo a passo, dá para fazer pelo navegador do celular)

### 1. Supabase (projeto novo)
1. Em [supabase.com](https://supabase.com) → **New project**. Anote a senha do banco.
2. **SQL Editor** → **New query** → cole todo o conteúdo de [`supabase/setup/banco-completo.sql`](supabase/setup/banco-completo.sql) → **Run**.
3. **Authentication → URL Configuration**:
   - *Site URL*: `https://somos-20g.pages.dev/`
   - *Redirect URLs*: o mesmo endereço.
4. (Opcional) **Authentication → Providers → Email**: deixe "Confirm email" ligado (mais seguro) ou desligue para entrar direto após o cadastro.
5. **Project Settings → API**: copie a *Project URL* e a chave *anon public*.

### 2. Configurar e publicar o app
1. No GitHub, abra `config.js` → lápis (editar) → preencha `supabaseUrl` e `supabaseAnonKey` → *Commit*.
   A chave *anon* é pública por natureza; quem protege os dados é o RLS do banco.
2. **Settings → Pages** → *Source: Deploy from a branch* → `main` / `/ (root)` → *Save*.
3. Em alguns minutos o app estará em `https://somos-20g.pages.dev/`.

### 3. Google Drive (acesso somente à pasta "multitracks")
1. Em [console.cloud.google.com](https://console.cloud.google.com): crie um projeto → **APIs e serviços → Biblioteca** → ative **Google Drive API**.
2. **IAM e administrador → Contas de serviço → Criar conta de serviço** (não precisa de papel nenhum).
3. Abra a conta criada → **Chaves → Adicionar chave → JSON**. Guarde o arquivo baixado.
4. Na conta Google da igreja, abra a pasta **multitracks** → **Compartilhar** → adicione o e-mail da conta de serviço (termina em `iam.gserviceaccount.com`) como **Leitor**.

> **Por que assim:** a conta de serviço é uma conta separada que não tem acesso a nada da conta da igreja. Ela só enxerga o que for compartilhado com o e-mail dela. Compartilhando apenas a pasta "multitracks" como Leitor, o app lê somente essa pasta (e o que estiver dentro) e **não consegue alterar** os projetos. O escopo pedido ao Google é `drive.readonly`; o alcance real fica limitado pelo compartilhamento. A chave fica em um *secret* do servidor e nunca chega ao navegador.

### 4. Publicar as funções do servidor
1. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**, crie:
   | Nome | Valor |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → Generate |
   | `SUPABASE_PROJECT_REF` | o identificador do projeto (o trecho `abcdefgh` de `https://abcdefgh.supabase.co`) |
   | `GOOGLE_SERVICE_ACCOUNT` | o conteúdo inteiro do arquivo JSON da conta de serviço |
   | `CRON_SECRET` | uma senha longa qualquer |
2. **Actions → Publicar no Supabase → Run workflow**.

### 5. Verificação automática a cada 5 minutos
No **SQL Editor**, abra [`supabase/setup/agendamento.sql`](supabase/setup/agendamento.sql), troque `SEU-PROJETO` e `SEU-SEGREDO` (o mesmo `CRON_SECRET`) e rode.

### 6. Primeiro uso
1. Abra o app, crie sua conta e **Criar uma organização** (você vira administrador geral).
2. Crie os times, convide os integrantes pelo link (copiar ou WhatsApp).
3. **Organização → Google Drive** → cole o link da pasta "multitracks" → **Conectar pasta**.

---

## Como a importação funciona

Cada pasta de música vira uma música. Ela pode ficar direto em "multitracks" ou dentro de uma pasta de cantor/grupo (os dois jeitos podem ser misturados):

```
multitracks/
  Morada/                                   pasta de cantor/grupo (só tem subpastas)
    Emaús/
      Emaús - Morada - 140 BPM (B).rpp
      Tracks 1/
        Click.wav  Guide.wav  Drums.wav ...
  Ousado Amor - Isaias Saad/                música direto na pasta principal
    Ousado Amor - Isaias Saad - 136 BPM (A).rpp
    ...
```

- Uma pasta com o .RPP ou áudios logo dentro dela é uma **música**; uma pasta só com subpastas é de um **cantor/grupo**, e cada subpasta dela é uma música.
- Se o nome do projeto não trouxer o artista, o nome da pasta do cantor/grupo é usado como artista.
- **Capa**: uma imagem (JPEG, PNG ou WebP) solta na pasta da música vira a capa no cartão. Se houver mais de uma, vale a que tiver "capa" ou "cover" no nome. A imagem é copiada para as imagens do app (o original fica intacto); uma capa enviada à mão pelo app tem prioridade.

- **Nome**: `Música - Artista - BPM (Tom)` → título, artista, BPM e tom extraídos automaticamente (ex.: "Emaús", "Morada", 140, "B"). Títulos com " - " são aceitos ("Te Louvarei - Ao Vivo - Morada - 140 BPM (B)"). Tom inválido ou nome fora do padrão vira aviso, nunca um dado inventado.
- **.RPP**: lê andamento, compasso, taxa de amostragem, faixas, pastas (ISBUS), volume, pan, mute, solo, inversão de fase, envio para o master, itens (posição, duração, deslocamento na fonte, volume, fades, takes), marcadores e regiões, volume do master.
- **Áudios**: cada `FILE` do projeto é associado ao arquivo da pasta, aceitando caminho relativo ("Tracks 1\Click.wav"), só o nome ("Click.wav") ou caminho absoluto do computador onde o projeto foi salvo ("C:\Users\...\Tracks 1\Click.wav"). O cabeçalho de cada WAV (16/24/32 bits, float, RF64) é lido para o player buscar só os trechos necessários.
- **Versões**: a música é identificada pelo ID da pasta no Drive (renomear não duplica). Projeto ou áudio alterado gera uma nova versão; as anteriores ficam no histórico.
- **Envio incompleto**: se o .RPP chegar antes dos áudios, a música fica "Aguardando arquivos" por até 20 minutos; depois vira erro registrado, com nova tentativa automática.
- **Exclusão**: pasta removida tira a música do repertório; escalas antigas mantêm título, artista e tom gravados.
- **Duplicidade**: mesma música e artista em outra pasta é sinalizada.
- **O que não é reproduzido** (fica registrado como aviso na música e no player, nada é descartado em silêncio): efeitos/plugins, automações de volume/pan/mute, envios entre faixas, alterações de velocidade (PLAYRATE), MIDI, mudanças de andamento na grade. O arquivo original **nunca** é alterado.

## Player
- Motor próprio em Web Audio API: todas as faixas no mesmo relógio, com precisão de amostra.
- Carrega trechos de 4 s por intervalo de bytes e descarta o que já passou: não precisa baixar nem decodificar a música inteira na memória (importante no celular). O que foi baixado fica no cache do navegador.
- Volume, pan, mute, solo (com pastas do REAPER), master, marcadores, regiões (toque para repetir), navegação.
- A mixagem salva no projeto do REAPER é aplicada; os ajustes do usuário ficam como **mix pessoal** (pode restaurar a do projeto).
- **Letra**: blocos cadastrados no app, com marcação de tempos durante a reprodução (destaque e rolagem automáticos). A track de letra dos projetos é detectada e seus dados brutos são guardados; a leitura automática será ativada **depois de analisarmos um projeto real** que tenha essa track.

---

## Desenvolvimento e testes

Ambiente local (Postgres 16 + Supabase Auth + PostgREST, sem Docker):

```bash
dev/stack.sh start          # banco + login + API (dev/stack.sh reset para zerar)
bun dev/serve.ts            # app em http://127.0.0.1:8080 (Drive simulado por uma pasta local)
bun test                    # banco/RLS, leitor .RPP, sincronização, funções
python3 tests/e2e.py        # fluxo completo no navegador (depois de dev/stack.sh reset)
```

Depois de mudar as migrações, rode `dev/combine.sh` para atualizar `supabase/setup/banco-completo.sql`.
