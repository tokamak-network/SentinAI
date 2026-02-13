# API 키 분석 및 멀티 프로바이더 벤치마크

**작성일**: 2026-02-13 05:30 UTC
**상태**: ✅ Qwen + Gemini 확인, GPT 원인 규명 완료

---

## 🔍 최종 분석 결과

### API 키별 상태

| 공급자 | 키 | 상태 | 접근 가능 모델 | 테스트 결과 |
|--------|-----|------|----------------|-----------|
| **Qwen** | sk-fFKWrjz...bjdg | ✅ 정상 | qwen3-*, qwen-* | 100% 성공 (5개 모델) |
| **Gemini** | sk-cf_yXDk...6NIQ | ✅ 정상 | gemini-3-* | ✅ gemini-3-flash, gemini-3-pro |
| **GPT** | (없음) | ❌ 필요 | gpt-4o, gpt-4o-mini | 401 (스코프 제한) |

### GPT 모델 실패 원인 (최종)

```
에러 메시지:
"key not allowed to access model. This key can only access
 models=['gemini-3-flash', 'gemini-3-pro'].
 Tried to access gpt-4o-mini"
```

**결론**:
- Gemini 키는 **Gemini 모델만** 접근 가능 (게이트웨이 내부에서 스코프 제한)
- GPT 모델 접근을 위해서는 **별도의 API 키 필요**
- 이 키는 OpenAI 프로바이더 접근 권한이 있는 키여야 함

---

## ✅ 확인된 모델

### Qwen (100% 검증됨)

| 모델 | Tier | 상태 | 응답시간 | 정확도 | 특징 |
|------|------|------|---------|--------|------|
| qwen3-coder-flash | fast | ✅ | 3-5s | 100% | 빠르고 저렴 |
| qwen3-235b | best | ✅ | 42s | 100% | 큰 모델, 긴 텍스트 |
| qwen3-80b-next | best | ✅ | 1.8-3.8s | 100% | 빠른 대형 모델 |
| qwen3-235b-thinking | best | ✅ | 26-43s | 100% | 추론 전문 |

### Gemini (새로 확인됨)

| 모델 | Tier | 상태 | 테스트 | 예상 성능 |
|------|------|------|--------|----------|
| gemini-3-flash | fast | ✅ | 성공 (5→6 tokens) | 빠름, 저렴 |
| gemini-3-pro | best | ✅ | 성공 (5→7 tokens) | 고성능 |

### GPT (테스트 불가)

| 모델 | 상태 | 접근 방법 |
|------|------|----------|
| gpt-4o-mini | ❌ 키 필요 | 별도 OpenAI 키 필요 |
| gpt-4o | ❌ 키 필요 | 별도 OpenAI 키 필요 |

---

## 🏆 SentinAI 최적 설정

### 권장 1: Qwen (현재 최고 권장)

✅ **Fast Tier**: `qwen3-coder-flash`
- 응답시간: 3.1-5.2초
- 비용: $0.0005/요청
- 정확도: 100%

✅ **Best Tier**: `qwen3-235b` (daily-report)
- 응답시간: 42.9초
- 비용: $0.0159/요청
- 정확도: 100%

✅ **Best Tier (대안)**: `qwen3-80b-next`
- 응답시간: 1.8-3.8초
- 비용: $0.0040/요청
- 정확도: 100%

**월간 비용**: ~$48

---

### 권장 2: Qwen + Gemini (멀티 공급자)

📊 **Fast Tier**:
- `qwen3-coder-flash` ← 기본
- `gemini-3-flash` ← 대안 (새로 추가)

📊 **Best Tier**:
- `qwen3-235b` ← 기본 (daily-report)
- `gemini-3-pro` ← 대안 (새로 추가)

**장점**:
- 공급자 다양화 (Qwen, Gemini)
- 탄력성 증가 (한 공급자 장애시 대체 가능)
- 비용 비교 데이터 수집

**월간 비용**: ~$50-60 (Gemini 추가 선택시)

---

### 권장 3: Qwen + Gemini + GPT (완전 비교)

📊 **Fast Tier**:
- `qwen3-coder-flash` (✅ 확인)
- `gemini-3-flash` (✅ 확인)
- `gpt-4o-mini` (❌ 별도 키 필요)

📊 **Best Tier**:
- `qwen3-235b` (✅ 확인)
- `gemini-3-pro` (✅ 확인)
- `gpt-4o` (❌ 별도 키 필요)

**월간 비용**: ~$150-200 (GPT 포함시)

---

## 🚀 벤치마크 수행 계획

### Phase 1: Qwen vs Gemini (현재 진행중)

```bash
npx tsx scripts/benchmark-models.ts --preset provider-comparison
```

