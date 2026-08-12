#!/usr/bin/env bash
# Gamemaster installer — local free game coding LLM (Ollama)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BLUE='\033[1;34m'; GREEN='\033[1;32m'; YEL='\033[1;33m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YEL}!${NC} $*"; }

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Gamemaster — Installation                           ║"
echo "║  Three.js worlds · Seeker · Shaders · \$0 · offline   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

MEM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%d", $1/1024/1024/1024}' || echo 16)
info "Hardware: ~${MEM_GB:-?} GB memory"

PROFILE="max"
for arg in "$@"; do
  case "$arg" in
    --max|--30b|--moe) PROFILE="max" ;;
    --dense|--32b|--quality) PROFILE="dense" ;;
    --dual|--all) PROFILE="dual" ;;
    --14b|--balanced) PROFILE="balanced" ;;
    --7b|--fast) PROFILE="fast" ;;
  esac
done

case "$PROFILE" in
  max)      BASE_MODEL="qwen3-coder:30b"; CTX=65536 ;;
  dense)    BASE_MODEL="qwen2.5-coder:32b"; CTX=65536 ;;
  dual)     BASE_MODEL="qwen3-coder:30b"; CTX=65536 ;;
  balanced) BASE_MODEL="qwen2.5-coder:14b"; CTX=32768 ;;
  fast)     BASE_MODEL="qwen2.5-coder:7b"; CTX=32768 ;;
esac

if [[ "${MEM_GB:-0}" -lt 24 && "$PROFILE" == "max" ]]; then
  warn "Under 24GB RAM — switching to 14B."
  PROFILE="balanced"
  BASE_MODEL="qwen2.5-coder:14b"
  CTX=32768
fi

if ! command -v ollama >/dev/null 2>&1; then
  info "Installing Ollama…"
  if command -v brew >/dev/null 2>&1; then
    brew install ollama
  else
    echo "Install Ollama from https://ollama.com/download"
    exit 1
  fi
fi
ok "Ollama: $(ollama --version 2>/dev/null | head -1)"

if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  info "Starting Ollama…"
  if [[ "$(uname)" == "Darwin" ]]; then
    open -a Ollama 2>/dev/null || (ollama serve >/tmp/ollama-serve.log 2>&1 &)
  else
    ollama serve >/tmp/ollama-serve.log 2>&1 &
  fi
  for i in {1..50}; do
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 0.4
  done
fi
curl -sf http://127.0.0.1:11434/api/tags >/dev/null || { echo "Ollama API not reachable"; exit 1; }
ok "API online"

mkdir -p "$ROOT/config"
cat > "$ROOT/config/ollama-env.sh" <<'ENV'
# Gamemaster TURBO — source before heavy sessions
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=24h
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_BATCH=512
export OLLAMA_SCHED_SPREAD=false
ENV
ok "Performance env: config/ollama-env.sh"

pull_one() {
  local m="$1"
  info "Pulling $m …"
  ollama pull "$m"
  ok "ready: $m"
}

pull_one "$BASE_MODEL"
if [[ "$PROFILE" == "dual" ]]; then
  pull_one "qwen2.5-coder:32b"
fi
if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qE '^qwen2.5-coder:7b'; then
  info "Pulling flash tier qwen2.5-coder:7b …"
  ollama pull qwen2.5-coder:7b || warn "7b optional — skipped"
fi
if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qE '^nomic-embed-text'; then
  ollama pull nomic-embed-text || true
fi

TMP_MF=$(mktemp)
sed -e "s|^FROM .*|FROM ${BASE_MODEL}|" \
    -e "s|^PARAMETER num_ctx .*|PARAMETER num_ctx ${CTX}|" \
    "$ROOT/Modelfile" > "$TMP_MF"

CUSTOM="gamemaster"
info "Creating $CUSTOM from $BASE_MODEL (ctx=$CTX)…"
ollama create "$CUSTOM" -f "$TMP_MF"
rm -f "$TMP_MF"
ok "Model: $CUSTOM"

