# SentinAI 일일 운영 보고서 — 구현 명세서

> **목적**: 이 문서를 읽는 AI 에이전트(Claude Opus 4.6)가 추가 질문 없이 구현 → 테스트까지 완료할 수 있는 수준의 명세서.

---

## 1. 요구사항

### 1.1 기능 정의

24시간 동안 수집된 L2 노드 운영 데이터를 `claude-opus-4-6` 모델로 분석하여 일일 운영 보고서를 마크다운 파일로 생성·저장한다.

### 1.2 입력 데이터

| 데이터 | 소스 | 수집 방법 |
|--------|------|-----------|
| CPU 사용률 (%) | `metrics-store.ts` ring buffer | 5분 간격 스냅샷 |
| TxPool 대기 수 | `metrics-store.ts` ring buffer | 5분 간격 스냅샷 |
| Gas 사용 비율 (0-1) | `metrics-store.ts` ring buffer | 5분 간격 스냅샷 |
| L2 블록 높이 | `metrics-store.ts` ring buffer | 5분 간격 스냅샷 |
| 블록 생성 간격 (초) | `metrics-store.ts` ring buffer | 5분 간격 스냅샷 |
| 현재 vCPU | `metrics-store.ts` ring buffer | 5분 간격 스냅샷 |
| K8s 컴포넌트 로그 분석 | `analyze-logs` API | 분석 시점마다 축적 |
| 스케일링 이벤트 | `scaler` API | 이벤트 발생 시 축적 |

### 1.3 트리거

- **자동**: `node-cron`으로 매일 23:55 KST에 실행
- **수동**: `POST /api/reports/daily` API 호출

### 1.4 저장

- 경로: `data/reports/YYYY-MM-DD.md`
- 환경 변수 `REPORTS_DIR`로 오버라이드 가능 (기본값: `data/reports`)
- Docker 환경에서는 볼륨 마운트로 영속성 확보

### 1.5 AI 모델

- 모델: `claude-opus-4-6`
- 호출 방식: 기존 LiteLLM 게이트웨이 (OpenAI 호환 API)
- 엔드포인트: `${AI_GATEWAY_URL}/v1/chat/completions`
- 인증: `Authorization: Bearer ${ANTHROPIC_API_KEY}`

---

## 2. 아키텍처

### 2.1 데이터 흐름

```
┌───────────────────────────────────────────────────────────────────┐
│                        SentinAI Runtime                           │
│                                                                   │
│  [/api/metrics GET]                                               │
│       │ pushMetric()                                              │
│       ▼                                                           │
│  ┌─────────────────┐    takeSnapshot() (*/5 * * * *)              │
│  │  metrics-store   │────────────────────────┐                    │
│  │  Ring Buffer     │                        │                    │
│  │  (60 pts, ~1hr)  │                        ▼                    │
│  └─────────────────┘              ┌──────────────────────┐        │
│                                   │  daily-accumulator    │        │
│  [/api/scaler POST]               │  (in-memory 싱글톤)    │        │
│       │ addScalingEvent()         │                      │        │
│       └──────────────────────────►│  snapshots[]         │        │
│                                   │  hourlySummaries[]   │        │
│  [/api/analyze-logs GET]          │  logAnalysisResults[]│        │
│       │ addLogAnalysisResult()    │  scalingEvents[]     │        │
│       └──────────────────────────►│                      │        │
│                                   └──────────┬───────────┘        │
│                                              │                    │
│                    ┌─────────────────────────┘                    │
│                    │  매일 23:55 KST (cron)                        │
│                    │  또는 POST /api/reports/daily                  │
│                    ▼                                              │
│           ┌──────────────────────┐                                │
│           │ daily-report-generator│                                │
│           │                      │                                │
│           │ 1. 프롬프트 조립       │                                │
│           │ 2. Claude Opus 4.6   │──► LiteLLM Gateway             │
│           │ 3. 마크다운 저장       │                                │
│           └──────────┬───────────┘                                │
│                      │                                            │
│                      ▼                                            │
│           data/reports/YYYY-MM-DD.md                              │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 핵심 설계 결정

**문제**: 현재 `metrics-store.ts`의 ring buffer는 최대 60개 데이터 포인트(~1시간)만 보관. 일일 보고서에는 24시간 데이터가 필요.

**해결**: `daily-accumulator.ts` 모듈이 5분 간격으로 ring buffer의 통계 스냅샷을 저장 (하루 최대 288개). 스냅샷은 원시 데이터가 아닌 통계 요약(mean, min, max, stdDev)이므로 메모리 효율적.

**스케줄링**: Next.js `instrumentation.ts` 훅에서 `node-cron`을 초기화. 서버 시작 시 한 번 실행되며, 두 개의 cron job 등록:
- `*/5 * * * *` — 5분 스냅샷
- `55 23 * * *` — 일일 보고서 생성 (KST 기준)

---

## 3. 파일 구조

```
신규 파일:
  src/types/daily-report.ts              ← 타입 정의
  src/lib/daily-accumulator.ts           ← 24시간 메트릭 축적기
  src/lib/daily-report-generator.ts      ← AI 보고서 생성 + 파일 저장
  src/lib/scheduler.ts                   ← node-cron 스케줄러
  src/instrumentation.ts                 ← Next.js 서버 시작 훅
  src/app/api/reports/daily/route.ts     ← API 엔드포인트

