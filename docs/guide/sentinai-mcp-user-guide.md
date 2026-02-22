# SentinAI MCP 사용자 가이드

이 문서는 SentinAI MCP를 Claude Code에서 설정하고, 운영 상태 조회 및 수동 조치까지 일관된 절차로 수행하는 통합 가이드입니다.

---

## 1. 개요

SentinAI MCP는 아래 2계층으로 동작합니다.

1. SentinAI HTTP MCP 서버: `POST /api/mcp`
2. stdio 브리지: Claude Code MCP 요청을 HTTP MCP로 전달

즉, `npm run mcp:bridge:stdio`만 실행해도 실제 호출 대상인 SentinAI 서버(`npm run dev` 또는 `npm run start`)가 살아 있어야 정상 동작합니다.

### 1.1 MCP 사용 효용성

1. 자연어 기반 운영: 도구명을 외우지 않고 운영 의도를 자연어로 전달할 수 있습니다.
2. 일관된 안전 정책: 승인 토큰/읽기 전용 정책이 MCP 경로에서 일관되게 적용됩니다.
3. 대응 속도 개선: 상태 점검 -> 원인 분석 -> 조치 -> 사후 검증 흐름을 한 세션에서 빠르게 반복할 수 있습니다.
4. 감사 추적 용이: 조치 요청과 실행 결과를 같은 프로토콜 흐름에서 추적하기 쉽습니다.

### 1.2 지원 체인 정책 (2026-02-22 기준)

1. 권고: MCP는 `OP Stack` 환경에서만 사용합니다.
2. 비활성화: `ZK Stack`은 현재 MCP 스펙 불일치로 비활성화 상태입니다.
3. 운영 원칙: `CHAIN_TYPE=zkstack` 환경에서는 MCP 대신 기존 API/UI 경로를 사용합니다.

### 1.3 기존 L2 운영 vs MCP 기반 운영 비교

| 구분 | 기존 L2 운영 (API/UI 중심) | MCP 기반 운영 |
|---|---|---|
| 진입 방식 | 운영자가 엔드포인트/화면을 직접 선택해 호출 | 자연어 요청으로 의도를 전달하고 MCP가 적절한 도구 호출 |
| 실행 흐름 | 점검/분석/조치 단계를 수동으로 전환 | 한 세션에서 점검 -> 분석 -> 조치 -> 검증 연속 수행 |
| 안전 제어 | 경로별로 정책 확인 필요 | 승인 토큰/읽기 전용 정책이 MCP 경로에 공통 적용 |
| 운영 속도 | 반복 절차마다 수동 맥락 전환 발생 | 동일 컨텍스트에서 연속 실행해 대응 리드타임 단축 |
| 감사/추적 | 호출 경로가 분산되어 추적 비용 증가 | 도구 호출과 결과를 같은 프로토콜 흐름으로 추적 |

---

## 2. 빠른 시작

### 2.1 SentinAI 서버 실행

```bash
npm run dev
```

기본 주소: `http://127.0.0.1:3002`

### 2.1.1 체인 타입 확인 (권고)

```bash
export CHAIN_TYPE=opstack
```

### 2.2 MCP 활성화 및 API 키 설정

```bash
export MCP_SERVER_ENABLED=true
export SENTINAI_API_KEY=your-sentinai-api-key
```

### 2.3 stdio 브리지 실행

```bash
npm run mcp:bridge:stdio
```

정상 시작 로그:

```text
[MCP Bridge] Ready: http://127.0.0.1:3002/api/mcp
```

### 2.4 Claude Code MCP 서버 등록 예시

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

### 2.5 연결 스모크 테스트

Claude Code에서 순서대로 확인합니다.

```text
sentinai MCP tool list를 보여줘
```

```text
최근 메트릭 5개를 요약해줘
```

```text
컴포넌트 스케일 조정을 승인 없이 시도했을 때 어떤 에러가 나는지 확인해줘
```

마지막 호출은 정책상 차단되어야 정상입니다.

---

## 3. 환경 변수

### 3.1 서버 측 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MCP_SERVER_ENABLED` | `false` | MCP 서버 활성화 여부 |
| `MCP_AUTH_MODE` | `api-key` | 인증 모드 (`api-key`/`approval-token`/`dual`) |
| `MCP_APPROVAL_REQUIRED` | `true` | 쓰기 도구 승인 토큰 요구 여부 |
| `MCP_APPROVAL_TTL_SECONDS` | `300` | 승인 토큰 유효 시간(초) |
| `SENTINAI_API_KEY` | (없음) | MCP API 인증 키 |
| `NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE` | `false` | 읽기 전용 모드 활성화 시 쓰기 도구 차단 |
| `SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY` | `false` | 읽기 전용에서 스케일러 쓰기 예외 허용 |

### 3.2 브리지 측 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MCP_BRIDGE_BASE_URL` | `http://127.0.0.1:3002` | SentinAI 서버 주소 |
| `MCP_BRIDGE_API_PATH` | `/api/mcp` | MCP API 경로 |
| `MCP_BRIDGE_TIMEOUT_MS` | `15000` | 브리지 -> 서버 요청 타임아웃(ms) |
| `MCP_BRIDGE_API_KEY` | (없음) | `SENTINAI_API_KEY` 대체 키 (`SENTINAI_API_KEY` 우선) |