if [[ "$PROFILE" == "dual" ]] || [[ "$PROFILE" == "dense" ]]; then
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qE '^qwen2.5-coder:32b'; then
    TMP2=$(mktemp)
    sed -e "s|^FROM .*|FROM qwen2.5-coder:32b|" \
        -e "s|^PARAMETER num_ctx .*|PARAMETER num_ctx 65536|" \
        "$ROOT/Modelfile" > "$TMP2"
    ollama create gamemaster-dense -f "$TMP2"
    rm -f "$TMP2"
    ok "Extra: gamemaster-dense (32B)"
  fi
fi

cat > "$ROOT/config/active-profile.json" <<JSON
{
  "profile": "$PROFILE",
  "base_model": "$BASE_MODEL",
  "custom_model": "$CUSTOM",
  "num_ctx": $CTX,
  "updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

chmod +x "$ROOT/bin/"* "$ROOT/install.sh" "$ROOT/start" "$ROOT/START.command" 2>/dev/null || true

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sfn "$ROOT/bin/gamemaster" "$BIN_DIR/gamemaster"
ln -sfn "$ROOT/start" "$BIN_DIR/gm"
ln -sfn "$ROOT/bin/agent.py" "$BIN_DIR/gamemaster-agent"
ln -sfn "$ROOT/bin/studio.py" "$BIN_DIR/gamemaster-studio"
ln -sfn "$ROOT/bin/playtest.py" "$BIN_DIR/gamemaster-playtest"
ln -sfn "$ROOT/bin/prefs.py" "$BIN_DIR/gamemaster-prefs"
ln -sfn "$ROOT/bin/turbo.py" "$BIN_DIR/gamemaster-turbo"
ln -sfn "$ROOT/bin/self-update.py" "$BIN_DIR/gamemaster-update"
ln -sfn "$ROOT/bin/worldclaw.py" "$BIN_DIR/gamemaster-worldclaw"
ln -sfn "$ROOT/bin/github.py" "$BIN_DIR/gamemaster-github"
ok "CLI: gamemaster · gm"

if ! command -v gh >/dev/null 2>&1; then
  warn "GitHub CLI (gh) not found — ship needs it: brew install gh && gamemaster github login"
elif ! command -v git >/dev/null 2>&1; then
  warn "git not found — install Xcode CLT or git"
else
  ok "GitHub: gh $(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
fi

if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  SHELL_RC="${HOME}/.zshrc"
  [[ -n "${BASH_VERSION:-}" ]] && SHELL_RC="${HOME}/.bashrc"
  if [[ -f "$SHELL_RC" ]] && ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
    echo '' >> "$SHELL_RC"
    echo '# Gamemaster' >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
    warn "PATH updated in $SHELL_RC — open a new terminal or: source $SHELL_RC"
  fi
fi

info "Smoke test…"
SMOKE=$(ollama run "$CUSTOM" "Reply with exactly: GAMEMASTER_OK" 2>/dev/null | tr -d '\r' | head -5)
echo "   → $SMOKE"
ok "Install complete (profile: $PROFILE / $BASE_MODEL)"

cat <<EOF

${GREEN}══════════════════════════════════════════════════════${NC}
  Gamemaster is ready.

  Start:     ./start   or   gamemaster
  Chat:      gamemaster "Village slice: walk, NPC dialogue, ragdoll"
  Studio:    gamemaster studio build -p ./my-game "open-world village"
  Scaffold:  gamemaster scaffold world-game --name Wilds
  World:     gamemaster worldclaw generate -p ./Wilds "coast + pines"
  GitHub:    gamemaster github login && gamemaster ship -p ./Wilds
  Tests:     python3 tests/run.py
  Playtest:  gamemaster playtest -p ./my-game --critic
  Turbo:     gamemaster turbo warmup

  Profiles: ./install.sh --dual | --max | --dense | --14b | --7b
${GREEN}══════════════════════════════════════════════════════${NC}
EOF
