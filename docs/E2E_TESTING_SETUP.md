# E2E Testing Setup Guide

Complete guide for setting up and running Playwright E2E tests locally and in CI/CD.

## Quick Start

```bash
# 1. Install dependencies (if not already installed)
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Run E2E tests on Chromium only (fastest)
npm run test:e2e:chromium

# 4. View test report
npm run test:e2e:report
```

## Full Setup

### Prerequisites

- **Node.js**: 20+ (check: `node --version`)
- **npm**: 10+ (check: `npm --version`)
- **Git**: configured
- **Disk Space**: 1GB+ (for Playwright browsers)

### Installation Steps

```bash
# 1. Install npm dependencies
npm ci

# 2. Install Playwright browsers (all 3)
npx playwright install chromium firefox webkit

# 3. Verify installation
npx playwright --version
npx playwright test --help
```

## Test Directory Structure

```
tests/e2e/
├── anomaly-detection.spec.ts      # 4 tests: banner, feed, alerts
├── cost-heatmap.spec.ts           # 4 tests: grid, colors, tooltips
├── daily-report.spec.ts           # 5 tests: metrics, consistency
└── helpers/
    └── seed-data.ts               # Helper utilities: seedMetrics, waitForMetricsUpdate
```

## Running Tests

### All Tests (All Browsers)

```bash
npm run test:e2e
```

Expected: 13 tests × 3 browsers = 39 total tests
Time: ~4-5 minutes

### Single Browser

```bash
# Chromium only (recommended for development)
npm run test:e2e:chromium

# Firefox only
npm run test:e2e -- --project=firefox

# WebKit only
npm run test:e2e -- --project=webkit
```

### Single Test File

```bash
npx playwright test tests/e2e/anomaly-detection.spec.ts
```

### Single Test

```bash
npx playwright test tests/e2e/daily-report.spec.ts -t "should have all required"
```

### Interactive Mode (Debugging)

```bash
npm run test:e2e:ui
```

Opens interactive test runner where you can:
- Click to run/pause tests
- Step through actions
- Inspect DOM elements
- View test traces

### Debug Mode

```bash
npm run test:e2e:debug
```

Launches Playwright Inspector with breakpoint support:
- Step through each action
- Evaluate expressions in console
- Inspect page state

### Headed Mode (Visual Testing)

```bash
npm run test:e2e:headed
```

Runs tests with visible browser windows (slower, useful for debugging).

## Test Reports

### View Last Report

```bash
npm run test:e2e:report
```

Opens HTML report with:
- Test timeline
- Pass/fail summary
- Screenshots on failure
- Videos on failure
- Execution traces

### Report Locations

```
playwright-report/        # HTML report (main)
test-results/            # JSON results
  ├── e2e-results.json   # Machine-readable results
  └── <test-name>/       # Per-test artifacts
      ├── test-failed-1.png
      ├── video.webm
      └── trace.zip
```

## Environment Variables

### Required for Tests

```bash
# Development (local .env.local)
L2_RPC_URL=http://localhost:8545
ANTHROPIC_API_KEY=sk-ant-...

# Optional (one of):
OPENAI_API_KEY=sk-...          # OpenAI alternative
GEMINI_API_KEY=AIza...         # Google Gemini alternative

# Testing options
SCALING_SIMULATION_MODE=true   # Avoid real K8s changes (default: true)
```

### CI/CD (.github/workflows/e2e.yml)

Set as GitHub Secrets → Actions:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | Your API key |
| `L2_RPC_URL` | L2 RPC endpoint |
| `OPENAI_API_KEY` | (optional) OpenAI key |
| `GEMINI_API_KEY` | (optional) Gemini key |

Workflow automatically sets:
- `SCALING_SIMULATION_MODE=true`
- `CI=true`

## Configuration

### playwright.config.ts

Key settings:

```typescript
{
  testDir: './tests/e2e',
  timeout: 60000,              // 60s per test
  workers: 2,                  // Parallel workers
  retries: process.env.CI ? 2 : 0,

  use: {
    baseURL: 'http://localhost:3002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3002',
    timeout: 180000,            // 3 min startup
  },
}
```

To customize:
1. Edit `playwright.config.ts`
2. Run tests again
3. Check test-results/ for artifacts

## Troubleshooting

### Problem: "Browser installation failed"

