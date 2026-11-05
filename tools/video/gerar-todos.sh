#!/usr/bin/env bash
# Regrava todos os tutoriais em vídeo (ambiente local, dados fictícios). Uso: bash tools/video/gerar-todos.sh [slug ...]
cd "$(dirname "$0")/../.."
pkill -f "dev/serve.ts" 2>/dev/null; sleep 1
bash dev/stack.sh reset >/tmp/claude-0/stack.log 2>&1
(bun dev/serve.ts >/tmp/claude-0/serve.log 2>&1 &); sleep 4
bun tools/video/preparar.ts > /tmp/claude-0/conta.json || exit 1
SLUGS=${@:-"criar-escala confirmar-escala panorama letras-midia pacote-culto roteiro-culto checklist-pre-culto pedir-midia atender-pedido criancas visitantes"}
for s in $SLUGS; do echo "== $s"; python3 -u tools/video/gravar.py "$s" /tmp/claude-0/conta.json 2>&1 | tail -4; done
echo FIM
