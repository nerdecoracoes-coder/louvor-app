# SOMOS — Relatório final da expansão (Prompt mestre, Parte 16)

Data: 27/11/2026. Resultado da regressão geral: **732 testes automáticos aprovados, 0 falhas (51 arquivos)** e **teste de ponta a ponta (navegador) com 93 verificações nos temas escuro e claro, sem erros de console**.
Detalhes técnicos de cada fase: `docs/expansao-plataforma.md`. API e webhooks: `docs/api.md`.

## 1. Diagnóstico da arquitetura original
PWA em JavaScript puro (roteador por hash, service worker), hospedado no Cloudflare Pages; Supabase (Postgres) com tabelas fechadas por RLS e acesso por funções `security definer`. Três ambientes (SOMOS Um, Servos, Chamados) decididos no servidor. Já existiam: pessoas/famílias/jornadas/convertidos/segmentação/carteira, agenda simples, avisos, notificações, escalas do Louvor, times. Não existiam: células, programações, escalas gerais, eventos com inscrição, financeiro, cuidado pastoral, múltiplas igrejas, API/webhooks.

## 2. Pesquisa funcional da inChurch
**Limite:** o site e a documentação oficial não abriram neste ambiente. Foram usadas as descrições públicas dos apps Inchurch PRO e Control (App Store) e uma reportagem. O que não aparece nessas fontes está marcado "não confirmado" e foi tratado como **proposta própria** do SOMOS.

## 3. Matriz comparativa
Está em `docs/expansao-plataforma.md`, seção 2 (17 funcionalidades: confirmado / parcial / não confirmado × situação anterior × ação).

## 4. Funcionalidades existentes reaproveitadas
Segmentação (público de comunicados, destaques e eventos), Carteira, `announcements` e feed de avisos, `notify_user` e preferências, Pessoas/fichas, `my_access` e administradores, agenda simples (`church_events`, preservada), Escalas do Louvor (somente leitura), seletor de igreja, bucket de imagens, Edge Function `push-send` (estendida).

## 5. Funcionalidades novas implementadas
- **Fase 1:** Células (reuniões, presença, supervisão, relatórios), Programações (recorrência, exceções, ordem de atividades), Escalas gerais (convite, confirmação, substituição, conflitos).
- **Fase 2:** Eventos (inscrição, lista de espera, ingresso com QR, check-in, relatório e CSV).
- **Fase 3:** Financeiro (contas, categorias, centros de custo, campanhas, a pagar/receber, parcelas, aprovação, orçamento, relatórios, comprovantes privados).
- **Fase 4:** Comunicação (comunicados segmentados, agendados, fixados; preferências; pregações) e Cuidado com Pessoas (oração, intercessão, atendimento pastoral, trilha de acessos).
- **Correção:** "Decidi seguir a Jesus" com regra única de elegibilidade.
- **Fase 5:** Experiência Digital (conteúdos, planos de leitura com anotações e lembretes, busca integrada sem acento e com erro de digitação, atalhos, transmissão ao vivo por link, base do push).
- **Fase 6:** Múltiplas Igrejas (estrutura configurável, convite com consentimento, acesso por concessão, consolidado só com números) e Integrações (chaves de API, API v1 de leitura, webhooks assinados, logs, monitoramento).
- Menu inteligente por público e central de descoberta "Para você".

## 6. Alterações no banco de dados
Todas por migrações **aditivas** (nenhuma apaga ou altera dados existentes), com cópia em `supabase/setup/atualizacao-AAAA-MM-DD-*.sql`, cada uma terminando em consulta de verificação. Principais: 13+ permissões novas em `module_actions()`, tabela única de auditoria `mod_audit`, tabelas de células, programações, escalas, eventos/inscrições, financeiro, comunicação/pregações, cuidado, conteúdos/planos/ao vivo/push, estrutura de organizações (`parent_id`, grants, convites), integrações (chaves, webhooks, entregas, logs, heartbeats). Todas com RLS fechado e funções que conferem permissão no servidor.
Os SQLs de 12-11 a 12-14 foram convertidos para **ASCII puro** após descobrir que a colagem no SQL Editor corrompia acentos (ver item 12).

## 7. Arquivos criados e modificados
- **Migrações/SQLs:** `supabase/migrations/20261205…20261214*` e as cópias em `supabase/setup/`; `diagnostico-acentos.sql`; `banco-completo.sql` regenerado.
- **Telas (`app/views`):** celulas, programacoes, escalas, inscricoes, financeiro, comunicacao, cuidado, digital, destaques, instituicao, integracoes (+ ajustes em chamados, home, menu).
- **Bibliotecas:** `app/lib/mod-ui.js`, `cards.js`, `push.js`, `pessoas-import.js` (mensagens de erro).
- **Edge Functions:** `api`, `webhook-dispatch`, `_shared/integ.ts`, `push-send` (heartbeat); `supabase/config.toml`.
- **Outros:** `sw.js` (cache v166), `app/styles.css`, `dev/ascii-setup.py`.
- **Testes:** 51 arquivos em `tests/` + `tests/e2e.py`.
- **Docs:** `docs/expansao-plataforma.md`, `docs/api.md`, este relatório.

