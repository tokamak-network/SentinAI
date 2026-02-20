# SentinAI 모델 벤치마크 가이드

## 지원 모델 및 가격

SentinAI 벤치마크는 4개 AI 제공자의 모델을 지원합니다.

### 1. Qwen (알리바바) 🟢 **권장**

**설정:**
- 환경변수: `QWEN_API_KEY`, `QWEN_BASE_URL` (선택), `QWEN_MODEL` (선택)
- 기본 엔드포인트: `https://dashscope.aliyuncs.com/compatible-mode`
- 호환성: OpenAI `/v1/chat/completions` 호환

**모델:**

| Tier | 모델명 | 입력 가격 | 출력 가격 | 응답 속도 | 특징 |
|------|--------|---------|---------|---------|------|
| **fast** | `qwen-turbo-latest` | $0.50/M | $0.50/M | ⚡⚡⚡ 빠름 | 경량, 저비용 |
| **best** | `qwen-max-latest` | $2.00/M | $2.00/M | ⚡⚡ 보통 | 고품질, 중간 비용 |

**환경변수 예시:**
```bash
QWEN_API_KEY=your-qwen-api-key-here
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode
QWEN_MODEL=qwen-turbo-latest  # 선택사항: 기본 모델 오버라이드
```

**장점:**
✅ 가장 저렴
✅ 빠른 응답
✅ OpenAI 호환 API
✅ 한국어 처리 우수

---

### 2. Anthropic (Claude) 🔵 **높은 품질**

**설정:**
- 환경변수: `ANTHROPIC_API_KEY`
- 엔드포인트: `https://api.anthropic.com`

**모델:**

| Tier | 모델명 | 입력 가격 | 출력 가격 | 응답 속도 | 특징 |
|------|--------|---------|---------|---------|------|
| **fast** | `claude-haiku-4-5-20251001` | $0.80/M | $0.15/M | ⚡⚡⚡ 빠름 | 간단한 작업 |
| **best** | `claude-sonnet-4-5-20250929` | $3.00/M | $15.00/M | ⚡⚡ 보통 | 복잡한 분석 |

**환경변수 예시:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**장점:**
✅ 우수한 정확도
✅ 안정적인 API
✅ 한글 처리 우수
✅ 긴 컨텍스트 지원

**단점:**
❌ 중간~고가
❌ Haiku는 단순 작업만 가능

---

### 3. OpenAI (GPT) 🟡 **⚠️ 모델명 확인 필요**

**설정:**
- 환경변수: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (선택), `OPENAI_MODEL` (선택)
- 엔드포인트: `https://api.openai.com` 또는 호환 프록시
- 오버라이드: `OPENAI_MODEL_FAST`, `OPENAI_MODEL_BEST`

**모델:**

| Tier | 설정된 모델명 | 입력 가격 | 출력 가격 | 응답 속도 | ⚠️ 주의 |
|------|--------|---------|---------|---------|--------|
| **fast** | `gpt-4.1-mini` | $0.15/M | $0.60/M | ⚡⚡⚡ | **확인 필요** |
| **best** | `gpt-4.1` | $30.00/M | $60.00/M | ⚡ 느림 | **확인 필요** |

**실제 OpenAI 모델명** (2026-02):
- `gpt-4-turbo` ← 권장
- `gpt-4o` ← 최신
- `gpt-3.5-turbo` ← 저가 대체
- `o1` ← 추론 전문

**환경변수 예시:**
```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com  # 또는 프록시 URL
OPENAI_MODEL=gpt-4-turbo                # 모든 tier 기본값
OPENAI_MODEL_FAST=gpt-3.5-turbo         # fast tier 오버라이드
OPENAI_MODEL_BEST=gpt-4o                # best tier 오버라이드
```

**장점:**
✅ 최고의 정확도 (gpt-4 시리즈)
✅ 엔터프라이즈급 지원

**단점:**
❌ 가장 비쌈
❌ 응답이 느림

---

### 4. Gemini (Google) 🟣

**설정:**
- 환경변수: `GEMINI_API_KEY`
- 엔드포인트: `https://generativelanguage.googleapis.com`

**모델:**

| Tier | 모델명 | 입력 가격 | 출력 가격 | 응답 속도 | 특징 |
|------|--------|---------|---------|---------|------|
| **fast** | `gemini-2.5-flash-lite` | $0.075/M | $0.30/M | ⚡⚡⚡ 빠름 | 경량 |
| **best** | `gemini-2.5-pro` | $1.50/M | $6.00/M | ⚡⚡ 보통 | 고급 분석 |

**환경변수 예시:**
```bash
GEMINI_API_KEY=AIzaSy...
```

**장점:**
✅ 가성비 좋음
✅ 빠른 응답
✅ 멀티모달 지원

**단점:**
❌ 한글 처리 중간

---

## 벤치마크 실행 방법

### 기본 실행

