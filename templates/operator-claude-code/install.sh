#!/usr/bin/env bash
# SentinAI Operator Pack — one-line installer
#
# Usage (from your L2 node repo root):
#   curl -fsSL https://your-sentinai-instance/install-operator-pack.sh | bash
#   # or, locally:
#   bash /path/to/sentinai/templates/operator-claude-code/install.sh

set -euo pipefail

SENTINAI_BASE_URL="${SENTINAI_BASE_URL:-}"
SENTINAI_API_KEY="${SENTINAI_API_KEY:-}"
TARGET_DIR="${1:-$(pwd)}"

# ── Validate environment ───────────────────────────────────────────────────────
if [[ -z "$SENTINAI_BASE_URL" ]]; then
  echo "Error: SENTINAI_BASE_URL is not set."
  echo "  export SENTINAI_BASE_URL=http://my-sentinai.internal:3002"
  exit 1
fi

if [[ -z "$SENTINAI_API_KEY" ]]; then
  echo "Error: SENTINAI_API_KEY is not set."
  echo "  export SENTINAI_API_KEY=your-api-key"
  exit 1
fi

# ── Locate operator pack source ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing SentinAI Operator Pack into: $TARGET_DIR"

# ── Copy .claude/ (commands + agents) ─────────────────────────────────────────
if [[ -d "$SCRIPT_DIR/.claude" ]]; then
  cp -r "$SCRIPT_DIR/.claude" "$TARGET_DIR/"
  echo "  ✓ .claude/ ($(find "$TARGET_DIR/.claude" -type f | wc -l | tr -d ' ') files)"
fi

# ── Generate .mcp.json ─────────────────────────────────────────────────────────
MCP_JSON="$TARGET_DIR/.mcp.json"
cat > "$MCP_JSON" <<JSON
{
  "mcpServers": {
    "sentinai": {
      "type": "http",
      "url": "${SENTINAI_BASE_URL}/api/mcp",
      "headers": {
        "x-api-key": "${SENTINAI_API_KEY}"
      }
    }
  }
}
JSON
echo "  ✓ .mcp.json → ${SENTINAI_BASE_URL}/api/mcp"

# ── Append CLAUDE.md.snippet ───────────────────────────────────────────────────
SNIPPET="$SCRIPT_DIR/CLAUDE.md.snippet"
CLAUDE_MD="$TARGET_DIR/CLAUDE.md"

if [[ -f "$SNIPPET" ]]; then
  if [[ -f "$CLAUDE_MD" ]]; then
    if grep -q "SentinAI MCP" "$CLAUDE_MD"; then
      echo "  ✓ CLAUDE.md already contains SentinAI snippet (skipped)"
    else
      echo "" >> "$CLAUDE_MD"
      cat "$SNIPPET" >> "$CLAUDE_MD"
      echo "  ✓ CLAUDE.md ← snippet appended"
    fi
  else
    cp "$SNIPPET" "$CLAUDE_MD"
    echo "  ✓ CLAUDE.md created from snippet"
  fi
fi

# ── Add .mcp.json to .gitignore ────────────────────────────────────────────────
GITIGNORE="$TARGET_DIR/.gitignore"
if [[ -f "$GITIGNORE" ]]; then
  if ! grep -q "\.mcp\.json" "$GITIGNORE"; then
    echo ".mcp.json" >> "$GITIGNORE"
    echo "  ✓ .gitignore ← .mcp.json added"
  fi
fi

echo ""
echo "Done. Start Claude Code and run: /sentinai-status"
echo ""
echo "Available commands:"
echo "  /sentinai-status     — current metrics + scaler state"
echo "  /sentinai-rca        — root cause analysis"
echo "  /sentinai-diagnose   — full health diagnostics"
echo "  /sentinai-autonomy   — recent autonomous decisions & actions"
echo "  /sentinai-guardrails — guardrail events (suppressed/blocked)"
echo "  /sentinai-replay     — incident timeline reconstruction"
