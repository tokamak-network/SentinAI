# Operator Claude Code Setup Guide

SentinAI의 MCP 서버를 운영자의 L2 노드 레포에 연결하면, Claude Code 세션에서 SentinAI 모니터링 데이터를 자연어로 조회하고 RCA·헬스 점검을 수행할 수 있습니다.

---

## 왜 이게 필요한가

L2 노드에 장애가 발생했을 때 운영자의 흔한 워크플로우는:

1. 오류 메시지 확인 → 로그 grep → 메트릭 대시보드 열기 → 원인 추정 → 조치

SentinAI는 이미 L2 노드를 24시간 관측하고 있습니다. MCP 연결을 추가하면 Claude Code가 **3번째 단계를 먼저** 수행하도록 유도할 수 있습니다:

1. `get_metrics` + `get_anomalies` 조회 → 이미 분석된 데이터 확인 → 필요한 경우만 로그 grep

반복적인 수동 탐색 대신 "이미 알고 있는 것"부터 꺼내씁니다.

---

## 아키텍처 개요

```
[운영자 노드 레포]
    Claude Code CLI
        ↓ MCP (HTTP)
[SentinAI 인스턴스 /api/mcp]
    ├── get_metrics        (현재 L2 메트릭)
    ├── get_anomalies      (이상 탐지 이벤트)
    ├── run_rca            (근본 원인 분석)
    ├── run_health_diagnostics  (전체 컴포넌트 헬스)
    ├── plan_goal          (자연어 → 실행 계획)
    ├── discover_agents    (에이전트 마켓플레이스)
    └── (쓰기 툴 — 운영자 확인 후만 실행)
```

SentinAI MCP 서버는 `src/app/api/mcp/route.ts`에서 구동됩니다. Claude Code는 `x-api-key` 헤더로 인증합니다.

---

## 전제 조건

| 항목 | 확인 방법 |
|------|-----------|
| Claude Code CLI 설치 | `claude --version` |
| SentinAI 인스턴스 실행 중 | `curl http://<SENTINAI_URL>/api/health` → `200 OK` |
| MCP 서버 활성화 | SentinAI에서 `MCP_SERVER_ENABLED=true` |
| SENTINAI_API_KEY 발급 | 운영자별 전용 키 권장 |

---

## 셋업 (3분)

### Step 1 — Operator Pack 복사

SentinAI 레포의 `templates/operator-claude-code/`를 노드 레포에 복사합니다:

```bash
# SentinAI 레포를 클론하거나 템플릿만 다운로드
git clone https://github.com/your-org/SentinAI /tmp/sentinai
cp -r /tmp/sentinai/templates/operator-claude-code/.claude /path/to/your-node-repo/
cp /tmp/sentinai/templates/operator-claude-code/.mcp.json.template /path/to/your-node-repo/.mcp.json
```

### Step 2 — `.mcp.json` 편집

`/path/to/your-node-repo/.mcp.json`을 열어 실제 값으로 교체합니다:

```json
{
  "mcpServers": {
    "sentinai": {
      "type": "http",
      "url": "http://my-sentinai.internal:3002/api/mcp",
      "headers": {
        "x-api-key": "your-sentinai-api-key"
      }
    }
  }
}
```

> `.mcp.json`을 `.gitignore`에 추가해 API 키를 Git에 커밋하지 않도록 하세요.

### Step 3 — CLAUDE.md 스니펫 추가

`CLAUDE.md.snippet` 내용을 노드 레포의 `CLAUDE.md` 하단에 붙여넣습니다. 이 스니펫이 있으면 Claude Code가 노드 이슈를 탐색할 때 자동으로 SentinAI MCP를 먼저 조회합니다.

### Step 4 — 검증

```bash
cd /path/to/your-node-repo
claude
```

Claude Code 프롬프트에서:

```
/sentinai-status
```

다음과 비슷한 출력이 나오면 연결 성공:

```
SentinAI Node Status
- Block height: 12,450,321
- Block production rate: 2.1 blocks/min
- Txpool size: 247 pending txs
- Sync lag: 0.8s
- Peer count: 18
- CPU: 34%  |  Memory: 6.2 GiB
- Scaler state: idle
- Last anomaly: none in recent window
```

---

## 슬래시 커맨드 사용법

커맨드는 `.claude/commands/`에 있습니다. Claude Code 프롬프트에서 `/` 입력 후 자동완성으로 선택합니다.

### `/sentinai-status`

현재 L2 메트릭과 스케일러 상태를 8줄로 요약합니다.

```
/sentinai-status
```

### `/sentinai-rca [증상]`

RCA를 실행하고 한 문단으로 진단 결과를 반환합니다.

```
/sentinai-rca 블록 생산이 갑자기 느려졌어
```

