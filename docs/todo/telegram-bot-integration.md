# SentinAI Telegram Bot Integration PRD

**Version:** 1.1
**Date:** 2026-02-10
**Status:** Ready for Implementation

---

## 1. 개요

### 1.1 목표
SentinAI 대시보드와 연동되는 Telegram 봇을 구축하여, 사용자가 언제 어디서나 L2 네트워크 상태를 조회하고 클러스터를 관리할 수 있도록 한다.

### 1.2 핵심 가치
- **즉각적인 접근성**: 대시보드 없이 모바일에서 바로 상태 확인
- **실시간 알림**: 이상 탐지 시 즉시 Telegram 알림
- **AI 대화**: 자연어로 시스템 상태 질의 및 분석
- **원격 관리**: 긴급 상황 시 모바일에서 스케일링/재시작

### 1.3 현재 코드베이스 상태

**구현 완료된 기능 (연동 대상):**
| 모듈 | 파일 | API 엔드포인트 | 설명 |
|------|------|---------------|------|
| 메트릭 조회 | `src/lib/metrics-store.ts` | `GET /api/metrics` | L2 블록, CPU, TxPool 등 |
| 이상 탐지 | `src/lib/anomaly-detector.ts` | `GET /api/anomalies` | Z-Score 기반 이상 탐지 |
| RCA 분석 | `src/lib/rca-engine.ts` | `POST /api/rca` | AI 기반 근본 원인 분석 |
| 비용 리포트 | `src/lib/cost-optimizer.ts` | `GET /api/cost-report` | AI 비용 최적화 추천 |
| 헬스 체크 | - | `GET /api/health` | 시스템 상태 확인 |
| 스케일러 | `src/lib/k8s-scaler.ts` | `POST /api/scaler` | K8s 리소스 스케일링 |

### 1.4 구현 범위
- Phase 1: 상태 조회 명령어 (Read-only)
- Phase 2: 클러스터 관리 명령어 (Write)
- Phase 3: AI 대화 모드 (LLM Integration)
- Phase 4: 실시간 알림 시스템

---

## 2. 사용자 스토리

### US-1: 상태 확인
```
As a DevOps engineer
I want to check network status via Telegram
So that I can monitor the system while away from my desk
```

### US-2: 이상 탐지 알림
```
As a system administrator
I want to receive instant alerts when anomalies are detected
So that I can respond quickly to incidents
```

### US-3: 긴급 스케일링
```
As an on-call engineer
I want to scale resources via Telegram
So that I can handle traffic spikes without laptop access
```

### US-4: AI 분석 질의
```
As a DevOps engineer
I want to ask questions about system behavior in natural language
So that I can understand complex issues without reading raw logs
```

---

## 3. 기능 명세

### 3.1 Command 목록

| Command | 설명 | 권한 | Phase | 연동 API |
|---------|------|------|-------|----------|
| `/start` | 봇 시작, 환영 메시지 | Public | 1 | - |
| `/help` | 명령어 목록 표시 | Public | 1 | - |
| `/status` | 전체 네트워크 상태 요약 | Auth | 1 | `/api/metrics` |
| `/metrics` | 상세 메트릭 (CPU/MEM/TxPool/Gas) | Auth | 1 | `/api/metrics` |
| `/health` | 클러스터 헬스 체크 | Auth | 1 | `/api/health` |
| `/anomalies` | 최근 이상 탐지 로그 | Auth | 1 | `/api/anomalies` |
| `/cost` | 비용 분석 리포트 | Auth | 1 | `/api/cost-report` |
| `/rca` | 근본 원인 분석 실행 | Auth | 2 | `/api/rca` |
| `/scale <cpu> <mem>` | 수동 스케일링 | Admin | 2 | `/api/scaler` |
| `/alert on/off` | 알림 토글 | Auth | 2 | - |

### 3.2 권한 레벨

