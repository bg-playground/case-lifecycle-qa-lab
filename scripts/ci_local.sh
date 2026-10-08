#!/usr/bin/env bash
# Runs the same checks as .github/workflows/ci.yml, locally.
#
#   bash scripts/ci_local.sh            full run (npm ci + browsers + checks + tests)
#   SKIP_INSTALL=1 bash scripts/ci_local.sh   reuse node_modules and installed browsers
#
# gitleaks: uses $GITLEAKS_BIN if set, else `gitleaks` on PATH.
#
# Boundary private terms (never committed), one of:
#   BOUNDARY_PRIVATE_TERMS="term1
#   term2"                                   inline, one term per line
#   BOUNDARY_PRIVATE_TERMS_FILE=/path/to/terms.txt
#   .boundary-private-terms                  git-ignored file in the repo root
# Without terms the boundary check fails closed. Contributors without access can
# run with BOUNDARY_REQUIRE_PRIVATE_TERMS=false (generic rules only, loud warning).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n==> %s\n' "$*"; }

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  step "npm ci"
  npm ci --no-audit --no-fund
  step "playwright install chromium"
  npx playwright install chromium
fi

step "typecheck"
npm run -s typecheck

step "boundary check (self-test, then repo)"
npm run -s boundary -- --self-test
npm run -s boundary

step "gitleaks"
GITLEAKS="${GITLEAKS_BIN:-gitleaks}"
if ! command -v "$GITLEAKS" >/dev/null 2>&1; then
  echo "gitleaks not found. Install v8.30.1 from the gitleaks GitHub releases or set GITLEAKS_BIN." >&2
  exit 1
fi
"$GITLEAKS" dir . --no-banner --redact --exit-code 1 \
  --config .gitleaks.toml
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  "$GITLEAKS" git . --no-banner --redact --exit-code 1 --config .gitleaks.toml
fi

step "playwright tests (starts the mock via webServer)"
CI=true npx playwright test   # CI=true: no server reuse, same retries as CI

step "all checks passed"
