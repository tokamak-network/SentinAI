# GPT 모델 API 실패 원인 분석 및 해결책

**작성일**: 2026-02-13
**주제**: GPT 모델이 404 에러를 반환하는 이유와 해결 방법

---

## 📊 문제 현황

### 관찰된 현상

| 테스트 방식 | 결과 | 에러 | 해석 |
|-----------|------|------|------|
| **OpenAI 직접 API** | ❌ 실패 | 401 Unauthorized | API 키 무효 |
| **LiteLLM 게이트웨이** | ❌ 실패 | 404 Not Found | 모델 미지원 또는 라우팅 오류 |

---

## 🔍 원인 분석

### 1️⃣ OpenAI 직접 API 실패 (401)

```
❌ API Error (401): Incorrect API key provided: sk-QcFOZdkZuXacZTSQ0LbZdg
```

**원인**: 제공된 OpenAI API 키가 유효하지 않음

**진단**:
- ✓ API 형식은 올바름 (sk- 접두사)
- ✓ 네트워크는 정상 (다른 API는 작동)
- ✗ API 키 자체가 **expired** 또는 **revoked**

---

### 2️⃣ LiteLLM 게이트웨이 실패 (404)

```
❌ OpenAI API error 404: {"detail":"Not Found"}
```

**원인**: LiteLLM 게이트웨이에서 GPT 모델을 찾을 수 없음

**가능한 이유**:

| 시나리오 | 가능성 | 설명 |
|---------|--------|------|
| **모델명 오류** | 🔴 높음 | 게이트웨이가 `gpt-4-turbo` 대신 다른 이름 기대 |
| **게이트웨이 미지원** | 🟡 중간 | 게이트웨이가 OpenAI 라우팅 미지원 |
| **Provider 라우팅 실패** | 🔴 높음 | 게이트웨이에서 `openai` 프로바이더 인식 불가 |
| **인증 토큰 형식** | 🟡 중간 | 게이트웨이가 다른 토큰 형식 기대 |

---

## 🛠️ 해결 전략 (3가지)

### 전략 1️⃣: 게이트웨이를 통한 통합 접근 (권장)

**아이디어**: 모든 프로바이더 (Qwen, Gemini, GPT)를 LiteLLM 게이트웨이로 라우팅

**장점**:
- ✅ 단일 엔드포인트 사용
- ✅ 프로바이더 추상화
- ✅ 비용 관리 용이
- ✅ 프로바이더 전환 간단

**구현**:
```typescript
// ai-client.ts
if (process.env.AI_GATEWAY_URL) {
  // 모든 요청을 게이트웨이로 라우팅
  const response = await fetch(process.env.AI_GATEWAY_URL + '/v1/chat/completions', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,  // 'gemini-3-flash', 'gpt-4o', 'qwen3-coder-flash' 등
      messages: [...],
    }),
  });
}
```

**테스트**: `--preset provider-comparison`

---

### 전략 2️⃣: 각 프로바이더별 직접 API (백업)

**아이디어**: 각 프로바이더의 공식 API 엔드포인트 사용

**장점**:
- ✅ 완전한 제어
- ✅ 최신 기능 접근 가능
- ✅ 가격 비교 용이

**단점**:
- ❌ 여러 엔드포인트 관리
- ❌ 각 프로바이더별 인증 필요
- ❌ 프로바이더 전환 복잡

**필요한 작업**:
- OpenAI: 유효한 API 키 필요
- Gemini: Google AI Studio 키 변환 필요 가능
- Qwen: DashScope 직접 연결

---

### 전략 3️⃣: 하이브리드 접근

**아이디어**: 게이트웨이 우선, 실패시 직접 API로 폴백

```typescript
if (gatewayUrl) {
  // 게이트웨이 시도
  try {
    return await callGateway(modelName, prompt);
  } catch (e) {
    // 실패시 직접 API로 폴백
    return await callDirectAPI(modelName, prompt);
  }
}
```

---

## 🔐 현재 상황 분석

### 환경 변수 현황

```bash
# ✅ 작동
QWEN_API_KEY=sk-fFKWrjzL-01D2b6_BCbjdg          # 테스트됨: 정상
AI_GATEWAY_URL=https://api.ai.tokamak.network   # 테스트됨: Qwen 정상

# ⚠️ 문제
OPENAI_API_KEY=sk-QcFOZdkZuXacZTSQ0LbZdg        # 401 에러 (무효)

# 🆕 추가
GEMINI_API_KEY=sk-cf_yXDkUQfWKqp2iNG6NIQ       # 미테스트
```

### 게이트웨이의 예상 동작

```
사용자 요청
  ↓
LiteLLM Gateway (https://api.ai.tokamak.network)
  ├─ Qwen 모델 → Qwen DashScope API
  ├─ GPT 모델 → OpenAI API (게이트웨이 내부)
  └─ Gemini 모델 → Google API (게이트웨이 내부)
```