- **Public**: 누구나 사용 가능
- **Auth**: 등록된 사용자만 (TELEGRAM_ALLOWED_USERS)
- **Admin**: 관리자만 (TELEGRAM_ADMIN_USERS)

### 3.3 응답 포맷

#### /status 응답 예시
```
🛡️ SentinAI Network Status

📊 Network
├ L2 Block: 125,847,392
├ L1 Sync: 19,847,291
└ Sync Status: 100% ✅

💻 Resources
├ CPU: 45% (4 vCPU)
├ Memory: 62% (8 GiB)
└ Pods: 4 running

⛽ Gas & TxPool
├ Pending TX: 128
├ Avg Gas: 0.023 gwei
└ Base Fee: 0.001 gwei

🔥 Health Score: 94/100

Last updated: 2026-02-10 11:00:00 KST
```

#### /anomalies 응답 예시
```
⚠️ Recent Anomalies (Last 24h)

1. 🟡 WARNING - 14:23
   Metric: cpuUsage
   Value: 87.5% (Z-Score: 2.8)
   Direction: spike
   Rule: z-score

2. 🔴 CRITICAL - 12:45
   Metric: txPoolPending
   Value: 5,021
   Direction: spike
   Rule: monotonic-increase

Total: 2 anomalies detected
```

### 3.4 Inline Keyboard (버튼 UI)

```
┌─────────────┬─────────────┐
│ 📊 Metrics  │ ⚠️ Anomalies│
├─────────────┼─────────────┤
│ 🔍 RCA      │ 💰 Cost     │
├─────────────┼─────────────┤
│ 🔄 Refresh  │ ⚙️ Settings │
└─────────────┴─────────────┘
```

### 3.5 AI 대화 모드

일반 텍스트 메시지는 AI 대화 모드로 처리:

**입력:** "op-geth가 왜 느려졌어?"

**출력:**
```
🤖 AI Analysis

현재 op-geth 성능 저하 원인 분석:

1. TxPool 급증 (128 → 1,247 pending)
   - 원인: NFT 민팅 이벤트로 인한 트래픽 증가

2. 메모리 사용률 상승 (62% → 78%)
   - 원인: TxPool 처리 부하

💡 권장 조치:
- 자동 스케일링 대기 중 (1→2 vCPU)
- 예상 정상화 시간: 5-10분

수동 스케일링 원하시면 /scale 2 4 입력하세요.
```

---

## 4. 기술 아키텍처

### 4.1 시스템 구조

```
┌─────────────────────────────────────────────┐
│           Telegram Bot API                   │
│         (api.telegram.org)                   │
└──────────────────┬──────────────────────────┘
                   │ Webhook POST
                   ▼
┌─────────────────────────────────────────────┐
│     SentinAI Next.js Application            │
│  ┌─────────────────────────────────────┐    │
│  │  /api/telegram/webhook              │    │
│  │  - Update handler                    │    │
│  │  - Command router                    │    │
│  │  - Auth middleware                   │    │
│  └──────────────┬──────────────────────┘    │
│                 │                            │
│  ┌──────────────┴──────────────────────┐    │
│  │        TelegramBotService           │    │
│  │  - Command handlers                 │    │
│  │  - Response formatters              │    │
│  │  - Alert sender                     │    │
│  └──────────────┬──────────────────────┘    │
│                 │                            │
│  ┌─────────────┬┴──────┬─────────────┐      │
│  ▼             ▼       ▼             ▼      │
│ /api/        /api/   /api/      ai-client   │
│ metrics    anomalies  rca        (Claude)   │
└─────────────────────────────────────────────┘
```

### 4.2 Webhook vs Polling

**선택: Webhook (Production)**
- 이유: 즉각적인 응답, 리소스 효율성
- 요구사항: HTTPS 엔드포인트 필요

**대안: Long Polling (Development)**
- 이유: 로컬 테스트 용이
- 구현: `node-telegram-bot-api` polling mode

