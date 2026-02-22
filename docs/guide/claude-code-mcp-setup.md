# Claude Code MCP Bridge Setup

이 문서는 SentinAI의 HTTP MCP 서버(` /api/mcp `)를 Claude Code에서 stdio MCP 서버처럼 사용하기 위한 설정 절차를 설명합니다.

---

## 1. 사전 조건

1. SentinAI 서버 실행 (예: `npm run dev`, 기본 `http://127.0.0.1:3002`)
2. MCP 서버 활성화
3. API 키 설정

예시:

```bash
export MCP_SERVER_ENABLED=true
export SENTINAI_API_KEY=your-sentinai-api-key
```

---

## 2. 브리지 실행

```bash
npm run mcp:bridge:stdio
```

브리지가 시작되면 stderr에 아래와 같은 로그가 출력됩니다.

```text
[MCP Bridge] Ready: http://127.0.0.1:3002/api/mcp
```

---

## 3. 주요 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MCP_BRIDGE_BASE_URL` | `http://127.0.0.1:3002` | SentinAI 서버 주소 |
| `MCP_BRIDGE_API_PATH` | `/api/mcp` | MCP API 경로 |
| `MCP_BRIDGE_TIMEOUT_MS` | `15000` | 브리지 -> 서버 요청 타임아웃(ms) |
| `MCP_BRIDGE_API_KEY` | (없음) | `SENTINAI_API_KEY` 대신 사용할 키 |

참고:

1. `SENTINAI_API_KEY`가 설정되어 있으면 우선 사용됩니다.
2. 쓰기 도구는 서버 정책에 따라 approval token이 필요합니다.

---

## 4. Claude Code MCP 서버 등록 예시

Claude Code의 MCP 서버 등록에 아래 커맨드를 사용합니다.

```json
{
  "name": "sentinai",
  "command": "npm",
  "args": ["run", "mcp:bridge:stdio"],
  "env": {
    "MCP_SERVER_ENABLED": "true",
    "SENTINAI_API_KEY": "your-sentinai-api-key",
    "MCP_BRIDGE_BASE_URL": "http://127.0.0.1:3002"
  }
}
```

---

## 5. 동작 확인

1. Claude Code에서 MCP tool list 조회
2. `get_metrics` 호출 확인
3. `plan_goal` 호출 확인
4. `scale_component` 호출 시 approval 없이 차단되는지 확인

---

## 6. 문제 해결

1. `MCP 서버가 비활성화되어 있습니다` 오류:
   - `MCP_SERVER_ENABLED=true` 확인
2. `유효하지 않은 x-api-key` 오류:
   - `SENTINAI_API_KEY` 값 일치 여부 확인
3. 타임아웃 오류:
   - `MCP_BRIDGE_TIMEOUT_MS` 증가
   - SentinAI 서버 상태 확인

