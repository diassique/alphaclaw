#!/usr/bin/env bash
# AlphaClaw — OpenClaw launcher
# Usage: bash openclaw-start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[alphaclaw]${NC} $*"; }
ok()    { echo -e "${GREEN}[alphaclaw]${NC} $*"; }
warn()  { echo -e "${YELLOW}[alphaclaw]${NC} $*"; }
fail()  { echo -e "${RED}[alphaclaw]${NC} $*"; exit 1; }

# ─── Prerequisites ─────────────────────────────────────────────────────────
info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 22+ from https://nodejs.org"
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js $NODE_MAJOR detected — AlphaClaw requires Node.js 22+."
fi
ok "Node.js v$(node -v | tr -d 'v') detected"

# ─── Install dependencies ─────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  info "Installing dependencies..."
  npm install --silent
  ok "Dependencies installed"
else
  info "node_modules found — skipping install"
fi

# ─── Install OpenClaw skill ───────────────────────────────────────────────
SKILL_DIR="$HOME/.openclaw/skills/alphaclaw"
if [ -d "skills/alphaclaw" ]; then
  mkdir -p "$SKILL_DIR"
  cp skills/alphaclaw/SKILL.md "$SKILL_DIR/SKILL.md"
  ok "Skill installed to $SKILL_DIR"
fi

# ─── Start services ───────────────────────────────────────────────────────
info "Starting AlphaClaw services..."
npx tsx src/start-all.ts &
PID=$!

# Wait for coordinator health check
info "Waiting for coordinator health check..."
RETRIES=0
MAX_RETRIES=30
until curl -s http://localhost:5000/health | grep -q '"status":"ok"' 2>/dev/null; do
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    warn "Coordinator did not respond after ${MAX_RETRIES}s — it may still be starting."
    break
  fi
  sleep 1
done

if [ "$RETRIES" -lt "$MAX_RETRIES" ]; then
  ok "Coordinator is healthy"
fi

# ─── Banner ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           AlphaClaw Network — Ready              ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Dashboard:  http://localhost:5000                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Hunt:       POST http://localhost:5000/hunt      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Stream:     GET  http://localhost:5000/stream    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Health:     GET  http://localhost:5000/health    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Skill:      ~/.openclaw/skills/alphaclaw/        ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Try: ${CYAN}curl -s -X POST http://localhost:5000/hunt -H 'Content-Type: application/json' -d '{\"topic\":\"bitcoin\"}' | jq .${NC}"
echo ""

# Keep running in foreground
wait $PID
