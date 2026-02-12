# LLM Stress Test Framework - Environment Variables Guide

**Purpose**: Configure API server endpoints, timeouts, and test behavior for the LLM stress testing framework.

**Location**: `.env.local`

**Quick Reference**: All variables are **optional** (defaults provided)

---

## 🔑 Required: API Keys (Choose at least ONE)

These must be set before running tests. The framework will use the first available provider in priority order.

```bash
# Option 1: Qwen (Alibaba DashScope, OpenAI-compatible)
QWEN_API_KEY=your-qwen-api-key-here

# Option 2: Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Option 3: OpenAI (GPT)
OPENAI_API_KEY=sk-...

# Option 4: Google Gemini
GEMINI_API_KEY=AIza...
```

**Priority Order** (if multiple keys set):
1. Qwen (fastest, cheapest)
2. Anthropic (best reasoning)
3. OpenAI (reliable, expensive)
4. Gemini (ultra-fast)

---

## 🌐 Optional: Custom API Server Endpoints

Override default API endpoints for testing against custom servers, proxies, or local instances.

### Per-Provider Custom Endpoints

```bash
# Use custom Qwen API endpoint (default: https://dashscope.aliyuncs.com/compatible-mode)
LLM_TEST_QWEN_URL=https://dashscope.aliyuncs.com/compatible-mode

# Use custom Anthropic endpoint (default: https://api.anthropic.com)
LLM_TEST_ANTHROPIC_URL=https://api.anthropic.com

# Use custom OpenAI endpoint (default: https://api.openai.com)
LLM_TEST_OPENAI_URL=https://api.openai.com

# Use custom Gemini endpoint (default: https://generativelanguage.googleapis.com)
LLM_TEST_GEMINI_URL=https://generativelanguage.googleapis.com
```

### Global Proxy Configuration

Route all requests through a LiteLLM Gateway or custom proxy:

```bash
# Enable proxy for all requests
LLM_TEST_PROXY_ENABLED=true

# Proxy server URL (e.g., LiteLLM Gateway on localhost:4000)
LLM_TEST_PROXY_URL=http://localhost:4000
```

**Example**: Using LiteLLM Gateway locally
```bash
# Start LiteLLM Gateway in another terminal
litellm --model openai/gpt-4 --local --port 4000

# Configure test to use gateway
export LLM_TEST_PROXY_URL=http://localhost:4000
export LLM_TEST_PROXY_ENABLED=true
```

---

## ⏱️ Optional: Timeout Configuration

Control how long the framework waits for API responses before timeout.

### Default Values
- **Fast-tier**: 30 seconds (30000 ms)
- **Best-tier**: 60 seconds (60000 ms)

### Custom Timeouts

```bash
# Fast-tier timeout (intent classification, log analysis) - in milliseconds
LLM_TEST_TIMEOUT_FAST=30000

# Best-tier timeout (RCA, cost optimization) - in milliseconds
LLM_TEST_TIMEOUT_BEST=60000

# Example: Stricter timeouts
export LLM_TEST_TIMEOUT_FAST=15000   # 15 seconds for fast tier
export LLM_TEST_TIMEOUT_BEST=45000   # 45 seconds for best tier

# Example: Generous timeouts (poor network)
export LLM_TEST_TIMEOUT_FAST=60000   # 60 seconds
export LLM_TEST_TIMEOUT_BEST=120000  # 120 seconds
```

---

## 📊 Optional: Test Execution Configuration

Control which providers to test and where to save results.

### Select Providers to Test

```bash
# Test all 4 providers (default)
LLM_TEST_PROVIDERS=qwen,anthropic,openai,gemini

# Test specific providers only
export LLM_TEST_PROVIDERS=anthropic,openai

# Test single provider
export LLM_TEST_PROVIDERS=qwen
```

### Output Directory

```bash
# Default: src/lib/__tests__/llm-stress-test/output
LLM_TEST_OUTPUT_DIR=src/lib/__tests__/llm-stress-test/output

# Custom output directory
export LLM_TEST_OUTPUT_DIR=./test-results
export LLM_TEST_OUTPUT_DIR=/tmp/llm-tests
```

### Parallelism Configuration

```bash
# Default: 5 concurrent requests for mixed workload
LLM_TEST_PARALLELISM_DEFAULT=5

# Custom parallelism
export LLM_TEST_PARALLELISM_DEFAULT=10
```

---

## 📋 Environment Variable Reference Table

| Variable | Type | Default | Description | Example |
|----------|------|---------|-------------|---------|
| `LLM_TEST_QWEN_URL` | URL | DashScope | Custom Qwen API endpoint | `https://custom.api.com/qwen` |
| `LLM_TEST_ANTHROPIC_URL` | URL | api.anthropic.com | Custom Anthropic API endpoint | `https://custom.api.com/anthropic` |
| `LLM_TEST_OPENAI_URL` | URL | api.openai.com | Custom OpenAI API endpoint | `https://custom.api.com/openai` |
| `LLM_TEST_GEMINI_URL` | URL | generativelanguage.googleapis.com | Custom Gemini API endpoint | `https://custom.api.com/gemini` |
| `LLM_TEST_PROXY_URL` | URL | — | LiteLLM Gateway or proxy | `http://localhost:4000` |
| `LLM_TEST_PROXY_ENABLED` | Boolean | false | Route all through proxy | `true` |
| `LLM_TEST_PROVIDERS` | List | all | Providers to test | `qwen,anthropic` |
| `LLM_TEST_TIMEOUT_FAST` | ms | 30000 | Fast-tier timeout | `15000` |
| `LLM_TEST_TIMEOUT_BEST` | ms | 60000 | Best-tier timeout | `45000` |
| `LLM_TEST_OUTPUT_DIR` | Path | `src/lib/__tests__/llm-stress-test/output` | Result directory | `./my-results` |
| `LLM_TEST_PARALLELISM_DEFAULT` | Number | 5 | Concurrent requests | `10` |