**현재 상황**:
- ✅ Qwen: 게이트웨이 라우팅 정상
- ❓ GPT: 게이트웨이에서 404 (OpenAI 프로바이더 미지원?)
- ❓ Gemini: 미테스트

---

## 🚀 해결책: 통합 벤치마크 전략

### 1단계: 게이트웨이를 통한 통합 테스트

```bash
# Qwen + Gemini + GPT를 모두 게이트웨이로 테스트
npx tsx scripts/benchmark-models.ts --preset provider-comparison
```

**예상 결과**:
- ✅ Qwen: 계속 작동
- ❓ Gemini: Gemini API 키 작동 여부 확인
- ❓ GPT: 404 원인 파악

### 2단계: 실패 원인 규명

```bash
# 디버그: 각 모델별로 API 응답 확인
npx tsx scripts/test-multi-provider.ts
```

**체크 포인트**:
1. 게이트웨이가 모델명 인식하는가?
2. 게이트웨이가 인증 토큰을 받는가?
3. 게이트웨이 내부에서 프로바이더별 라우팅이 정상인가?

### 3단계: 게이트웨이 설정 확인

**확인할 사항**:
1. 게이트웨이가 OpenAI 프로바이더 지원하는가?
2. 게이트웨이 설정에서 OpenAI API 키가 설정되었는가?
3. 모델명 매핑이 올바른가? (e.g., 'openai/gpt-4o' vs 'gpt-4o')

---

## 🔧 임시 해결책 (지금 적용 가능)

### 현재 권장: Qwen + Gemini 테스트

```bash
# 1. Gemini API 테스트 (게이트웨이 통해)
npx tsx scripts/diagnose-api-keys.ts

# 2. Gemini가 작동하면 권장 모델:
# Fast Tier:
#   - qwen3-coder-flash (확정됨, 100% 정확도)
#   - gemini-3-flash (테스트 중)
#
# Best Tier:
#   - qwen3-235b (확정됨, 100% 정확도)
#   - gemini-3-pro (테스트 중)
```

### 향후 : GPT 모델 통합

```bash
# GPT 모델이 작동하면:
npx tsx scripts/benchmark-models.ts --preset standard
```

---

## 📋 체크리스트

### GPT 모델 404 원인 파악

- [ ] 게이트웨이에 OpenAI 프로바이더가 설정되어 있는가?
- [ ] 게이트웨이 내부에 OpenAI API 키가 설정되어 있는가?
- [ ] 모델명이 게이트웨이에서 기대하는 형식인가?
  - 확인: `openai/gpt-4o` vs `gpt-4o` vs `gpt-4o-preview`
- [ ] 게이트웨이가 OpenAI를 지원하는가?
  - 확인: 게이트웨이 문서 또는 제공자에게 문의

### Gemini 모델 테스트

- [ ] Gemini API 키가 유효한가?
  - 테스트: `npx tsx scripts/diagnose-api-keys.ts`
- [ ] 게이트웨이가 Gemini를 지원하는가?
- [ ] 모델명이 올바른가?
  - `gemini-3-flash` vs `gemini-3.0-flash` 등

---

## 💡 권장사항

### 즉시 (지금)

✅ **Qwen 모델 사용**
- 이미 100% 테스트됨
- 모든 프롬프트에서 성공

🔄 **Gemini 테스트**
- 새로 추가된 Gemini API 키로 테스트
- 성공시 대안 제공자로 활용 가능

❌ **GPT 모델 대기**
- 게이트웨이에서 404 에러 (원인 불명)
- 게이트웨이 설정 확인 필요

### 향후

1. **게이트웨이 관리자에게 문의**
   - "gpt-4o, gpt-4o-mini 모델을 지원하나요?"
   - "어떤 모델명 형식을 기대하나요?"
   - "라우팅 설정이 올바른가요?"

2. **GPT 직접 API 사용 고려**
   - 유효한 OpenAI API 키 취득
   - 게이트웨이 대신 직접 연결

3. **모든 프로바이더 통합**
   - Qwen (현재 100% 작동)
   - Gemini (테스트 중)
   - GPT (원인 파악 후)

---

## 📚 참고 문서

- **현재 벤치마크 결과**: `BENCHMARK_FINAL_REPORT.md`
- **인증 진단**: `docs/guides/AUTHENTICATION_DIAGNOSTIC.md`
- **모델 설정**: `scripts/benchmark/models-config.ts`

---

## 🎯 다음 단계

```bash
# 1️⃣ Gemini 테스트
npx tsx scripts/benchmark-models.ts --preset quick

# 2️⃣ 결과 분석
cat benchmark-results/2026-02-13*.md | grep -A 20 "Gemini"

# 3️⃣ 게이트웨이 설정 확인
# → 게이트웨이 관리자에게 OpenAI 라우팅 상태 문의
```

---

**마지막 수정**: 2026-02-13 05:20 UTC
**상태**: 🔄 진행 중 (Gemini 테스트, GPT 원인 규명)
