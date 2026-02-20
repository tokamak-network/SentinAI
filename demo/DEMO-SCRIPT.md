# SentinAI Demo Script (15 min)

발표자 노트 — 각 슬라이드별 할 말/할 것 정리

---

## Slide 1: Title (30초)
- "Today I'll walk you through SentinAI — an autonomous monitoring and scaling system for L2 nodes."
- "It uses AI not just for alerts, but for prediction, diagnosis, and optimization."

## Slide 2: The Problem (1분 30초)
- L2 노드 운영의 3가지 문제:
  - **Reactive**: 문제 발생 후에야 대응 (cooldown 5분)
  - **Wasteful**: 트래픽 없는 시간에도 풀 리소스 → 40% 낭비
  - **Blind**: 예측 기능 0, 패턴 학습 0
- "Traditional monitoring is alert → human → action → hope. We wanted alert → AI → action → verify."

## Slide 3: Solution — 4 Core Features (2분)
- **P1 Predictive Scaling**: 5분 앞 부하 예측. Claude가 시계열 데이터 분석
- **P2 Anomaly Detection**: Z-score 기반 + AI 크로스 분석. op-geth, batcher, proposer, op-node 4개 컴포넌트 동시 감시
- **P3 RCA Engine**: 원클릭 근본 원인 분석. "왜?"를 알려줌
- **P4 Cost Optimizer**: 사용 패턴 분석 → 30-50% 절감 추천

## Slide 4: Architecture (2분)
- 2-lane 아키텍처:
  - **Top lane**: Metrics → Ring Buffer (60pts) → AI Prediction → Auto-scale
  - **Bottom lane**: Logs → Anomaly AI → RCA → NLOps Chat
- "9,700 lines of TypeScript. Everything talks to Claude Haiku 4.5 through a unified chatCompletion interface with automatic failover."

## Slide 5: Hybrid Scoring (1분 30초)
- 스케일링 결정은 단순 threshold가 아님
- Composite score 0-100:
  - CPU & Gas 60%, TxPool 20%, AI Severity 20%
- 3-tier: Idle(<30) → 1vCPU, Normal(30-70) → 2vCPU, High(>70) → 4vCPU
- Safety: 5분 cooldown + simulation mode by default

## Slide 6: AI Provider Strategy (1분)
- Multi-provider fallback: Claude → GPT → Gemini
- "If Tokamak Gateway is down, it automatically falls back to OpenAI, then Google."
- Unified `chatCompletion()` — 모든 AI 호출이 같은 인터페이스

## Slide 7: NLOps (1분 30초)
- 자연어로 인프라 제어
- Intent 분류: status / diagnose / scale / cost / predict / explain
- 데모에서 직접 보여줄 예정

---

## Slide 8: LIVE DEMO (4분)

### 사전 준비
```bash
cd /home/theo/SentinAI
npm run dev  # port 3002
```

### Demo Flow

**Step 1: Dashboard Overview (1분)**
- http://localhost:3002 접속
- L1/L2 block height 실시간 표시
- Component status cards
- Cost tracking section

**Step 2: Predictive Scaling (1분)**
- Seed selector → "rising" 선택
- AI가 분석 시작 → 결과: "Predicted: 4 vCPU, Confidence: 85%"
- "The AI sees the rising pattern and recommends scaling up before the spike hits."

**Step 3: Anomaly + RCA (1분)**
- Anomaly 섹션 확인
- "Run RCA" 버튼 클릭
- AI가 로그 분석 → 근본 원인 + 권장 조치 표시
- "One click — and you know exactly why, not just what."

**Step 4: NLOps Chat (1분)**
- Chat 패널 열기
- 입력: "What's the current system status?"
- AI가 실시간 메트릭 기반으로 답변
- 입력: "How can we reduce costs?"
- Cost optimization 추천 표시

---

## Slide 9: By the Numbers (30초)
- 빠르게 숫자 강조
- "9.7K lines, 7 endpoints, 22 modules, 3 AI providers, 6 proposals implemented"

## Slide 10: Roadmap (1분)
- P1-P6 완료 (green dots)
- P7 Redis State Store — 재시작 시 상태 유지
- P8 Auto-Remediation — AI가 직접 문제 해결 (runbook 기반)
- "The goal is fully autonomous operations — AI that doesn't just tell you what's wrong, but fixes it."

## Slide 11: Tech Stack (30초)
- Quick overview, 질문 있을 때 참고용

## Slide 12: Thank You + Q&A (2분)
- "Questions? Happy to dive into any part of the codebase."

---

## Tips
- 데모 전에 `npm run dev` 미리 켜놓기
- RCA는 AI 호출 시간 있으므로 (2-5초) 말로 채우기
- NLOps 질문은 미리 준비된 것 사용 (타이핑 시간 절약)
- 네트워크 불안정 대비: 스크린샷 백업 준비
