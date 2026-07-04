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

  echo ""
  echo "=== [+] Smoke (carga en runtime del backend) ==="
  # Los tests mockean los services y no cargan los modelos reales; un import
  # roto en ESM (p.ej. named export inexistente) pasa test+build y solo revienta
  # en `pnpm dev`. Este smoke importa la app y los modelos reales sin mocks.
  pnpm --filter @nach/backend smoke
  echo "→ OK"
fi

echo ""
if [ "$MODE" = "full" ]; then
  echo "✓ Verificación completa pasó (deps + lint + typecheck + test + build + smoke)."
else
  echo "✓ Verificación rápida pasó. (usa './init.sh full' para incluir test + build)"
fi
