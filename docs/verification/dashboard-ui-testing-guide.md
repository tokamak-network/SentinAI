# SentinAI Dashboard UI Testing Guide

We will guide you through how to manually/automatically verify the dashboard UI in your browser.

---

## 1. Prepare the test environment

```bash
# Start the dev server
npm run dev

# Access from browser
open http://localhost:3002
```

---

## 2. Manual testing checklist

### 2.1 Main dashboard

| # | Item | How to check | data-testid |
|---|------|----------|-------------|
| 1 | Show vCPUs | Top left Current vCPU values ​​(1/2/4) | `current-vcpu` |
| 2 | CPU utilization | Gauge or numeric display | `cpu-usage` |
| 3 | block height | L1/L2 block number display | `block-height` |
| 4 | component status | 4 cards including op-geth and op-node | `component-*` |
| 5 | Cost Information | Monthly Cost, Show Savings | `cost-*` |
| 6 | Anomaly detection banner | Yellow/red banner in spike scenario | `anomaly-banner` |
| 7 | Anomaly Detection Feed | List of above events | `anomaly-feed` |

### 2.2 NLOps Chat UI

| # | Item | How to check | data-testid |
|---|------|----------|-------------|
| 1 | toggle button | Bottom right “SentinAI Assistant” button | `chat-toggle` |
| 2 | Open/Close Panel | Toggle panels with a click | `chat-panel`, `chat-close` |
| 3 | welcome message | Welcome text + example button in blank state | `chat-welcome` |
| 4 | Example Button | “Current status”, “Analyze logs”, “Check costs” | `chat-example-*` |
| 5 | Enter message | Enter text + send Enter | `chat-input` |
| 6 | Send button | Inactive on blank input, active on input | `chat-send` |
| 7 | user message | Right blue speech bubble | `chat-msg-user` |
| 8 | Assistant response | Left white speech bubble | `chat-msg-assistant` |
| 9 | loading indicator | 3 dots animation after transfer | `chat-loading` |
| 10 | confirmation bar | Yellow bar when changing scale/settings | `chat-confirmation` |
| 11 | OK/Cancel button | inside confirmation bar | `chat-confirm-btn`, `chat-cancel-btn` |

### 2.3 Testing by NLOps scenario

```
Scenario 1: Status inquiry
1. Open chat → Click on “Current status” example
2. Confirm: Response includes vCPU, CPU%, and component information

Scenario 2: Cost inquiry
1. Enter “Confirm Cost” → Submit
2. Check: Monthly cost, referrals included.

Scenario 3: Scaling (Confirmation Flow)
1. Enter “scale to 2 vCPU”
2. Confirm: Show confirmation bar, disable input
3. Click “Cancel” → confirmation bar disappears, input becomes active
4. Click “Scale to 2 vCPU” again → “Confirm”
5. Confirmation: Scaling complete response

Scenario 4: Change settings
1. “Turn off auto scaling” → Confirmation bar → “Confirm”
2. Confirmation: Setting change response
3. “Turn on automatic scaling” → Confirm → Restore

Scenario 5: Keep the conversation going
1. Sending multiple messages in succession
2. Confirmation: Maintain conversation history, scroll automatically
```

---

## 3. API Integration Testing (Vitest)

Verify NLOps core logic without a browser. **No additional dependencies required.**

```bash
# Run only NLOps tests
npx vitest run src/lib/__tests__/nlops-engine.test.ts

# full test
npm run test:run
```

### Test coverage (31)

| Category | number of tests | Content |
|---------|----------|------|
| `classifyIntent` | 10 | 7 intent classification, validation, AI failure fallback, JSON parsing |
| `executeAction` | 12 | 5 types of queries, analysis, explanation, RCA, confirmation flow, error handling |
| `nlops-responder` | 9 | Static response, fallback, follow-up recommendation |

---

## 4. curl-based API testing

It's ready to use when the dev server is running.

```bash
BASE=http://localhost:3002

# Check status
curl -s $BASE/api/nlops | jq

# Status query
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Tell me the current status"}' | jq '{intent, executed}'

# Cost inquiry
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Check cost"}' | jq '{intent, executed}'

# Abnormal status
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Show me the status of an error"}' | jq '{intent, executed}'

# Log analysis
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Please analyze the log"}' | jq '{intent, executed}'

# Scaling (request confirmation)
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Please scale to 2 vCPU"}' | jq '{intent, executed, needsConfirmation}'

# Scaling (run confirmation)
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Scale to 2 vCPU", "confirmAction": true}' | jq '{intent, executed}'

# RCA
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Analyze the root cause"}' | jq '{intent, executed}'

# explanation
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "What is a CPU?"}' | jq '{intent, executed}'

# Unknown
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Unknown command"}' | jq '{intent, executed}'

# Error case (400)
curl -s -X POST $BASE/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": ""}' | jq
```

---

## 5. Anomaly detection scenario test (Seed API)

```bash
# spike data injection → check anomaly detection banner
curl -X POST $BASE/api/metrics/seed?scenario=spike

# Check in browser:
# - display anomaly-banner
# - list of events in anomaly-feed

# restore normal
curl -X POST $BASE/api/metrics/seed?scenario=stable
```

---

## 6. When you need browser automation

If you need browser-level automated testing in the future, consider the following options:

### 6.1 Vitest Browser Mode (Recommended)

The most lightweight way to add browser mode to your existing Vitest setup.

```bash
npm install -D @vitest/browser playwright  # ~300MB (Chromium 1개)
```

```ts
// Add browser project to vitest.config.ts
export default defineConfig({
  test: {
// Maintain existing node tests
    include: ['src/**/*.test.ts'],
  },
// Browser testing can be separated into a separate workspace
});
```

Pros: Vitest integration, reuse of existing settings, minimal dependencies

### 6.2 Playwright (previously used)

This is when you need a full-stack E2E framework.

```bash
npm install -D @playwright/test # + browser ~1GB
npx playwright install chromium
```

Pros: 3 browsers, powerful debugging, trace/video capture

### 6.3 Cypress

This is the preferred alternative for front-end teams.

```bash
npm install -D cypress  # ~500MB
```

Advantages: Real-time reload, intuitive UI, Time Travel debugging

---

## 7. Full list of data-testid

The test ID currently set in the dashboard.

### Main dashboard

| testid | location |
|--------|------|
| `current-vcpu` | Show vCPUs |
| `cpu-usage` | CPU utilization |
| `block-height` | block height |
| `anomaly-banner` | Anomaly detection banner |
| `anomaly-banner-title` | Banner Title |
| `anomaly-feed` | More Event Feeds |

### NLOps Chat

| testid | location |
|--------|------|
| `chat-toggle` | Open chat button |
| `chat-panel` | Chat Panel All |
| `chat-close` | Close button |
| `chat-welcome` | Welcome message area |
| `chat-messages` | message list container |
| `chat-example-{text}` | Example buttons (current status, analyze log, check cost) |
| `chat-msg-user` | user message |
| `chat-msg-assistant` | Assistant Messages |
| `chat-loading` | loading indicator |
| `chat-confirmation` | confirmation bar |
| `chat-confirmation-msg` | Confirmation message text |
| `chat-confirm-btn` | OK button |
| `chat-cancel-btn` | Cancel button |
| `chat-input` | Message input field |
| `chat-send` | Send button |