출력 예시:
```
RCA Result — 2026-04-14 10:32 UTC
SentinAI detected a 340% increase in tx processing latency beginning at 10:18 UTC.
Root cause (confidence: 87%): memory pressure on op-geth caused GC pauses exceeding
500ms. Suggested action: scale op-geth vCPU from 2 to 4 to reduce context switching.
```

### `/sentinai-diagnose`

전체 컴포넌트 헬스 다이어그노스틱을 실행합니다. 배포 전·후 확인에 유용합니다.

```
/sentinai-diagnose
```

---

## 서브에이전트 사용법

서브에이전트는 복잡한 분석이 필요할 때 사용합니다. `@에이전트명`으로 호출합니다.

### `@l2-incident-responder` — 장애 대응

**언제**: 노드에 문제가 생겼을 때. 증상을 설명하면 데이터를 수집하고 조치를 제안합니다.

```
@l2-incident-responder p2p 연결이 끊겼고 peer count가 0이야.
```

워크플로우:
1. `get_metrics` → `get_anomalies` → `run_rca` 순서로 데이터 수집
2. 증상과 RCA 결과를 대조해 근본 원인 진단
3. 구체적인 복구 조치 제안 + 운영자 확인 요청
4. "yes, execute" 확인 후 MCP 쓰기 툴 실행

> 에이전트는 명시적 확인 없이 노드를 수정하지 않습니다.

### `@l2-health-auditor` — 정기 점검

**언제**: 배포 전 확인, 주간 리포트 작성, 조용한 이슈 조기 발견.

```
@l2-health-auditor 이번 주 헬스 리포트 작성해줘.
```

```
@l2-health-auditor 배포 전 노드 상태 확인해줘.
```

출력: Slack에 붙여넣을 수 있는 구조화된 리포트 (Overall Status, Anomaly Summary, Recommendations).

---

## SentinAI Read-Only 프로필

운영자에게 노출할 MCP 툴을 읽기 전용으로 제한하려면 SentinAI 서버를 다음 환경변수와 함께 구동합니다:

```bash
MCP_OPERATOR_PROFILE=readonly npm run dev
# 또는 Docker
MCP_OPERATOR_PROFILE=readonly docker compose up
```

Read-only 프로필에서는 다음 툴이 매니페스트에서 제거됩니다:

| 차단되는 툴 |
|------------|
| `scale_component` |
| `restart_component`, `restart_batcher`, `restart_proposer` |
| `switch_l1_rpc`, `update_proxyd_backend` |
| `execute_autonomous_operation`, `rollback_autonomous_operation` |
| `execute_goal_plan` |

운영자는 조회·분석은 할 수 있지만, 노드 상태를 직접 변경하는 작업은 대시보드에서만 실행 가능합니다.

---

## 트러블슈팅

### MCP 연결 실패

```
Error: Failed to connect to MCP server "sentinai"
```

확인 순서:
1. `.mcp.json`의 `url` 필드가 실제 SentinAI 주소와 일치하는지 확인
2. `curl http://<SENTINAI_URL>/api/health` → 200 OK 확인
3. `curl -H "x-api-key: your-key" http://<SENTINAI_URL>/api/mcp` → tools 목록 반환 확인

### 툴이 목록에 없음

Claude Code에서 MCP 툴이 안 보일 때:
- Claude Code를 완전히 종료 후 재시작 (캐시 문제)
- `.mcp.json`이 노드 레포 **루트**에 있는지 확인 (하위 디렉토리 X)

### 401 Unauthorized

```json
{"error": "unauthorized", "error_description": "Bearer token required."}
```

- `x-api-key` 값이 SentinAI의 `SENTINAI_API_KEY` 환경변수와 정확히 일치하는지 확인
- 앞뒤 공백 없이 붙여넣었는지 확인

### MCP 서버 비활성화

```json
{"enabled": false, "message": "MCP server is disabled."}
```

- SentinAI 서버에서 `MCP_SERVER_ENABLED=true` 설정 후 재시작

### `@l2-incident-responder` 미인식

- `.claude/agents/` 디렉토리가 노드 레포 루트 기준 `.claude/agents/l2-incident-responder.md` 경로에 있는지 확인
- Claude Code 재시작

---

## 관련 파일

| 파일 | 설명 |
|------|------|
| `src/app/api/mcp/route.ts` | MCP HTTP 엔드포인트 |
| `src/lib/mcp-server.ts` | MCP 툴 정의 및 핸들러 |
| `src/lib/oauth-token.ts` | Bearer 토큰 OAuth 인증 |
| `templates/operator-claude-code/` | 이 가이드의 모든 파일 원본 |
| `ENV_GUIDE.md` | MCP 환경변수 전체 목록 |
