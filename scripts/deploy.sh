#!/usr/bin/env bash
# Deploy script for Sabor +58 — publishes the current working tree to production.
# Usage: ./scripts/deploy.sh [--push] [--commit] [--test]
#
# WARNING: This script does NOT touch Neon (database) or .env by default.
# The deploy only commits + pushes code; database migrations must be applied
# separately with explicit consent.
#
# Exit codes: 0 = success, 1 = test failure, 2 = git error

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf "${GREEN}[deploy]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[deploy]${NC} %s\n" "$*"; }
err()  { printf "${RED}[deploy]${NC} %s\n" "$*"; }

COMMIT=false
PUSH=false
TEST=true

usage() {
  cat <<EOF
Usage: $0 [--push] [--commit] [--no-test] [--help]

Options:
  --commit   Stage and commit all changes (default: no commit)
  --push     Push to remote (default: no push)
  --no-test  Skip the test suite
  --help     Show this help message

Examples:
  $0                  # dry run: tests only, no commit/push
  $0 --commit --push  # full publish: tests → commit → push
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT=true; shift ;;
    --push)   PUSH=true; shift ;;
    --no-test) TEST=false; shift ;;
    --help)   usage; exit 0 ;;
    *) err "Unknown option: $1"; usage; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── 1. Test suite ──────────────────────────────────────────────
if $TEST; then
  log "Running test suite..."
  if npm test; then
    log "Tests passed ✓"
  else
    err "Tests failed — aborting deploy"
    exit 1
  fi
else
  warn "Tests skipped (--no-test)"
fi

# ── 2. Sanity checks ───────────────────────────────────────────
log "Running sanity checks..."

# Check for mojibake (UTF-8 corruption)
if grep -rl $'\xc3\x83' --include='*.js' --include='*.html' --include='*.md' . 2>/dev/null | grep -v '.impeccable/' | grep -v node_modules | grep -q .; then
  err "Mojibake detected in source files — aborting"
  exit 2
fi

# Check for Colombia locale tokens (should be es-VE / America/Caracas)
if grep -rl "es-CO\|America/Bogota\|currency: 'COP'" --include='*.js' --include='*.html' . 2>/dev/null | grep -v '.impeccable/' | grep -v node_modules | grep -q .; then
  warn "Colombia locale tokens found — verify these are intentional"
fi

# Check for duplicate trailing content (PowerShell $' bug)
if grep -rl "new Intl.NumberFormat('es-VE'.*new Intl.NumberFormat('es-VE'" --include='*.html' . 2>/dev/null | grep -q .; then
  err "Duplicate content detected — possible corruption"
  exit 2
fi

log "Sanity checks passed ✓"

# ── 3. Commit (optional) ───────────────────────────────────────
if $COMMIT; then
  log "Staging changes..."
  git add -A

  log "Generating commit message..."
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
  COMMIT_MSG="deploy: ${TIMESTAMP}

- Dropdown de método de pago: fix de contraste en <option>
- Cola: FIFO + aging badges + legibilidad de cocina
- Cierre de caja: panel pre-cierre vivo + confirmación de dos pasos
- Localización: es-VE / America/Caracas (no rieles de pago)"

  git commit -m "$COMMIT_MSG" || warn "Commit failed or nothing to commit"
  log "Committed ✓"
else
  warn "Skipping commit (--commit not set)"
fi

# ── 4. Push (optional) ─────────────────────────────────────────
if $PUSH; then
  if ! git remote get-url origin >/dev/null 2>&1; then
    err "No remote 'origin' configured — cannot push"
    exit 2
  fi

  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  log "Pushing to $BRANCH..."
  git push origin "$BRANCH"
  log "Pushed ✓"
else
  warn "Skipping push (--push not set)"
fi

# ── 5. Summary ─────────────────────────────────────────────────
log "Deploy summary:"
git status --short
echo ""
log "Done."