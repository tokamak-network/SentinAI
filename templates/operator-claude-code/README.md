# SentinAI Operator Pack for Claude Code

L2 노드 운영자가 본인의 노드 레포에 붙여넣으면 Claude Code 세션에서 SentinAI 데이터를 자연어로 조회할 수 있습니다.

---

## 한 줄 설치

```bash
export SENTINAI_BASE_URL=http://my-sentinai.internal:3002
export SENTINAI_API_KEY=your-api-key
bash <(curl -fsSL ${SENTINAI_BASE_URL}/install-operator-pack.sh)
```

또는 로컬에서 직접:

```bash
export SENTINAI_BASE_URL=http://my-sentinai.internal:3002
export SENTINAI_API_KEY=your-api-key
bash /path/to/sentinai/templates/operator-claude-code/install.sh
```

설치 완료 후 Claude Code를 재시작하고 `/sentinai-status`를 실행하면 됩니다.

### 설치 스크립트 전문 (`install.sh`)

```bash
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
```

**스크립트가 하는 일:**
1. `.claude/` 복사 — 슬래시 커맨드 6개 + 서브에이전트 2개
2. `.mcp.json` 자동 생성 — URL + API 키 주입
3. `CLAUDE.md` 자동 생성 또는 하단에 snippet append (중복 방지)
4. `.gitignore`에 `.mcp.json` 자동 추가

---

## 수동 셋업 (네트워크 제한 환경)

### 1. 파일 복사

노드 레포 루트에서:

```bash
cp -r .claude /path/to/your-node-repo/
cp CLAUDE.md.snippet /path/to/your-node-repo/  # CLAUDE.md에 내용 추가
```

### 2. `.mcp.json` 생성

`${SENTINAI_BASE_URL}`과 `${SENTINAI_API_KEY}`를 실제 값으로 교체합니다:

```json
{
  "mcpServers": {
    "sentinai": {
      "type": "http",
      "url": "http://my-sentinai.internal:3002/api/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 3. CLAUDE.md에 스니펫 추가

`CLAUDE.md.snippet` 내용을 노드 레포의 `CLAUDE.md` 파일 하단에 붙여넣습니다.
(CLAUDE.md가 없으면 그냥 CLAUDE.md로 이름을 바꿔도 됩니다.)

### 4. Claude Code 재시작 및 검증

```bash
cd /path/to/your-node-repo
claude
```

Claude Code 프롬프트에서:
```
/sentinai-status
```

현재 노드 메트릭이 출력되면 연결 성공입니다.

---

## 포함된 파일

### 슬래시 커맨드 (`.claude/commands/`)

| 커맨드 | 설명 |
|--------|------|
| `/sentinai-status` | 현재 메트릭 + 스케일러 상태 8줄 요약 |
| `/sentinai-rca [증상]` | RCA 실행 + 한 문단 진단 결과 |
| `/sentinai-diagnose` | 전체 컴포넌트 헬스 다이어그노스틱 |
| `/sentinai-autonomy` | 최근 자율 결정/액션 피드 (20건, 실행·억제·차단·폴백) |
| `/sentinai-guardrails` | 가드레일 이벤트 조회 (억제 이유별 분류, 시뮬레이션 모드 확인) |
| `/sentinai-replay [eventId]` | 인시던트 타임라인 재구성 (장애 ID 또는 시간 범위 지정) |

### 서브에이전트 (`.claude/agents/`)

| 에이전트 | 언제 쓸까 |
|----------|-----------|
| `@l2-incident-responder` | 장애 발생 시 — 증상 서술 → RCA → 복구 조치 제안 |
| `@l2-health-auditor` | 정기 점검 / 배포 전 확인 / 주간 리포트 작성 시 |

**사용 예시:**

```
@l2-incident-responder p2p peer count가 0이 됐어. 원인을 찾아줘.
```

```
@l2-health-auditor 주간 헬스 리포트 작성해줘.
```

---

## 보안

- `.mcp.json`의 `x-api-key`는 SentinAI에서 발급한 운영자 전용 키를 사용하세요.
- 키를 Git에 커밋하지 마세요. `.gitignore`에 `.mcp.json` 추가를 권장합니다.
- SentinAI를 `MCP_OPERATOR_PROFILE=readonly`로 구동하면 Claude Code에서 쓰기 툴(`restart_*`, `scale_*`)이 노출되지 않습니다.

자세한 설명: [SentinAI Operator Claude Code Setup Guide](../../docs/guide/operator-claude-code-setup.md)

---

## 트러블슈팅

| 증상 | 확인 사항 |
|------|-----------|
| `/sentinai-status` 실행 시 툴 없음 오류 | Claude Code 재시작, `.mcp.json` URL 오타 확인 |
| 401 Unauthorized | `x-api-key` 값이 SentinAI의 `SENTINAI_API_KEY`와 일치하는지 확인 |
| MCP 서버 비활성화 오류 | SentinAI 서버에서 `MCP_SERVER_ENABLED=true` 확인 |
| `@l2-incident-responder` 미인식 | `.claude/agents/` 디렉토리가 노드 레포 루트 기준 올바른 위치에 있는지 확인 |