```bash
# 모든 설정된 provider 테스트 (3회 반복)
npm run benchmark

# Qwen만 테스트 (1회 반복, 빠른 테스트)
npm run benchmark -- --providers qwen --iterations 1

# Claude + OpenAI 비교 (2회 반복)
npm run benchmark -- --providers anthropic,openai --iterations 2
```

### 결과 해석

생성되는 파일:
- **CSV**: `benchmark-results/YYYY-MM-DDTHH-MM-SS.csv`
  - 원시 데이터 (응답 시간, 토큰, 비용, 정확도, 에러)
- **Markdown**: `benchmark-results/YYYY-MM-DDTHH-MM-SS.md`
  - 요약 리포트 (순위, 분석, 권고사항)

**CSV 열:**
```
prompt_id         # 테스트한 프롬프트 ID
provider          # AI 제공자 (qwen, anthropic, openai, gemini)
tier              # 모델 계층 (fast, best)
iteration         # 반복 번호
latency_ms        # 응답 시간 (밀리초)
tokens_in         # 입력 토큰 수
tokens_out        # 출력 토큰 수
cost_usd          # 예상 비용 (USD)
accuracy          # 정확도 (0 또는 1)
error             # 에러 메시지 (있을 경우)
```

---

## 테스트되는 프롬프트 (5개)

| ID | Tier | 설명 | 출력 형식 |
|----|------|------|---------|
| `predictive-scaler` | fast | AI 시계열 예측 | JSON |
| `anomaly-analyzer` | fast | 이상 징후 분석 | JSON |
| `rca-engine` | best | 근본 원인 분석 | JSON |
| `daily-report` | best | 일일 운영 보고서 | Markdown (한국어) |
| `nlops-responder` | fast | 자연어 응답 생성 | Text |

---

## 비용 추정

**프롬프트당 예상 비용 (1회 반복):**

| Provider | Tier | 예상 비용 | 가격 기준 |
|----------|------|---------|---------|
| **Qwen** | fast | $0.0002-0.0005 | 극저가 |
| **Qwen** | best | $0.0008-0.0015 | 저가 |
| **Claude** | fast | $0.0001-0.0002 | 저가 |
| **Claude** | best | $0.0050-0.0100 | 중가 |
| **GPT** | fast | $0.0001-0.0003 | 저가 |
| **GPT** | best | $0.1000-0.2000 | 고가 ⚠️ |
| **Gemini** | fast | $0.0001-0.0002 | 극저가 |
| **Gemini** | best | $0.0005-0.0010 | 저가 |

**전체 벤치마크 비용 (5 prompts × 1 iteration):**
- Qwen 만: ~$0.005
- Claude + Qwen: ~$0.015
- 모든 provider: ~$0.50+

---

## 트러블슈팅

### API 404 에러

```
Error: OpenAI API error 404: {"detail":"Not Found"}
```

**원인:** 모델명이 올바르지 않음
**해결:**
```bash
# 올바른 모델명으로 오버라이드
export OPENAI_MODEL=gpt-4-turbo
npm run benchmark -- --providers openai --iterations 1
```

### 타임아웃 에러

**원인:** API 응답이 느림 (네트워크/부하)
**해결:** 타임아웃 증가 및 반복 횟수 감소
```bash
# 번치마크 스크립트에서 timeoutFast/timeoutBest 수정 (기본값: 30000/60000ms)
```

### 인증 에러

```
Error: No AI API key configured
```

**원인:** 환경변수 미설정
**해결:**
```bash
# .env.local 확인
cat .env.local | grep API_KEY

# 또는 EC2 배포 시
bash scripts/install.sh
```

---

## 성능 비교 요약 (참고: 2026-02-13 테스트)

### 가성비 최고 🏆
**Qwen Turbo (fast tier)**
- 비용: $0.50/M input, $0.50/M output
- 속도: ⚡⚡⚡ 빠름
- 추천: 실시간 모니터링

### 품질 최고 🌟
**Claude Sonnet (best tier)**
- 비용: $3.00/M input, $15.00/M output
- 속도: ⚡⚡ 보통
- 추천: 복잡한 분석, RCA

### 균형 잡힌 선택 ⚖️
**Gemini Flash Lite (fast tier)**
- 비용: $0.075/M input, $0.30/M output
- 속도: ⚡⚡⚡ 빠름
- 추천: 비용 + 속도 균형

---

## 다음 단계

1. **벤치마크 실행**
   ```bash
   npm run benchmark -- --providers qwen --iterations 3
   ```

2. **결과 분석**
   - `benchmark-results/` 디렉토리에서 CSV/Markdown 확인

3. **A/B 테스트**
   - 프로덕션에서 특정 모델 조합 테스트 (Phase 2 기능)
   - `.env.local`에 `AB_TEST_ENABLED=true` 설정

---

**문서 갱신:** 2026-02-13
**벤치마크 버전:** 1.0.0