수정 파일:
  src/app/api/scaler/route.ts            ← 스케일링 이벤트 기록 추가
  src/app/api/analyze-logs/route.ts      ← 로그 분석 결과 기록 추가
  next.config.ts                         ← instrumentationHook 활성화
  package.json                           ← node-cron 의존성
  Dockerfile                             ← data/reports 디렉토리 생성
  docker-compose.yml                     ← 볼륨 마운트

런타임 생성:
  data/reports/YYYY-MM-DD.md             ← 일일 보고서 파일
```

---

## 4. 타입 정의

### 파일: `src/types/daily-report.ts`

```typescript
/**
 * Daily Report Type Definitions
 */

// ============================================================
// Metric Snapshot (5분 간격)
// ============================================================

/** 5분 간격으로 ring buffer에서 스냅샷한 메트릭 통계 */
export interface MetricSnapshot {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** 스냅샷 시점의 ring buffer 데이터 포인트 수 (0-60) */
  dataPointCount: number;
  cpu: { mean: number; min: number; max: number; stdDev: number };
  txPool: { mean: number; min: number; max: number; stdDev: number };
  gasUsedRatio: { mean: number; min: number; max: number; stdDev: number };
  blockInterval: { mean: number; min: number; max: number; stdDev: number };
  /** 스냅샷 시점의 최신 L2 블록 높이 */
  latestBlockHeight: number;
  /** 스냅샷 시점의 vCPU 설정 */
  currentVcpu: number;
}

// ============================================================
// Hourly Summary (시간별 요약)
// ============================================================

/** 시간별 집계 요약 (AI 프롬프트용) */
export interface HourlySummary {
  /** 시간 (0-23) */
  hour: number;
  /** 해당 시간의 스냅샷 수 (최대 12) */
  snapshotCount: number;
  avgCpu: number;
  maxCpu: number;
  avgTxPool: number;
  maxTxPool: number;
  avgGasRatio: number;
  avgBlockInterval: number;
  /** 해당 시간의 추정 블록 생성 수 */
  blocksProduced: number;
  /** vCPU 변경 이력 */
  vcpuChanges: Array<{ timestamp: string; from: number; to: number }>;
}

// ============================================================
// Log Analysis & Scaling Events
// ============================================================

/** 로그 분석 결과 엔트리 (analyze-logs API에서 수집) */
export interface LogAnalysisEntry {
  timestamp: string;
  severity: 'normal' | 'warning' | 'critical';
  summary: string;
  actionItem: string;
}

/** 스케일링 이벤트 (scaler API에서 수집) */
export interface ScalingEvent {
  timestamp: string;
  fromVcpu: number;
  toVcpu: number;
  trigger: 'auto' | 'manual' | 'predictive';
  reason: string;
}

// ============================================================
// Daily Accumulated Data
// ============================================================