---

## 5. 파일 구조 (신규 생성)

현재 코드베이스에 맞춰 설계된 파일 구조:

```
src/
├── app/
│   └── api/
│       └── telegram/
│           ├── webhook/
│           │   └── route.ts          # Webhook 엔드포인트
│           └── set-webhook/
│               └── route.ts          # Webhook 설정 API
├── lib/
│   └── telegram/
│       ├── bot.ts                    # TelegramBot 인스턴스
│       ├── types.ts                  # Telegram 타입 정의
│       ├── config.ts                 # Telegram 설정
│       ├── commands/
│       │   ├── index.ts              # Command router
│       │   ├── start.ts              # /start handler
│       │   ├── help.ts               # /help handler
│       │   ├── status.ts             # /status → /api/metrics
│       │   ├── metrics.ts            # /metrics → /api/metrics
│       │   ├── health.ts             # /health → /api/health
│       │   ├── anomalies.ts          # /anomalies → /api/anomalies
│       │   ├── cost.ts               # /cost → /api/cost-report
│       │   ├── rca.ts                # /rca → /api/rca
│       │   └── scale.ts              # /scale → /api/scaler
│       ├── middleware/
│       │   ├── auth.ts               # 사용자 인증
│       │   └── rate-limit.ts         # Rate limiting
│       ├── formatters/
│       │   ├── status.ts             # MetricData → Telegram 메시지
│       │   ├── anomalies.ts          # AnomalyResult → Telegram 메시지
│       │   └── rca.ts                # RCAResult → Telegram 메시지
│       ├── ai/
│       │   └── chat.ts               # AI 대화 처리 (ai-client.ts 연동)
│       └── alerts/
│           └── sender.ts             # 알림 전송 (anomaly-event-store 연동)
└── types/
    └── telegram.ts                   # Telegram 관련 타입 (global)
```

---

## 6. 환경 변수

```env
# .env.local에 추가

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=random-secret-for-validation

# User Authorization (comma-separated Telegram user IDs)
TELEGRAM_ALLOWED_USERS=1266746900,123456789
TELEGRAM_ADMIN_USERS=1266746900

# Rate Limiting
TELEGRAM_RATE_LIMIT_PER_MINUTE=30
TELEGRAM_ADMIN_RATE_LIMIT_PER_MINUTE=5

# AI Chat (uses existing ANTHROPIC_API_KEY from ai-client.ts)
TELEGRAM_AI_ENABLED=true
```

---

## 7. 기존 모듈 연동 가이드

### 7.1 메트릭 조회 (`/api/metrics`)

```typescript
// src/lib/telegram/commands/status.ts
import { MetricData } from '@/types/prediction';

export async function handleStatus(ctx: CommandContext): Promise<string> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/metrics`);
  const data: MetricData = await res.json();

  return formatStatusMessage(data);
}
```

### 7.2 이상 탐지 (`/api/anomalies`)

```typescript
// src/lib/telegram/commands/anomalies.ts
import { AnomalyResult } from '@/types/anomaly';

export async function handleAnomalies(ctx: CommandContext): Promise<string> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/anomalies`);
  const data = await res.json();

  return formatAnomaliesMessage(data.anomalies as AnomalyResult[]);
}
```

### 7.3 RCA 분석 (`/api/rca`)

```typescript
// src/lib/telegram/commands/rca.ts
import { RCAResult } from '@/types/rca';

export async function handleRCA(ctx: CommandContext): Promise<string> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/rca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoTriggered: false }),
  });
  const data = await res.json();

  if (data.success && data.result) {
    return formatRCAMessage(data.result as RCAResult);
  }
  return '❌ RCA 분석 실패: ' + (data.error || 'Unknown error');
}
```

### 7.4 비용 리포트 (`/api/cost-report`)

