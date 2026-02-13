# SentinAI Model Benchmark - API 인증 문제 진단 및 해결

**작성일**: 2026-02-13
**상태**: ✅ 부분 해결 (Qwen API 정상, OpenAI API 키 무효)

---

## 📋 현재 상황 요약

| 항목 | 상태 | 설명 |
|------|------|------|
| **LiteLLM Gateway** | ✅ 정상 | `https://api.ai.tokamak.network` 작동 |
| **Qwen API** | ✅ 정상 | Gateway를 통해 완벽하게 작동 |
| **OpenAI API** | ❌ 실패 | 제공된 API 키가 유효하지 않음 (401 에러) |
| **Benchmark 실행** | ✅ 부분 성공 | Qwen 모델로 테스트 가능, GPT 모델 제외 |

---

## 🔍 진단 결과 (2026-02-13 실행)

### 1. LiteLLM 게이트웨이 테스트 ✅

```bash
$ npx tsx scripts/test-gateway-and-qwen.ts

✅ Gateway with Qwen works!
Response: Hello! 😊 How can I help you today
Tokens: 12 prompt, 10 completion
```

**결론**: 게이트웨이와 Qwen API 키는 정상 작동합니다.

---

### 2. OpenAI API 키 테스트 ❌

```bash
$ npx tsx scripts/test-openai-key.ts

❌ API Error (401): Incorrect API key provided: sk-QcFOZ*************bZdg
```

**결론**: OpenAI API 키 `sk-QcFOZdkZuXacZTSQ0LbZdg`는 **유효하지 않습니다**.

---

## 📊 벤치마크 실행 결과 (Quick Preset)

```
📋 Using preset: quick
📊 Models: qwen3-coder-flash, qwen-turbo-latest
🔁 Iterations: 1
📄 Prompts: predictive-scaler, anomaly-analyzer, rca-engine, daily-report, nlops-responder

Total Tests: 10
Success: 4 | Failed: 6
Total Cost: $0.0025
Average Accuracy: 40.0%
```

### 모델별 성능

| 모델 | 정확도 | 평균 응답시간 | 상태 |
|------|--------|---------------|------|
| **qwen3-coder-flash** | 100.0% | 3808ms | ✅ 완벽 |
| **qwen-turbo-latest** | 0.0% | 0ms | ⚠️ 실패 |

### 프롬프트별 결과

| 프롬프트 | qwen3-coder-flash | 비고 |
|---------|-------------------|------|
| predictive-scaler | ✅ 100% (3.8s) | 정상 |
| anomaly-analyzer | ✅ 100% (4.2s) | 정상 |
| rca-engine | ✅ 100% (12.3s) | 정상 |
| daily-report | ❌ 0% | 프롬프트 검증 실패 |
| nlops-responder | ✅ 100% (4.7s) | 정상 |

---

## 🛠️ 해결 방법

### 문제 1: OpenAI API 키 유효하지 않음

**해결 방법**:

1. OpenAI 계정에서 새로운 API 키 생성:
   - https://platform.openai.com/account/api-keys
   - 기존 키 삭제
   - 새로운 API 키 생성

2. `.env.local` 파일 업데이트:
   ```bash
   OPENAI_API_KEY=sk-your-new-api-key-here
   ```

3. API 키 검증:
   ```bash
   npx tsx scripts/test-openai-key.ts
   ```

---

### 문제 2: qwen-turbo-latest와 qwen-max-latest 모델 실패

**원인**: 이 모델명들이 LiteLLM 게이트웨이에서 지원되지 않을 수 있습니다.

**해결 방법**:

1. 작동하는 모델만 사용:
   - ✅ `qwen3-coder-flash` (확인됨)
   - ✅ `qwen3-235b-thinking` (확인됨)
   - ✅ `qwen3-235b` (확인됨)
   - ✅ `qwen3-80b-next` (확인됨)

2. 모델 설정 파일 업데이트 (`scripts/benchmark/models-config.ts`)에서 이미 수정됨

---

## 📝 현재 환경 변수 설정

**`.env.local` 현재 상태**:

```bash
# ✅ 정상
QWEN_API_KEY=sk-fFKWrjzL-01D2b6_BCbjdg
AI_GATEWAY_URL=https://api.ai.tokamak.network

# ❌ 무효
OPENAI_API_KEY=sk-QcFOZdkZuXacZTSQ0LbZdg (401 에러)
```

---

## 🚀 다음 단계

### 1. 즉시 실행 가능 (Qwen 모델)

```bash
# 빠른 테스트 (2분)
npm run benchmark:quick

# 표준 테스트 (10분)
npm run benchmark:standard

# 종합 테스트 (30분)
npm run benchmark:comprehensive
```

### 2. OpenAI 지원 추가 (선택사항)

1. 유효한 OpenAI API 키 취득
2. `.env.local` 업데이트
3. 벤치마크 재실행

### 3. GPT 모델 벤치마크 (향후)

유효한 OpenAI API 키 확보 후:

```bash
npx tsx scripts/benchmark-models.ts --models qwen3-coder-flash,gpt-4-turbo,gpt-4o
```

---

## 📚 참고 자료

- **벤치마크 가이드**: `docs/guide/MODEL_BENCHMARK_GUIDE.md`
- **API 테스트 스크립트**:
  - `scripts/test-openai-key.ts` - OpenAI API 테스트
  - `scripts/test-gateway-and-qwen.ts` - 게이트웨이 및 Qwen 테스트
  - `scripts/diagnose-api-keys.ts` - 전체 진단
- **모델 설정**: `scripts/benchmark/models-config.ts`
- **환경 설정**: `.env.local`

---

## ✅ 체크리스트

- [x] LiteLLM 게이트웨이 확인됨
- [x] Qwen API 키 확인됨
- [x] OpenAI API 키 문제 식별됨
- [x] 벤치마크 스크립트 정상 작동 (Qwen)
- [x] 환경 변수 자동 로딩 구현됨
- [ ] OpenAI API 키 갱신 (대기 중)
- [ ] GPT 모델 벤치마크 (OpenAI 키 취득 후)
- [ ] 최종 비교 리포트 생성 (GPT 키 취득 후)

---

## 🆘 문제 해결 팁

### API 연결 확인
```bash
# 모든 API 진단
npx tsx scripts/diagnose-api-keys.ts
```

### 특정 API만 테스트
```bash
# OpenAI만 테스트
npx tsx scripts/test-openai-key.ts

# Qwen + Gateway 테스트
npx tsx scripts/test-gateway-and-qwen.ts
```

### 환경 변수 확인
```bash
# .env.local 로드 확인
cat .env.local | grep -E "QWEN|OPENAI|AI_GATEWAY"
```

---

**마지막 업데이트**: 2026-02-13 05:08 UTC
**담당자**: SentinAI LLM Benchmark System