/** 24시간 축적 데이터 (보고서 생성의 입력) */
export interface DailyAccumulatedData {
  /** 대상 날짜 (YYYY-MM-DD) */
  date: string;
  /** 데이터 수집 시작 시간 (ISO 8601) */
  startTime: string;
  /** 마지막 스냅샷 시간 (ISO 8601) */
  lastSnapshotTime: string;
  /** 5분 간격 스냅샷 (최대 288개) */
  snapshots: MetricSnapshot[];
  /** 시간별 요약 (24개) */
  hourlySummaries: HourlySummary[];
  /** 로그 분석 결과 */
  logAnalysisResults: LogAnalysisEntry[];
  /** 스케일링 이벤트 */
  scalingEvents: ScalingEvent[];
  /** 데이터 품질 메타데이터 */
  metadata: {
    /** 예상 대비 실제 수집률 (0-1) */
    dataCompleteness: number;
    /** 데이터 수집 갭 (서버 재시작 등) */
    dataGaps: Array<{ start: string; end: string; reason: string }>;
  };
}

// ============================================================
// Accumulator State (메모리 싱글톤)
// ============================================================

/** 축적기 내부 상태 */
export interface AccumulatorState {
  currentDate: string;
  data: DailyAccumulatedData;
  lastSnapshotTimestamp: number;
  startedAt: string;
}

// ============================================================
// API Types
// ============================================================

/** POST /api/reports/daily 요청 바디 */
export interface DailyReportRequest {
  /** 대상 날짜 (생략 시 오늘) */
  date?: string;
  /** 기존 보고서 덮어쓰기 */
  force?: boolean;
  /** 디버그 정보 포함 (프롬프트, 토큰 수) */
  debug?: boolean;
}

/** POST /api/reports/daily 응답 */
export interface DailyReportResponse {
  success: boolean;
  /** 생성된 보고서 파일 경로 */
  reportPath?: string;
  /** 보고서 마크다운 내용 */
  reportContent?: string;
  error?: string;
  /** 디버그 정보 */
  debug?: {
    promptTokens: number;
    completionTokens: number;
    systemPrompt: string;
    userPrompt: string;
  };
  metadata: {
    date: string;
    generatedAt: string;
    dataCompleteness: number;
    snapshotCount: number;
    processingTimeMs: number;
  };
}
```

---

## 5. 구현 명세

### 5.1 `src/lib/daily-accumulator.ts` — 메트릭 축적기

**역할**: 5분 간격으로 `metrics-store.ts`의 ring buffer에서 통계 스냅샷을 저장하여 24시간 데이터를 축적.

**의존성**:
- `getMetricsStats()` from `@/lib/metrics-store` — ring buffer 통계 반환
- `getRecentMetrics(count)` from `@/lib/metrics-store` — 최근 메트릭 반환
- 타입: `MetricSnapshot`, `HourlySummary`, `DailyAccumulatedData`, `AccumulatorState`, `LogAnalysisEntry`, `ScalingEvent` from `@/types/daily-report`

**반드시 읽어야 할 기존 코드**:
- `src/lib/metrics-store.ts` — `getMetricsStats()`의 반환 타입 `MetricsStoreStats` 확인
- `src/types/prediction.ts` — `MetricsStoreStats`, `MetricStatSummary` 타입 확인

**상수**:
```typescript
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;  // 5분
const MAX_SNAPSHOTS_PER_DAY = 288;            // 24 * 60 / 5
```

**싱글톤 상태**: 모듈 레벨 변수로 `AccumulatorState | null` 관리.

**Export 함수**:

| 함수 | 시그니처 | 설명 |
|------|----------|------|
| `initializeAccumulator` | `(): void` | 축적기 초기화 (날짜별). 이미 오늘 초기화됨이면 skip. |
| `takeSnapshot` | `(): MetricSnapshot \| null` | ring buffer에서 스냅샷 생성. 4분 미만 간격이면 null 반환 (중복 방지). `getMetricsStats()` 호출. 데이터 없으면 null. 성공 시 `snapshots[]`에 push + hourly summary 업데이트. |
| `addLogAnalysisResult` | `(entry: LogAnalysisEntry): void` | 로그 분석 결과 추가 |
| `addScalingEvent` | `(event: ScalingEvent): void` | 스케일링 이벤트 추가. hourly summary의 `vcpuChanges`에도 기록. |
| `getAccumulatedData` | `(date?: string): DailyAccumulatedData \| null` | 축적 데이터 반환. 오늘 데이터만 가용. 날짜 불일치 시 null. |
| `getAccumulatorStatus` | `(): { initialized, currentDate, snapshotCount, lastSnapshotTime, dataCompleteness }` | 상태 조회 (디버깅/API용) |
| `resetAccumulator` | `(): void` | 상태 초기화 (테스트용) |

**Hourly summary 업데이트 로직**:
```typescript
// 누적 이동 평균
const n = summary.snapshotCount;
summary.avgCpu = (summary.avgCpu * n + snapshot.cpu.mean) / (n + 1);
summary.maxCpu = Math.max(summary.maxCpu, snapshot.cpu.max);
// ... (txPool, gasRatio, blockInterval 동일 패턴)
summary.snapshotCount = n + 1;

