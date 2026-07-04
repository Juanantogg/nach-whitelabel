#!/usr/bin/env bash
# Health check del monorepo. Dos modos:
#   ./init.sh        (quick) → deps + lint + typecheck. Arranque de sesión.
#   ./init.sh full   (full)  → lo anterior + test + build. Cierre de sesión.
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-quick}"

echo "=== [1/3] Dependencias ==="
if [ ! -d "node_modules" ]; then
  echo "→ node_modules no existe, instalando..."
  pnpm install --frozen-lockfile
else
  echo "→ OK"
fi

echo ""
echo "=== [2/3] Lint ==="
pnpm lint
echo "→ OK"

echo ""
echo "=== [3/3] Type-check ==="
pnpm typecheck
echo "→ OK"

if [ "$MODE" = "full" ]; then
  echo ""
  echo "=== [+] Tests ==="
  pnpm test
  echo "→ OK"

  echo ""
  echo "=== [+] Build ==="
  pnpm build
  echo "→ OK"
fi

echo ""
if [ "$MODE" = "full" ]; then
  echo "✓ Verificación completa pasó (deps + lint + typecheck + test + build)."
else
  echo "✓ Verificación rápida pasó. (usa './init.sh full' para incluir test + build)"
fi