```bash
# Solution: Reinstall browsers with deps
npx playwright install --with-deps
```

### Problem: "Port 3002 already in use"

```bash
# Solution 1: Kill existing process
lsof -ti :3002 | xargs kill -9

# Solution 2: Use different port
PORT=3003 npm run dev
npx playwright test --config playwright.config.ts
```

### Problem: "Element not found [data-testid=...]"

**Cause**: Page didn't load or test IDs missing

**Solution**:
1. Check page loads: `await page.goto('/')`
2. Increase wait timeout: `{ timeout: 90000 }`
3. Verify Test ID exists in `src/app/page.tsx`

### Problem: "Timeout waiting for metrics update"

**Cause**: API endpoint slow or not responding

**Solution**:
1. Check dev server: `curl http://localhost:3002/api/metrics`
2. Check API logs: Look for 500/400 errors
3. Increase timeout: `waitForMetricsUpdate(page, 10000)`

### Problem: "Test flaky - passes sometimes"

**Cause**: Race conditions or timing issues

**Solution**:
1. Add explicit waits: `await page.waitForTimeout(500)`
2. Use retry logic: `await expect(elem).toBeVisible({ timeout: 5000 })`
3. Check CI retries: Set `retries: 2` in config

## Performance Tips

### Speed Up Tests

1. **Use Chromium only** during development
   ```bash
   npm run test:e2e:chromium
   ```

2. **Reduce workers** to avoid dev server overload
   ```
   workers: 1  # In playwright.config.ts
   ```

3. **Skip slow assertions**
   ```typescript
   test.skip('very slow test', async () => { ... })
   ```

4. **Cache selectors**
   ```typescript
   const button = page.getByTestId('submit');  // Cache
   await button.click();
   ```

### Reduce Artifact Size

Current artifacts (~20MB total per run):
- `playwright-report/`: HTML + traces
- `test-results/`: JSON + videos + screenshots

To reduce:
1. Set `video: 'on-failure'` (not 'retain-on-failure')
2. Reduce `screenshot: 'only-on-failure'`
3. Archive older runs

## CI/CD Integration

### GitHub Actions Workflow

See `.github/workflows/e2e.yml` for:
- Automatic test triggering
- Multi-browser matrix
- Artifact uploads
- Result publishing

### Manual Trigger

```bash
# Via GitHub CLI
gh workflow run e2e.yml

# Via web: Actions tab → E2E Tests → Run workflow
```

### View Results

- **In PR**: Checks section shows pass/fail
- **In Actions**: Full logs and artifacts
- **In Artifacts**: Download reports

## Common Commands

```bash
# Development
npm run test:e2e:chromium          # Single browser
npm run test:e2e:ui                # Interactive
npm run test:e2e:headed            # Visual
npm run test:e2e:debug             # Debugger

# Full suite
npm run test:e2e                   # All browsers
npm run test:e2e:report            # View last report

# One-off
npx playwright test tests/e2e/daily-report.spec.ts
npx playwright test -t "should have all"

# Cleanup
rm -rf test-results playwright-report
```

## Test Structure

### Example Test

```typescript
import { test, expect } from '@playwright/test';

test('should display metrics', async ({ page }) => {
  // Navigate
  await page.goto('/');

  // Wait for element
  await page.waitForSelector('[data-testid="current-vcpu"]', { timeout: 60000 });

  // Assert
  const metric = page.getByTestId('current-vcpu');
  await expect(metric).toBeVisible();

  // Get text
  const text = await metric.textContent();
  expect(text).toMatch(/\d+/);
});
```

### Best Practices

1. **Always wait for elements**: Use `waitForSelector` before interacting
2. **Use Test IDs**: More reliable than other selectors
3. **Add timeouts**: Prevent hanging on slow environments
4. **Test visibility**: Verify UI actually renders
5. **Check content**: Not just presence, but correctness

## Next Steps

1. ✅ Run local tests: `npm run test:e2e:chromium`
2. ✅ View report: `npm run test:e2e:report`
3. ✅ Push to GitHub: Triggers CI workflow
4. ✅ Review PR checks: See test results
5. ✅ Add more tests: Expand coverage

---

**Last Updated**: 2026-02-10
**Test Count**: 13 tests across 3 browsers
**Estimated Runtime**: 1.1 minutes (chromium)
**Maintenance**: Update as Test IDs change