// 블록 생성 수 추정: 5분 / 평균 블록 간격
if (snapshot.blockInterval.mean > 0) {
  summary.blocksProduced += Math.round(300 / snapshot.blockInterval.mean);
}
```

**날짜 변경 처리**: `takeSnapshot()` 호출 시 현재 날짜와 `state.currentDate` 비교. 변경되었으면 `initializeAccumulator()` 호출하여 새 날짜 데이터 생성. 이전 데이터는 소실됨 (자정 전 보고서 생성이 이를 방지).

**데이터 완성도 계산**:
```typescript
const elapsedMinutes = (now - startOfDay) / 60000;
const expectedSnapshots = Math.floor(elapsedMinutes / 5);
dataCompleteness = actualSnapshots / expectedSnapshots;  // 0-1
```

---

### 5.2 `src/lib/daily-report-generator.ts` — 보고서 생성기

**역할**: 축적 데이터를 AI 프롬프트로 변환하고, Claude Opus 4.6을 호출하여 마크다운 보고서를 생성·저장.

**의존성**:
- `fs.promises` (mkdir, writeFile, readFile, readdir, access)
- `path`
- 타입: `DailyAccumulatedData`, `DailyReportResponse`, `HourlySummary` from `@/types/daily-report`

**반드시 읽어야 할 기존 코드**:
- `src/lib/predictive-scaler.ts` — AI Gateway 호출 패턴. 동일 엔드포인트/인증 사용. 차이: 모델을 `claude-opus-4-6`으로, temperature를 `0.3`으로 설정.

**상수**:
```typescript
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const REPORTS_DIR = process.env.REPORTS_DIR || 'data/reports';
```

**Export 함수**:

| 함수 | 시그니처 | 설명 |
|------|----------|------|
| `generateDailyReport` | `(data: DailyAccumulatedData, options?: { force?: boolean; debug?: boolean }): Promise<DailyReportResponse>` | 메인 보고서 생성. 기존 보고서 있으면 force 필요. |
| `readExistingReport` | `(date: string): Promise<string \| null>` | 파일 시스템에서 보고서 읽기 |
| `listReports` | `(): Promise<string[]>` | 보고서 파일 목록 반환 (날짜 역순) |

**AI 호출 코드** (predictive-scaler.ts 패턴 준수):
```typescript
const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'claude-opus-4-6',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  }),
});

const result = await response.json();
const content = result.choices[0]?.message?.content || '';
const promptTokens = result.usage?.prompt_tokens || 0;
const completionTokens = result.usage?.completion_tokens || 0;
```

**보고서 파일 저장 형식**:
```markdown
---
title: SentinAI 일일 운영 보고서
date: 2026-02-06
generated: 2026-02-06T23:55:00.000Z
generator: claude-opus-4-6
---

(AI 생성 마크다운 내용)

---
*이 보고서는 SentinAI에 의해 자동 생성되었습니다.*
```

---

### 5.3 AI 프롬프트 템플릿

#### System Prompt

```
당신은 Optimism L2 노드 운영 전문가입니다. 제공된 24시간 운영 데이터를 분석하여 한국어로 일일 운영 보고서를 작성합니다.

보고서 구조:

# SentinAI 일일 운영 보고서 — {날짜}

## 1. 요약 (Executive Summary)
하루 전체 운영 상태를 3-4문장으로 요약합니다.

## 2. 핵심 지표 분석
### 2.1 CPU 사용률
시간대별 패턴, 피크 시간, 평균 부하 분석.
### 2.2 트랜잭션 풀
TxPool pending 추이, 비정상적 급증 여부.
### 2.3 Gas 사용률
Gas 사용 비율 추이, EVM 연산 부하 분석.
### 2.4 블록 생성
블록 간격 추이, 총 블록 수, 체인 건강성 평가.

## 3. 리소스 스케일링 리뷰
스케일링 이벤트 적절성 평가, vCPU 변경 이력 분석.
스케일링 이벤트가 없었다면 현재 리소스가 적절한지 평가.

## 4. 이상 징후 및 보안
로그 분석에서 발견된 warning/critical 이슈 분석.
이슈가 없었다면 "이상 없음"으로 기록.

## 5. 권고사항
발견된 이슈에 대한 구체적 조치 제안.
트렌드 기반 내일 예측 및 사전 조치 권고.

작성 규칙:
- 한국어로 작성
- 마크다운 형식 (헤더, 테이블, 목록 활용)
- 데이터에 근거한 객관적 분석
- 데이터 부족 시 해당 섹션에서 명시적으로 언급
- 권고사항은 Optimism 공식 문서(https://docs.optimism.io/) 기반
```

#### User Prompt (헬퍼 함수로 조립)

```
# {date} 운영 데이터

## 메타데이터
- 데이터 수집 시작: {startTime}
- 마지막 스냅샷: {lastSnapshotTime}
- 데이터 완성도: {dataCompleteness}%
- 총 스냅샷 수: {snapshots.length}개

## 전체 통계 (24시간)
- 평균 CPU: {avgCpu}%, 최대: {maxCpu}%
- 평균 TxPool: {avgTxPool}, 최대: {maxTxPool}
- 평균 Gas 비율: {avgGasRatio}%
- 평균 블록 간격: {avgBlockInterval}초

## 시간별 상세
| 시간 | 평균 CPU | 최대 CPU | 평균 TxPool | Gas 비율 | 블록 간격 | 블록 수 |
|------|----------|----------|-------------|----------|-----------|---------|
| 00:00 | 15.2% | 22.1% | 12 | 10.5% | 2.01s | 149 |
| 01:00 | 12.8% | 18.3% | 8 | 8.2% | 2.03s | 148 |
| ... | ... | ... | ... | ... | ... | ... |
(snapshotCount > 0인 시간대만 포함)

## 스케일링 이벤트 ({n}건)
- 14:32: 1 vCPU → 2 vCPU (auto, CPU rising trend 65%)
- 18:05: 2 vCPU → 1 vCPU (auto, Load normalized)
(없으면 "스케일링 이벤트 없음")

## 로그 분석 결과 ({n}건)
- [WARNING] 09:15 (op-geth): P2P peer dropped rate increased
- [CRITICAL] 14:30 (op-node): Derivation stall detected
(없으면 "로그 이상 없음")
(severity가 normal인 항목은 건수만 표시)

## 데이터 갭
- 03:15 ~ 03:40: server_restart
(없으면 "없음")

위 데이터를 바탕으로 일일 운영 보고서를 작성해주세요.
```

**User prompt 조립 헬퍼 함수**:
- `formatHourlySummaryTable(summaries: HourlySummary[]): string` — `snapshotCount > 0`인 시간만 테이블 행으로 변환
- `summarizeScalingEvents(data: DailyAccumulatedData): string` — 시간 + from/to + trigger + reason
- `summarizeLogAnalysis(data: DailyAccumulatedData): string` — warning/critical만 상세, 나머지 건수 표시
- `calculateOverallStats(snapshots: MetricSnapshot[]): object` — 전체 스냅샷의 평균/최대 계산

---

### 5.4 `src/lib/scheduler.ts` — 스케줄러

**역할**: `node-cron`으로 5분 스냅샷 + 매일 23:55 보고서 생성 예약.

**의존성**:
- `node-cron` (npm 패키지, 신규 설치 필요)
- `daily-accumulator.ts`의 `takeSnapshot`, `getAccumulatedData`, `initializeAccumulator`
- `daily-report-generator.ts`의 `generateDailyReport`
- `log-ingester.ts`의 `getAllLiveLogs` (보고서 생성 시 최신 로그 수집)

**Export 함수**:

| 함수 | 시그니처 | 설명 |
|------|----------|------|
| `initializeScheduler` | `(): void` | cron job 등록. 중복 호출 방지 (idempotent). |
| `stopScheduler` | `(): void` | cron job 중지 (테스트용) |
| `getSchedulerStatus` | `(): { initialized, snapshotTaskRunning, reportTaskRunning }` | 상태 조회 |

**Cron 스케줄**:
```typescript
// 5분마다 스냅샷
cron.schedule('*/5 * * * *', () => takeSnapshot(), { timezone: 'Asia/Seoul' });

// 매일 23:55 보고서 생성
cron.schedule('55 23 * * *', async () => {
  const data = getAccumulatedData();
  if (data) {
    await generateDailyReport(data);
  }
}, { timezone: 'Asia/Seoul' });
```

---

### 5.5 `src/instrumentation.ts` — Next.js 서버 시작 훅

**역할**: 서버 시작 시 스케줄러를 초기화.

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeScheduler } = await import('./lib/scheduler');
    initializeScheduler();
  }
}
```

**주의**: `import()`를 사용하는 이유는 `node-cron`이 Edge 런타임에서 동작하지 않기 때문. `NEXT_RUNTIME === 'nodejs'` 체크 필수.

---

### 5.6 `src/app/api/reports/daily/route.ts` — API 엔드포인트

**의존성**:
- `NextRequest`, `NextResponse` from `next/server`
- `getAccumulatedData`, `getAccumulatorStatus` from `@/lib/daily-accumulator`
- `generateDailyReport`, `readExistingReport`, `listReports` from `@/lib/daily-report-generator`
- 타입: `DailyReportRequest`, `DailyReportResponse` from `@/types/daily-report`

#### GET /api/reports/daily

| 쿼리 파라미터 | 설명 | 응답 |
|---------------|------|------|
| `status=true` | 축적기 상태 | `{ success, data: AccumulatorStatus }` |
| `list=true` | 보고서 목록 | `{ success, data: { reports: string[] } }` |
| `date=YYYY-MM-DD` | 특정 보고서 조회 | `{ success, data: { date, content } }` 또는 404 |
| (없음) | 기본: 축적기 상태 + 최근 보고서 7개 목록 | `{ success, data: { accumulator, recentReports } }` |

**날짜 형식 검증**: `/^\d{4}-\d{2}-\d{2}$/` 정규식. 불일치 시 400.

#### POST /api/reports/daily

**Request Body** (JSON):
```json
{
  "date": "2026-02-06",   // optional, default: today
  "force": false,          // optional, overwrite existing
  "debug": false           // optional, include prompts
}
```

**처리 흐름**:
1. 날짜 결정 (body.date || 오늘)
2. 날짜 형식 검증
3. `getAccumulatedData(targetDate)` 호출. null이면 400 반환.
4. `generateDailyReport(data, { force, debug })` 호출
5. 결과 반환

---

## 6. 기존 파일 수정

### 6.1 `src/app/api/scaler/route.ts` — 스케일링 이벤트 기록

**수정 위치**: POST 핸들러 내 스케일링 히스토리 추가 직후 (현재 line 251-260 부근)

**추가 import**:
```typescript
import { addScalingEvent } from '@/lib/daily-accumulator';
```

**추가 코드** (기존 `addScalingHistory()` 호출 바로 뒤):
```typescript
// Record scaling event in daily accumulator
addScalingEvent({
  timestamp: result.timestamp,
  fromVcpu: result.previousVcpu,
  toVcpu: result.currentVcpu,
  trigger: triggeredBy === 'auto' ? 'auto' : 'manual',
  reason: decision.reason,
});
```

**위치 참조**: `src/app/api/scaler/route.ts` line 251-260 부근의 `if (!dryRun && result.success && result.previousVcpu !== result.currentVcpu)` 블록 내부.

### 6.2 `src/app/api/analyze-logs/route.ts` — 로그 분석 결과 기록

**수정 위치**: `analyzeLogChunk()` 호출 직후, `NextResponse.json()` 반환 전.

**추가 import**:
```typescript
import { addLogAnalysisResult } from '@/lib/daily-accumulator';
```

**추가 코드** (현재 line 24 `const analysis = await analyzeLogChunk(logData);` 직후):
```typescript
// Record analysis result in daily accumulator
if (analysis) {
  addLogAnalysisResult({
    timestamp: new Date().toISOString(),
    severity: analysis.severity,
    summary: analysis.summary,
    actionItem: analysis.action_item,
  });
}
```

### 6.3 `next.config.ts`

**현재 내용**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

**수정 후**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
```

### 6.4 `package.json`

**추가 의존성**:
```bash
npm install node-cron
npm install -D @types/node-cron
```

### 6.5 `Dockerfile`

**현재 line 58-59** (`.next` 디렉토리 생성 부분 바로 뒤에 추가):
```dockerfile
RUN mkdir -p data/reports \
    && chown nextjs:nodejs data/reports
```

**주의**: `USER nextjs` 이전에 배치해야 함.

### 6.6 `docker-compose.yml`

**현재 내용**:
```yaml
services:
  sentinai:
    build: .
    container_name: sentinai
    ports:
      - "3002:3000"
    env_file:
      - .env.local
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 5s
      retries: 3
```

**수정 후**:
```yaml
services:
  sentinai:
    build: .
    container_name: sentinai
    ports:
      - "3002:3000"
    env_file:
      - .env.local
    volumes:
      - sentinai-reports:/app/data/reports
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 5s
      retries: 3

volumes:
  sentinai-reports:
    driver: local
```

---

## 7. 에러 처리

| 상황 | 동작 |
|------|------|
| Ring buffer 비어있음 | `takeSnapshot()` → null 반환, 로그 기록 |
| AI API 키 미설정 | `generateDailyReport()` → error 반환 |
| AI API 호출 실패 (네트워크/5xx) | error 반환, 재시도 없음 |
| AI 응답 비정상 | `choices[0]?.message?.content \|\| ''` 폴백 |
| 파일 시스템 쓰기 실패 | error 반환, `reportContent`는 API 응답에 포함 |
| 기존 보고서 존재 | `force=false`이면 에러, `force=true`이면 덮어쓰기 |
| 데이터 < 10 스냅샷 | `console.warn()` 경고, 보고서 생성 진행 |
| 서버 재시작 | 축적기 초기화 (이전 데이터 소실), `metadata.dataGaps`에 기록 |
| 날짜 변경 (자정) | 새 날짜 데이터 구조 자동 생성. 23:55 보고서가 이전 데이터 보존. |
| `getAccumulatedData()` 과거 날짜 요청 | null 반환 (인메모리, 오늘만 가용) |

---

## 8. 환경 변수

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `AI_GATEWAY_URL` | `https://api.ai.tokamak.network` | N | LiteLLM 게이트웨이 URL |
| `ANTHROPIC_API_KEY` | (없음) | Y | AI API 키 (리포트 생성에 필수) |
| `REPORTS_DIR` | `data/reports` | N | 보고서 저장 디렉토리 |

---

## 9. 검증 절차

### 9.1 빌드 검증
```bash
npm install                    # node-cron 설치
npm run build                  # TypeScript 컴파일 확인
npm run lint                   # ESLint 확인
```

### 9.2 축적기 동작 확인
```bash
# 서버 시작
npm run dev

# 5분 후 축적기 상태 확인
curl http://localhost:3002/api/reports/daily?status=true
# 기대 응답: { "success": true, "data": { "initialized": true, "snapshotCount": 1, ... } }
```

### 9.3 수동 보고서 생성
```bash
# 보고서 생성 (debug 모드)
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{"debug": true}'

# 기대: success=true, reportContent에 한국어 마크다운 보고서
# 기대: data/reports/YYYY-MM-DD.md 파일 생성
```

### 9.4 보고서 조회
```bash
# 보고서 목록
curl "http://localhost:3002/api/reports/daily?list=true"

# 특정 보고서 조회
curl "http://localhost:3002/api/reports/daily?date=2026-02-06"
```

### 9.5 중복 방지 확인
```bash
# 동일 날짜 재생성 시도 (force 없이)
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{}'
# 기대: success=false, error에 "already exists" 메시지

# force로 덮어쓰기
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
# 기대: success=true
```

### 9.6 Seed 데이터로 보고서 테스트

데이터가 부족한 개발 환경에서는 기존 seed API를 활용:

```bash
# 1. 시나리오 데이터 주입
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# 2. 스냅샷 수동 트리거 (축적기가 자동 스냅샷하기 전에 테스트)
#    → 서버 시작 후 5분 대기하거나, 여러 시나리오를 순서대로 주입

# 3. 보고서 생성
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{"debug": true}'
```

---

## 10. 구현 순서

```
Phase 1: 타입 + 의존성
  1. package.json — node-cron 설치
  2. src/types/daily-report.ts — 전체 타입 정의

Phase 2: 핵심 모듈
  3. src/lib/daily-accumulator.ts — 메트릭 축적기
  4. src/lib/daily-report-generator.ts — AI 보고서 생성기
  5. src/lib/scheduler.ts — cron 스케줄러

Phase 3: 서버 통합
  6. src/instrumentation.ts — 서버 시작 훅
  7. next.config.ts — instrumentationHook 활성화
  8. src/app/api/reports/daily/route.ts — API 엔드포인트

Phase 4: 기존 코드 통합
  9. src/app/api/scaler/route.ts — addScalingEvent 추가
  10. src/app/api/analyze-logs/route.ts — addLogAnalysisResult 추가

Phase 5: Docker
  11. Dockerfile — data/reports 디렉토리
  12. docker-compose.yml — 볼륨 마운트

Phase 6: 검증
  13. npm run build && npm run lint
  14. 수동 테스트 (Section 9)
```

---

## 부록 A: `getMetricsStats()` 반환 타입 참조

```typescript
// src/types/prediction.ts에서 발췌

interface MetricsStoreStats {
  count: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  stats: {
    cpu: MetricStatSummary;
    txPool: MetricStatSummary;
    gasUsedRatio: MetricStatSummary;
    blockInterval: MetricStatSummary;
  };
}

interface MetricStatSummary {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  trend: 'rising' | 'falling' | 'stable';
  slope: number;
}
```

## 부록 B: AI Gateway 호출 패턴 참조

```typescript
// src/lib/predictive-scaler.ts에서 발췌 (동일 패턴 사용)

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'claude-haiku-4.5',   // ← 일일 보고서에서는 'claude-opus-4-6' 사용
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,            // ← 일일 보고서에서는 0.3 사용
  }),
});

const result = await response.json();
const content = result.choices[0]?.message?.content || '';
```

## 부록 C: `LogAnalysisResult` 타입 참조

```typescript
// src/lib/ai-analyzer.ts에서 발췌

interface LogAnalysisResult {
  severity: 'normal' | 'warning' | 'critical';
  summary: string;
  action_item: string;
  timestamp: string;
}
```

## 부록 D: analyze-logs/route.ts 전체 코드

```typescript
// src/app/api/analyze-logs/route.ts 현재 전체 코드
// 수정 지점 파악을 위한 참조

import { NextResponse } from 'next/server';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { generateMockLogs, getAllLiveLogs } from '@/lib/log-ingester';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'normal';

    let logData: Record<string, string>;

    if (mode === 'live') {
        logData = await getAllLiveLogs();
    } else if (mode === 'attack') {
        logData = generateMockLogs('attack');
    } else {
        logData = generateMockLogs('normal');
    }

    // Call AI (Claude)
    const analysis = await analyzeLogChunk(logData);

    // ← addLogAnalysisResult() 호출 위치: 여기 (analysis 결과 직후, return 전)

    return NextResponse.json({
        source: mode === 'live' ? 'k8s-multi-pod-stream' : 'simulated-multi-log',
        raw_logs_preview: JSON.stringify(logData).substring(0, 500) + "...",
        analysis
    });
}
```
