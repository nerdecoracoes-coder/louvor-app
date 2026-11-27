# API pública e webhooks do SOMOS (v1)

Esta página é para quem vai conectar um site, um aplicativo ou outro sistema ao SOMOS. A administração cria as chaves e os endereços em **SOMOS Chamados → Integrações** (permissão `integ_manage`).

## 1. API de leitura (v1)

Somente leitura. Entrega apenas o que a igreja já publica para todos. **Não** entrega pessoas, financeiro, conteúdo restrito a membros, rascunhos nem dados de outra igreja. Cada chave pertence a uma igreja.

**Endereço base:** `https://<seu-projeto>.supabase.co/functions/v1/api/v1`

**Autenticação:** cabeçalho `Authorization: Bearer <chave>`. A chave na URL não é aceita (URLs ficam em logs de terceiros). Use a API só de servidor para servidor; não coloque a chave em página pública nem em app distribuído.

### Recursos

| Caminho | Escopo da chave | Conteúdo |
|---|---|---|
| `GET /v1/ping` | qualquer chave válida | Confere a chave e a conexão |
| `GET /v1/events` | `events:read` | Eventos publicados para todos: `id, title, description, location, starts_at, ends_at, image_url, registration` |
| `GET /v1/programs` | `programs:read` | Programações publicadas de visibilidade pública: `id, name, description, category, location, start_date, starts_time, ends_time, recurrence` |
| `GET /v1/sermons` | `sermons:read` | Pregações publicadas para todos: `id, title, preacher, preached_on, scripture, description, video_url, audio_url, image_url, series` |
| `GET /v1/contents` | `contents:read` | Conteúdos publicados para todos: `id, kind, title, description, category, url, image_url, published_at` |

**Paginação:** `?limit=` (1 a 100, padrão 50) e `?offset=` (0 em diante). A resposta traz `data`, `limit`, `offset` e `has_more`.

```json
{ "data": [ { "id": "…", "title": "Culto de Páscoa", "starts_at": "2026-12-20T22:00:00+00:00" } ], "limit": 50, "offset": 0, "has_more": false }
```

### Limite de requisições

Cada chave tem um limite por minuto (10 a 600; padrão 60), contado por minuto corrido. Toda resposta traz `X-RateLimit-Limit` e `X-RateLimit-Remaining`. Ao passar do limite: `429` com `Retry-After` (segundos).

### Erros

Sempre JSON: `{ "error": { "code": "…", "message": "…" } }`.

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `invalid_parameter` | `limit` ou `offset` inválidos |
| 401 | `invalid_key` | Sem cabeçalho, formato errado ou chave desconhecida (com `WWW-Authenticate`) |
| 401 | `revoked` / `expired` | Chave revogada ou vencida |
| 403 | `insufficient_scope` | A chave não tem o escopo do recurso |
| 404 | `not_found` | Caminho ou versão inexistente (só após autenticar) |
| 405 | `method_not_allowed` | Use GET |
| 429 | `rate_limited` | Passou do limite por minuto |
| 500 | `internal_error` | Falha interna (sem detalhes técnicos na resposta) |

### Versionamento

O prefixo `/v1` é estável: campos podem ser **acrescentados**, mas não removidos nem mudados de sentido. Mudança incompatível sai em `/v2`, com `/v1` mantida por um período anunciado. Toda resposta traz `X-API-Version`.

### Chaves

Mostradas **uma única vez** ao criar; no banco fica só o hash (SHA-256). Têm validade (90 dias, 1 ano ou sem validade), escopo e limite, e podem ser revogadas na hora. Não há limite de uso por IP nem OAuth nesta versão.

## 2. Webhooks

O SOMOS faz um `POST` para o seu endereço quando algo acontece. Só `https` com nome público; IP, `localhost`, nomes internos e redes privadas são recusados no cadastro **e** de novo antes de cada envio (após consultar o DNS). Redirecionamentos não são seguidos. Tempo máximo de resposta: 10 s; resposta `2xx` = entregue.

