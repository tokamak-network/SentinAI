# SentinAI Model Benchmark Guide

## Supported Models and Pricing

The SentinAI benchmark supports models from four AI providers.

### 1. Qwen (Alibaba) 🟢 **Recommended**

**setting:**
- Environment variables: `QWEN_API_KEY`, `QWEN_BASE_URL` (optional), `QWEN_MODEL` (optional)
- Default endpoint: `https://dashscope.aliyuncs.com/compatible-mode`
- Compatibility: OpenAI `/v1/chat/completions` compatible

**model:**

| Tier | Model name | input price | output price | response speed | Features |
|------|--------|---------|---------|---------|------|
| **fast** | `qwen-turbo-latest` | $0.50/M | $0.50/M | ⚡⚡⚡ Fast | Lightweight, low cost |
| **best** | `qwen-max-latest` | $2.00/M | $2.00/M | ⚡⚡ Average | High quality, medium cost |

**Example of environment variables:**
```bash
QWEN_API_KEY=your-qwen-api-key-here
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode
QWEN_MODEL=qwen-turbo-latest # Optional: Override the default model
```

**merit:**
✅ Cheapest
✅ Fast response
✅ OpenAI compatible API
✅ Excellent Korean language processing

---

### 2. Anthropic (Claude) 🔵 **High Quality**

**setting:**
- Environment variable: `ANTHROPIC_API_KEY`
- Endpoint: `https://api.anthropic.com`

**model:**

| Tier | Model name | input price | output price | response speed | Features |
|------|--------|---------|---------|---------|------|
| **fast** | `claude-haiku-4-5-20251001` | $0.80/M | $0.15/M | ⚡⚡⚡ Fast | Simple task |
| **best** | `claude-sonnet-4-5-20250929` | $3.00/M | $15.00/M | ⚡⚡ Average | Complex Analysis |

**Example of environment variables:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**merit:**
✅ Excellent accuracy
✅ Stable API
✅ Excellent Korean language processing
✅ Long context support

**disadvantage:**
❌ Medium to high price
❌ Haiku can only do simple tasks

---

### 3. OpenAI (GPT) 🟡 **⚠️ Model name needs to be confirmed**

**setting:**
- Environment variables: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional), `OPENAI_MODEL` (optional)
- Endpoint: `https://api.openai.com` or compatible proxy
- Override: `OPENAI_MODEL_FAST`, `OPENAI_MODEL_BEST`

**model:**

| Tier | Set model name | input price | output price | response speed | ⚠️ Caution |
|------|--------|---------|---------|---------|--------|
| **fast** | `gpt-4.1-mini` | $0.15/M | $0.60/M | ⚡⚡⚡ | **Confirmation required** |
| **best** | `gpt-4.1` | $30.00/M | $60.00/M | ⚡ Slow | **Confirmation required** |

**Actual OpenAI model name** (2026-02):
- `gpt-4-turbo` ← recommended
- `gpt-4o` ← Latest
- `gpt-3.5-turbo` ← Low-cost alternative
- `o1` ← Inference text

**Example of environment variables:**
```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com # or proxy URL
OPENAI_MODEL=gpt-4-turbo # Default for all tiers
OPENAI_MODEL_FAST=gpt-3.5-turbo # fast tier override
OPENAI_MODEL_BEST=gpt-4o # best tier override
```

**merit:**
✅ Highest accuracy (gpt-4 series)
✅ Enterprise-grade support

**disadvantage:**
❌ Most expensive
❌ Slow response

---

### 4. Gemini (Google) 🟣

**setting:**
- Environment variable: `GEMINI_API_KEY`
- Endpoint: `https://generativelanguage.googleapis.com`

**model:**

| Tier | Model name | input price | output price | response speed | Features |
|------|--------|---------|---------|---------|------|
| **fast** | `gemini-2.5-flash-lite` | $0.075/M | $0.30/M | ⚡⚡⚡ Fast | Lightweight |
| **best** | `gemini-2.5-pro` | $1.50/M | $6.00/M | ⚡⚡ Average | Advanced Analytics |

**Example of environment variables:**
```bash
GEMINI_API_KEY=AIzaSy...
```

**merit:**
✅ Good value for money
✅ Fast response
✅ Multimodal support

**disadvantage:**
❌ Intermediate Korean language processing

---

## How to run the benchmark