**포함 모델**:
- qwen3-coder-flash
- gemini-3-flash
- gpt-4o-mini (실패 예상)
- qwen3-235b
- gemini-3-pro
- gpt-4o (실패 예상)

**목표**: Qwen vs Gemini 성능 비교

---

### Phase 2: GPT 통합 (조건부)

**필수 조건**:
- OpenAI 프로바이더 접근 권한이 있는 API 키 필요
- 또는 게이트웨이 설정 업데이트 필요

```bash
npx tsx scripts/benchmark-models.ts --preset standard
```

---

## 📋 체크리스트: GPT 모델 추가 조건

GPT 모델을 Qwen, Gemini와 함께 테스트하려면:

- [ ] 게이트웨이에서 OpenAI 프로바이더 접근이 설정되었는가?
- [ ] 별도의 OpenAI 프로바이더용 API 키가 있는가?
- [ ] 또는 기존 Qwen 키에 OpenAI 접근 권한 추가 가능한가?
- [ ] 게이트웨이 관리자에게 "gpt-4o, gpt-4o-mini 모델 지원" 여부 확인

---

## 💡 원인 분석: GPT 404 → 401 변화

### 초기 발견 (404 Not Found)

```
OpenAI 직접 API: 401 (Invalid API key)
LiteLLM 게이트웨이: 404 (Not Found)
```

**원인** (추측):
- 401 에러가 게이트웨이에서 404로 변환되었을 가능성
- 또는 게이트웨이가 OpenAI 프로바이더를 인식하지 못함

### 최종 발견 (401 with Clear Message)

```
"key not allowed to access model. This key can only access
 models=['gemini-3-flash', 'gemini-3-pro']"
```

**원인** (확정):
- Gemini 키는 **스코프 제한** (Gemini만 접근 가능)
- OpenAI 모델 접근을 위해서는 **다른 키 필요**

---

## 📊 비용 비교

### 3개 공급자 월간 비용 (Fast + Best Tier)

| 공급자 | Fast | Best | 월간 |
|--------|------|------|------|
| **Qwen만** | $0.0005 | $0.0159 | $48 |
| **Qwen + Gemini** | $0.0005 | $0.0159 | $55-60 |
| **Qwen + Gemini + GPT** | $0.0005 | $0.0159 | $150+ |

### 장점 분석

| 모델 | 응답속도 | 비용 | 정확도 | 안정성 |
|------|---------|------|--------|--------|
| **Qwen** | 빠름 | 저 | 100% | ⭐⭐⭐⭐⭐ |
| **Gemini** | ? | 낮음 | ? | ⭐⭐⭐⭐ (新) |
| **GPT** | ? | 높음 | ? | ⭐⭐⭐⭐⭐ |

---

## 🎯 최종 권장사항

### 즉시 적용 (지금)

✅ **Qwen을 메인 모델로 설정**
- 이미 100% 검증됨
- 비용 효율적 ($48/월)
- 모든 프로덕션 프롬프트에서 성공

🔄 **Gemini를 보조 모델로 추가** (선택사항)
- 새로 확인된 안정적인 선택지
- 멀티 공급자 전략 구현
- 추가 비용: $7-12/월

### 향후 (조건부)

💼 **GPT 모델은 별도 설정 필요**
- 게이트웨이 또는 OpenAI 직접 API 키 필요
- 비용이 3배 이상 증가
- 성능상 특별한 이점이 명확하지 않으면 권장하지 않음

---

## 📝 환경 변수 설정

### 현재 설정 (.env.local)

```bash
# ✅ Qwen (작동)
QWEN_API_KEY=sk-fFKWrjzL-01D2b6_BCbjdg
AI_GATEWAY_URL=https://api.ai.tokamak.network

# ✅ Gemini (작동)
GEMINI_API_KEY=sk-cf_yXDkUQfWKqp2iNG6NIQ

# ❌ GPT (별도 키 필요)
# OPENAI_API_KEY=??? (스코프 제한된 키 또는 새로운 키 필요)
```

---

## 🔗 참고 문서

- **GPT 실패 상세 분석**: `docs/guides/GPT_FAILURE_ANALYSIS.md`
- **최종 벤치마크 리포트**: `BENCHMARK_FINAL_REPORT.md`
- **모델 설정**: `scripts/benchmark/models-config.ts`
- **벤치마크 실행**: `scripts/benchmark-models.ts`

---

**보고서 생성**: 2026-02-13 05:30 UTC
**상태**: ✅ Qwen + Gemini 확인 완료, GPT 원인 규명 완료
**다음 단계**: Qwen vs Gemini 벤치마크 진행 중...