### Eventos

| Evento | Quando | Dados enviados |
|---|---|---|
| `person.created` | Pessoa cadastrada | `id, full_name, classification, status` |
| `person.updated` | Nome, classificação ou situação mudaram | os mesmos + `changed` |
| `event.created` | Evento criado | `id, title, starts_at, status, audience` |
| `registration.created` | Inscrição realizada | `id, event_id, status, guests, source` (sem nome) |
| `attendance.recorded` | Check-in de inscrição | `registration_id, event_id, checked_in_at, count` |
| `contribution.recorded` | Receita baixada | `id, amount, paid_at, category_id, campaign_id, method` (**nunca** pessoa ou doador). Só quem tem permissão financeira de gestão pode assinar |
| `program.published` | Programação pública publicada | `id, name, category, start_date, starts_time` |
| `webhook.test` | Botão "Testar" | `message` |

CPF, e-mail, telefone e endereço **nunca** são enviados.

### Formato

```json
{ "id": "evt_123", "type": "person.created", "created_at": "2026-11-27T12:00:00Z", "data": { "id": "…", "full_name": "Maria", "classification": "member", "status": "active" } }
```

Cabeçalhos: `X-Somos-Event`, `X-Somos-Delivery` (identificador da entrega; **o mesmo** em novas tentativas e reenvios, use para ignorar repetições), `X-Somos-Timestamp` (segundos) e `X-Somos-Signature`.

### Conferir a assinatura

`X-Somos-Signature` = `v1=` + HMAC-SHA256, em hexadecimal, de `"<timestamp>.<corpo bruto>"` com o segredo do endereço (`whsec_…`, mostrado uma vez). Confira com o **corpo bruto**, compare em tempo constante e recuse timestamps com mais de 5 minutos de diferença.

```js
// Node.js
import crypto from "node:crypto";
function ok(req, rawBody, secret) {
  const ts = req.headers["x-somos-timestamp"], sig = req.headers["x-somos-signature"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = "v1=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
```

```python
# Python
import hmac, hashlib, time
def ok(headers, raw_body: bytes, secret: str) -> bool:
    ts, sig = headers["X-Somos-Timestamp"], headers["X-Somos-Signature"]
    if abs(time.time() - int(ts)) > 300: return False
    want = "v1=" + hmac.new(secret.encode(), ts.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, want)
```

### Falhas e reenvio

Se o destino não responder `2xx`, o SOMOS tenta de novo após 1 min, 5 min, 30 min, 2 h e 12 h (6 tentativas no total). Depois a entrega fica **Abandonada** e pode ser reenviada em Integrações → Entregas (a tentativa recomeça; o destino recebe o mesmo `X-Somos-Delivery`). Após 30 falhas seguidas o endereço é desativado sozinho e a administração é avisada na tela. Entregas e logs guardam só situação, código de resposta e um texto curto; **nunca** o corpo da resposta, chaves ou segredos.

## 3. Colocar no ar (administração técnica)

1. Aplicar `supabase/setup/atualizacao-2026-12-14-integracoes.sql` (e antes dele os anteriores, na ordem do `docs/expansao-plataforma.md`).
2. Publicar as funções: `supabase functions deploy api` e `supabase functions deploy webhook-dispatch` (já têm `verify_jwt = false` em `supabase/config.toml`).
3. Secret `CRON_SECRET` (o mesmo usado no Drive e no push).
4. Agendar `webhook-dispatch` a cada minuto, com o cabeçalho `x-cron-secret`. Exemplo com `pg_cron` + `pg_net` (guarde o segredo no Vault do Supabase em vez de escrevê-lo na consulta):

```sql
select cron.schedule('somos-webhooks', '* * * * *', $$
  select net.http_post(url := 'https://<projeto>.supabase.co/functions/v1/webhook-dispatch',
                       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')) $$);
```

Sem o agendamento nada é enviado: os eventos ficam **Na fila** e a visão geral mostra "Nunca executou". A API (`api`) não precisa de agendamento.