---

## 4. MCP 도구 요약

| 도구 | 유형 | 설명 |
|---|---|---|
| `get_metrics` | Read | 최근 메트릭/스케일 상태 조회 |
| `get_anomalies` | Read | 이상 이벤트 목록 조회 |
| `run_rca` | Read | RCA 분석 실행 |
| `plan_goal` | Read | 자연어 목표를 실행 계획으로 분해 |
| `run_health_diagnostics` | Read | 메트릭/이상 이벤트/L1 RPC/컴포넌트 상태 종합 점검 |
| `execute_goal_plan` | Write | 목표 계획 실행 (기본 dry-run) |
| `scale_component` | Write | 실행 컴포넌트 리소스 스케일링 |
| `restart_component` | Write | 지정 컴포넌트 재시작 |
| `restart_batcher` | Write | 배처 재시작 |
| `restart_proposer` | Write | 프로포저 재시작 |
| `switch_l1_rpc` | Write | L1 RPC failover 또는 지정 URL 전환 |
| `update_proxyd_backend` | Write | Proxyd backend RPC URL 교체 |

Write 도구는 기본적으로 승인 토큰이 필요합니다.

---

## 5. 표준 운영 절차

### 5.1 1단계: 상태 확인

```text
현재 L1 RPC, 핵심 컴포넌트, 최근 이상 이벤트를 한 번에 점검해서 요약해줘
```

### 5.2 2단계: 원인 분석

```text
최근 이상 이벤트 20개와 최신 메트릭을 기준으로 원인 분석을 수행하고, 조치 우선순위를 제안해줘
```

### 5.3 3단계: 승인 토큰 발급

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "mcp.request_approval",
  "params": {
    "toolName": "scale_component",
    "toolParams": { "targetVcpu": 4 },
    "approvedBy": "operator",
    "reason": "CPU 사용률 상승 대응"
  }
}
```

응답의 `approvalToken`을 다음 Write 호출에 전달합니다.

### 5.4 4단계: 수동 조치 실행

재시작 예시:

```text
op-node 컴포넌트를 재시작해줘
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "restart_component",
  "params": {
    "target": "op-node",
    "approvalToken": "APPROVAL_TOKEN"
  }
}
```

L1 RPC 전환 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "switch_l1_rpc",
  "params": {
    "targetUrl": "https://sepolia.drpc.org",
    "reason": "기존 endpoint timeout 증가",
    "approvalToken": "APPROVAL_TOKEN"
  }
}
```

스케일링 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "scale_component",
  "params": {
    "targetVcpu": 4,
    "reason": "트래픽 증가 대응",
    "approvalToken": "APPROVAL_TOKEN"
  }
}
```

`targetVcpu` 지원 값: `1 | 2 | 4 | 8`

### 5.5 5단계: 사후 검증

```text
방금 조치 전/후의 상태 차이를 요약해줘
```

---

## 6. 지원 체인 정책

### OP Stack (권고)

- MCP 운영 절차(진단/승인/조치/검증)를 기본 지원합니다.
- `restart_batcher`, `restart_proposer` 등 OP 컴포넌트 경로 기준 운영 도구 사용을 권장합니다.

### ZK Stack (비활성화)

- 현재 MCP 스펙 불일치로 지원하지 않습니다.
- `CHAIN_TYPE=zkstack`에서는 MCP 경로를 사용하지 않고 기존 API/UI 운영 경로를 사용하세요.

---

## 7. 문제 해결

1. `MCP 서버가 비활성화되어 있습니다`:
   - `MCP_SERVER_ENABLED=true` 확인
   - SentinAI 서버(`npm run dev` 또는 `npm run start`) 실행 상태 확인

2. `유효하지 않은 x-api-key`:
   - `SENTINAI_API_KEY`와 브리지/클라이언트 키 일치 여부 확인

3. `approval required`:
   - 승인 요청을 먼저 수행하고 받은 `approvalToken` 전달

4. `read-only mode` 차단:
   - `NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE=true` 여부 확인

5. 타임아웃:
   - `MCP_BRIDGE_TIMEOUT_MS` 상향
   - `MCP_BRIDGE_BASE_URL` 대상 서버 상태/네트워크 확인

6. 컴포넌트를 찾을 수 없음:
   - `CHAIN_TYPE=opstack`인지 먼저 확인
   - OP Stack 컴포넌트 이름과 대상 이름 매칭 확인

---

## 8. 권장 운영 체크리스트

1. 시작 전: `CHAIN_TYPE=opstack`, 서버/브리지 프로세스, 키 설정 확인
2. 조치 전: 종합 진단 + 원인 분석으로 원인 가설 확보
3. 조치 시: 승인 토큰 기반 최소 범위 액션부터 실행
4. 조치 후: 동일 진단 도구로 전/후 비교 및 결과 기록