```typescript
// src/lib/telegram/commands/cost.ts
import { CostReport } from '@/types/cost';

export async function handleCost(ctx: CommandContext): Promise<string> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/cost-report?days=7`);
  const report: CostReport = await res.json();

  return formatCostMessage(report);
}
```

### 7.5 AI 대화 (`ai-client.ts` 직접 연동)

```typescript
// src/lib/telegram/ai/chat.ts
import { chatCompletion } from '@/lib/ai-client';
import { getRecentMetrics } from '@/lib/metrics-store';

export async function handleAIChat(ctx: CommandContext, message: string): Promise<string> {
  const metrics = getRecentMetrics(5);
  const systemContext = buildSystemContext(metrics);

  const result = await chatCompletion({
    systemPrompt: systemContext,
    userPrompt: message,
    modelTier: 'fast', // claude-haiku for quick responses
    temperature: 0.3,
    moduleName: 'TELEGRAM',
  });

  return `🤖 *AI Analysis*\n\n${result.content}`;
}
```

---

## 8. 실시간 알림 연동

### 8.1 Anomaly Event Store 연동

기존 `anomaly-event-store.ts`와 연동하여 이상 탐지 시 자동 알림:

```typescript
// src/lib/telegram/alerts/sender.ts
import { getBot } from '../bot';
import { telegramConfig } from '../config';
import { AnomalyEvent } from '@/types/anomaly';

export async function onAnomalyDetected(event: AnomalyEvent): Promise<void> {
  const bot = getBot();
  const message = formatAnomalyAlert(event);

  for (const adminId of telegramConfig.adminUsers) {
    try {
      await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`[Telegram Alert] Failed to send to ${adminId}:`, error);
    }
  }
}
```

### 8.2 Alert Dispatcher 통합

기존 `alert-dispatcher.ts`에 Telegram 채널 추가:

```typescript
// src/lib/alert-dispatcher.ts 수정
import { onAnomalyDetected as sendTelegramAlert } from './telegram/alerts/sender';

export async function dispatchAlert(event: AnomalyEvent): Promise<void> {
  // 기존 알림 채널...

  // Telegram 알림 추가
  if (process.env.TELEGRAM_BOT_TOKEN) {
    await sendTelegramAlert(event);
  }
}
```

---

## 9. 의존성

```bash
# 필수 패키지
npm install node-telegram-bot-api
npm install -D @types/node-telegram-bot-api
```

---

## 10. 테스트 체크리스트

- [ ] BotFather에서 봇 생성 완료
- [ ] Webhook URL 설정 완료
- [ ] `/start` - 환영 메시지 표시
- [ ] `/help` - 명령어 목록 표시
- [ ] `/status` - `/api/metrics` 연동 확인
- [ ] `/anomalies` - `/api/anomalies` 연동 확인
- [ ] `/cost` - `/api/cost-report` 연동 확인
- [ ] `/rca` - `/api/rca` 연동 확인 (Admin)
- [ ] AI 대화 모드 동작 확인
- [ ] 이상 탐지 시 자동 알림 수신

---

## 11. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| 응답 시간 | < 2초 | API 로그 |
| 명령어 성공률 | > 99% | Error rate |
| 알림 전달률 | 100% | Delivery confirmation |

---

## Appendix: BotFather 설정 가이드

1. Telegram에서 `@BotFather` 검색
2. `/newbot` 명령어 입력
3. 봇 이름 입력: `SentinAI Bot`
4. 봇 사용자명 입력: `sentinai_bot` (또는 원하는 이름)
5. API Token 복사 → `TELEGRAM_BOT_TOKEN`에 저장
6. `/setcommands` - 명령어 목록 설정:
   ```
   start - Start the bot
   help - Show commands
   status - Network status
   metrics - Detailed metrics
   health - Health check
   anomalies - Recent anomalies
   cost - Cost report
   rca - Run root cause analysis
   scale - Scale resources (Admin)
   alert - Toggle alerts
   ```