### Default execution

```bash
# Test all configured providers (repeat 3 times)
npm run benchmark

# Test only Qwen (repeat once, quick test)
npm run benchmark -- --providers qwen --iterations 1

# Claude + OpenAI comparison (repeated 2 times)
npm run benchmark -- --providers anthropic,openai --iterations 2
```

### Interpretation of results

Files generated:
- **CSV**: `benchmark-results/YYYY-MM-DDTHH-MM-SS.csv`
- Raw data (response time, tokens, cost, accuracy, error)
- **Markdown**: `benchmark-results/YYYY-MM-DDTHH-MM-SS.md`
- Summary report (ranking, analysis, recommendations)

**CSV column:**
```
prompt_id # Tested prompt ID
provider # AI provider (qwen, anthropotic, openai, gemini)
tier # model tier (fast, best)
iteration # iteration number
latency_ms # response time (milliseconds)
tokens_in # Number of input tokens
tokens_out # Number of output tokens
cost_usd # Estimated Cost (USD)
accuracy #accuracy (0 or 1)
error # error message (if any)
```

---

## Prompts tested (5)

| ID | Tier | Description | output format |
|----|------|------|---------|
| `predictive-scaler` | fast | AI time series prediction | JSON |
| `anomaly-analyzer` | fast | Anomaly analysis | JSON |
| `rca-engine` | best | Root Cause Analysis | JSON |
| `daily-report` | best | Daily operation report | Markdown (Korean) |
| `nlops-responder` | fast | Generate natural language responses | Text |

---

## Cost Estimation

**Estimated cost per prompt (one repetition):**

| Provider | Tier | Estimated Cost | By price |
|----------|------|---------|---------|
| **Qwen** | fast | $0.0002-0.0005 | Extremely low price |
| **Qwen** | best | $0.0008-0.0015 | low price |
| **Claude** | fast | $0.0001-0.0002 | low price |
| **Claude** | best | $0.0050-0.0100 | mid price |
| **GPT** | fast | $0.0001-0.0003 | low price |
| **GPT** | best | $0.1000-0.2000 | Expensive ⚠️ |
| **Gemini** | fast | $0.0001-0.0002 | Extremely low price |
| **Gemini** | best | $0.0005-0.0010 | low price |

**Total benchmark cost (5 prompts × 1 iteration):**
- Qwen only: ~$0.005
- Claude + Qwen: ~$0.015
- All providers: ~$0.50+

---

## Troubleshooting

### API 404 error

```
Error: OpenAI API error 404: {"detail":"Not Found"}
```

**Cause:** Model name is incorrect
**solve:**
```bash
# Override with the correct model name
export OPENAI_MODEL=gpt-4-turbo
npm run benchmark -- --providers openai --iterations 1
```

### Timeout error

**Cause:** Slow API response (network/load)
**Solution:** Increase timeout and reduce number of iterations
```bash
# Modify timeoutFast/timeoutBest in bunchmark script (default: 30000/60000ms)
```

### Authentication error

```
Error: No AI API key configured
```

**Cause:** Environment variable not set
**solve:**
```bash
# Check .env.local
cat .env.local | grep API_KEY

# or when deploying on EC2
bash scripts/install.sh
```

---

## Performance comparison summary (Reference: tested on 2026-02-13)

### Best value for money 🏆
**Qwen Turbo (fast tier)**
- cost: $0.50/M input, $0.50/M output
- Speed: ⚡⚡⚡ Fast
- Recommendation: Real-time monitoring

### Top quality 🌟
**Claude Sonnet (best tier)**
- cost: $3.00/M input, $15.00/M output
- Speed: ⚡⚡ Average
- Recommended: Complex analysis, RCA

### Balanced choices ⚖️
**Gemini Flash Lite (fast tier)**
- cost: $0.075/M input, $0.30/M output
- Speed: ⚡⚡⚡ Fast
- Recommended: Cost + speed balance

---

## Next steps

1. **Run benchmark**
   ```bash
   npm run benchmark -- --providers qwen --iterations 3
   ```

2. **Result Analysis**
- Check CSV/Markdown in `benchmark-results/` directory

3. **A/B testing**
- Test specific model combinations in production (Phase 2 features)
- Set `AB_TEST_ENABLED=true` in `.env.local`

---

**Document update:** 2026-02-13
**Benchmark version:** 1.0.0