## 8. Integrações realizadas
- **Feitas e testadas na lógica:** API v1 (leitura) e webhooks assinados (HMAC-SHA256).
- **Feitas, aguardando configuração:** push (Web Push/VAPID), agendamento por `pg_cron`/Cron.
- **Por link:** transmissão ao vivo, vídeos e áudios (YouTube, Drive etc.).
- **Não implementadas (sem documentação, contrato ou credenciais):** pagamento (Pix/cartão), e-mail, WhatsApp/SMS. A tela de Integrações informa isso.

## 9. Permissões implementadas
Verificadas **no servidor** (funções), nunca só na tela. Administrador da igreja ou concessão explícita; liderança de time e **Desenvolvedor não têm acesso implícito**. Novas: células, programação, escalas (`roster_*`), `ev_view/manage/publish/checkin`, `fin_view/entry/approve/manage/donors`, `comm_manage/publish/sermons`, `care_prayer/pastoral/manage`, `discover_manage`, `dig_manage`, `integ_manage`; na estrutura: estruturar, consolidado e consolidado financeiro. Regras sensíveis: ninguém aprova o que lançou; gerir cuidado não lê pedidos; consolidado financeiro exige concessão própria e é auditado.

## 10. Testes executados
732 testes automáticos contra um Postgres real local (permissões, regras, isolamento entre igrejas, confidencialidade, idempotência, casos de erro) + a lógica das Edge Functions em Bun + e2e no navegador (Playwright) nos temas escuro e claro, incluindo capturas de tela de cada tela nova. Regressão dos módulos anteriores, incluindo o Ministério de Louvor, incluída nessa mesma bateria.

## 11. Resultados dos testes
- `bun test`: **732 aprovados / 0 falhas.**
- e2e escuro: **93 verificações aprovadas, sem erros de console.**
- e2e claro: **93 verificações aprovadas, sem erros de console.**
- Cada SQL de atualização: aplicado duas vezes localmente (idempotente), verificação `true`.
- Na produção, o seu SQL de melhorias digitais retornou `false` antes da correção de acentos; reaplicado em ASCII (ver item 12).

## 12. Problemas encontrados e corrigidos
- **Acentos corrompidos ao colar SQL no editor** (verificação `false`): arquivos convertidos para ASCII; conversão validada função a função (9 funções alteradas, todas idênticas ao esperado); criado `diagnostico-acentos.sql`.
- Conflito de mensagens de erro por trecho em comum (renomeados vários códigos).
- Falha de desenho no convite entre igrejas (exigia ser administrador dos dois lados) → convite de uso único com hash.
- Regra de profundidade inconsistente e erro de contagem no gatilho da estrutura.
- Contraste da etiqueta "Ativa" no tema claro; quebra de linha em etiquetas.
- Regras de "Decidi seguir a Jesus" unificadas no servidor.
- Itens menores de testes (campos obrigatórios, ordem de concessões).

## 13. Pendências técnicas
- Pagamento online, recibo/declaração anual, conciliação bancária.
- Push/e-mail/WhatsApp para comunicados e lembretes de evento.
- Upload de vídeo, áudio e PDF; leitura offline.
- Inscrição pública em evento sem login; eventos recorrentes.
- Relatórios detalhados e comparativos entre unidades; resumo pré-calculado para centenas de unidades.
- API com mais escopos (pessoas, financeiro) e OAuth.
- Fotos de bancos de imagem (ambiente bloqueia esses sites).

## 14. Recursos que dependem de configuração externa
1. Aplicar os SQLs no Supabase, na ordem (12-05 até 12-14), com "Run and enable RLS".
2. Deploy das Edge Functions `api`, `webhook-dispatch` e `push-send`.
3. Segredos: `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; chave pública no `config.js`.
4. Agendamentos: `webhook-dispatch` e `push-send` a cada 1–5 min; `pg_cron` ativo para comunicados agendados, lembretes de plano e limpeza de logs.
5. Confirmar um envio real de comprovante (Storage) no financeiro.
6. Provedores de pagamento, e-mail e mensagens (contrato, credenciais, documentação).

## 15. Situação final de cada módulo

| Módulo | Implementado | Testado | Parcial / Pendente |
|---|---|---|---|
| 1. Células | Sim | Sim (banco + telas) | Sem lembretes automáticos |
| 2. Programações e Escalas | Sim | Sim | Escala não recorrente; sem lembrete antes do horário |
| 3. Eventos | Sim | Sim | **Sem pagamento**; sem inscrição pública; sem recorrência |
| 4. Financeiro | Sim | Sim | **Sem pagamento online**; sem recibo anual nem conciliação; envio real de comprovante a confirmar |
| 5. Comunicação | Sim | Sim | **Sem push/e-mail externo** (push base pronta); agendamento depende de `pg_cron` |
| 6. Cuidado Pastoral | Sim | Sim | Sem lembrete de retorno |
| 7. Experiência Digital | Sim | Sim (banco + telas) | Push real **não testado**; sem upload de mídia |
| 8. Múltiplas Igrejas | Sim | Sim | Consolidado limitado aos indicadores listados |
| 9. Integrações | Sim | **Lógica e banco** testados | Execução no Deno do Supabase, DNS real, envio a servidor externo real e agendamento **não testados**; sem pagamento/e-mail/mensagens |
| Menu inteligente e "Decidi seguir a Jesus" | Sim | Sim | — |
| Ministério de Louvor | Intocado | Regressão aprovada | — |

**Fora do escopo, conforme o prompt:** Gestão de Ministérios e Equipes e Wayton Church Kids.