---

## 🚀 Common Scenarios

### Scenario 1: Quick Test with Single Provider

Test only Anthropic Claude (fastest to set up):

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export LLM_TEST_PROVIDERS=anthropic
export LLM_TEST_TIMEOUT_FAST=20000
export LLM_TEST_TIMEOUT_BEST=40000

npx tsx src/lib/__tests__/llm-stress-test/index.ts
```

### Scenario 2: Compare All Providers

Test all providers in parallel for cost/performance comparison:

```bash
export QWEN_API_KEY=your-key
export ANTHROPIC_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx
export GEMINI_API_KEY=AIza-xxx

# Default: tests all 4 providers
npx tsx src/lib/__tests__/llm-stress-test/index.ts
```

### Scenario 3: Custom API Server (Self-Hosted)

Test against local or custom API endpoints:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export LLM_TEST_ANTHROPIC_URL=https://internal-api.company.com/anthropic
export LLM_TEST_TIMEOUT_FAST=60000
export LLM_TEST_TIMEOUT_BEST=120000

npx tsx src/lib/__tests__/llm-stress-test/index.ts
```

### Scenario 4: LiteLLM Gateway Proxy

Route all requests through LiteLLM Gateway:

```bash
# Terminal 1: Start LiteLLM Gateway
litellm --model openai/gpt-4 --local --port 4000

# Terminal 2: Run tests
export OPENAI_API_KEY=sk-xxx
export LLM_TEST_PROXY_URL=http://localhost:4000
export LLM_TEST_PROXY_ENABLED=true

npx tsx src/lib/__tests__/llm-stress-test/index.ts
```

### Scenario 5: Strict Timeouts (Poor Network)

If API responses are slow:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export LLM_TEST_TIMEOUT_FAST=45000    # 45 seconds instead of 30
export LLM_TEST_TIMEOUT_BEST=120000   # 120 seconds instead of 60
export LLM_TEST_OUTPUT_DIR=./results-slow-network

npx tsx src/lib/__tests__/llm-stress-test/index.ts
```

---

## 🔍 Verification

### Check Configuration Loading

View actual configuration by examining framework output:

```bash
# Run framework - first lines show loaded configuration
npx tsx src/lib/__tests__/llm-stress-test/index.ts

# Look for output like:
# ✅ Initialized 8 clients
#    Providers: qwen, anthropic, openai, gemini
#    Tiers: fast, best
#    Output directory: src/lib/__tests__/llm-stress-test/output
```

### Test Timeout Behavior

Create a test that intentionally times out:

```bash
# Very short timeout to test timeout handling
export LLM_TEST_TIMEOUT_FAST=100        # Only 100ms
export LLM_TEST_PROVIDERS=anthropic

npx tsx src/lib/__tests__/llm-stress-test/index.ts

# Should show timeout errors in results JSON
cat src/lib/__tests__/llm-stress-test/output/results-*.json | grep error
```

---

## 📚 Integration with ai-client.ts

The LLM test framework reuses `ai-client.ts` configuration. Priority order for provider selection:

1. **ai-client.ts detectProvider()** (existing behavior)
   - QWEN_API_KEY → Qwen
   - ANTHROPIC_API_KEY → Anthropic
   - OPENAI_API_KEY → OpenAI
   - GEMINI_API_KEY → Gemini

2. **LLM_TEST_* overrides** (new)
   - Custom endpoint URLs
   - Custom timeouts
   - Proxy configuration

### Existing ai-client.ts Variables (for reference)

These work alongside LLM_TEST_* variables:

```bash
# Custom Qwen endpoint (alternative to LLM_TEST_QWEN_URL)
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode

# Custom Qwen model
QWEN_MODEL=qwen-turbo-latest

# Custom OpenAI endpoint (alternative to LLM_TEST_OPENAI_URL)
OPENAI_BASE_URL=http://localhost:4000
OPENAI_MODEL=qwen/qwen-turbo-latest
OPENAI_MODEL_FAST=qwen3-coder-flash
OPENAI_MODEL_BEST=qwen3-235b

# Global Gateway (overrides all providers)
AI_GATEWAY_URL=https://api.ai.tokamak.network
```

---

## ❓ Troubleshooting

### Issue: "No AI API key configured"

**Cause**: None of the API key environment variables are set.

**Solution**: Set at least one:
```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
```

### Issue: Timeout errors in results

**Cause**: API is slow or network is congested.

**Solution**: Increase timeouts:
```bash
export LLM_TEST_TIMEOUT_FAST=60000
export LLM_TEST_TIMEOUT_BEST=120000
```

### Issue: "Cannot connect to proxy"

**Cause**: Proxy URL is wrong or proxy is not running.

**Solution**:
1. Check proxy is running: `curl http://localhost:4000`
2. Disable proxy and use direct API:
```bash
export LLM_TEST_PROXY_ENABLED=false
```

### Issue: Connection refused at custom endpoint

**Cause**: Custom endpoint URL is unreachable.

**Solution**: Test endpoint manually:
```bash
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  https://custom.api.com/anthropic/v1/messages
```

---

## 📖 Related Documentation

- **Main Framework Doc**: `docs/todo/llm-stress-test-implementation.md`
- **AI Client Config**: `.env.local.sample` (AI Provider section)
- **Test Scenarios**: `src/lib/__tests__/llm-stress-test/scenarios/`
- **Quick Start**: README.md → LLM Stress Testing section

---

**Last Updated**: 2026-02-12
**Framework Version**: 1.0 (Ready for Production Testing)
