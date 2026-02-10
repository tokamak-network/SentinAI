# CI/CD Integration Guide for E2E Tests

This document describes the GitHub Actions CI/CD pipeline for running Playwright E2E tests.

## Overview

The E2E test pipeline runs automated tests on:
- **Browsers**: Chromium, Firefox, WebKit (in parallel)
- **Triggers**: Push to `main` branch, Pull requests
- **Timeout**: 30 minutes per browser
- **Artifacts**: Test results, Playwright reports, screenshots, videos

## GitHub Actions Workflow

**Location**: `.github/workflows/e2e.yml`

### Workflow Steps

1. **Checkout Code** - Clone repository
2. **Setup Node.js** - Install Node 20 with npm caching
3. **Install Dependencies** - Run `npm ci`
4. **Install Playwright** - Download browser binaries for specific browser
5. **Run E2E Tests** - Execute `npm run test:e2e -- --project=<browser>`
6. **Upload Playwright Report** - Store HTML test report
7. **Upload Test Results** - Store JSON results for CI integration
8. **Publish Test Results** - Display results in GitHub PR checks

### Environment Variables

Required secrets must be configured in GitHub repository settings:

| Variable | Source | Required | Default |
|----------|--------|----------|---------|
| `ANTHROPIC_API_KEY` | Repository Secrets | ✅ | — |
| `OPENAI_API_KEY` | Repository Secrets | ❌ | — |
| `GEMINI_API_KEY` | Repository Secrets | ❌ | — |
| `L2_RPC_URL` | Repository Secrets | ❌ | http://localhost:8545 |

Workflow will automatically set:
- `SCALING_SIMULATION_MODE=true` (avoid real K8s changes)
- `CI=true` (Playwright retry settings)

## Local Testing

Before pushing to GitHub, test locally:

```bash
# Run tests on chromium only (fastest)
npm run test:e2e:chromium

# Run tests on all browsers
npm run test:e2e

# Interactive debugging UI
npm run test:e2e:ui

# View last test report
npm run test:e2e:report
```

## GitHub Repository Configuration

### Step 1: Add Secrets

In GitHub repository → Settings → Secrets and variables → Actions:

```bash
# Example: Adding ANTHROPIC_API_KEY
Name: ANTHROPIC_API_KEY
Secret: sk-ant-...

# Example: Adding L2_RPC_URL
Name: L2_RPC_URL
Secret: https://mainnet.optimism.io (or your L2 RPC endpoint)
```

### Step 2: Verify Workflow

- Workflow file: `.github/workflows/e2e.yml`
- Trigger: Automatic on push/PR to main
- Status: Check PR checks or Actions tab

### Step 3: Review Test Results

In GitHub PR:
- **Checks** tab shows pass/fail summary
- **Artifacts** section has full Playwright reports
- **Details** link shows HTML report with traces

## Troubleshooting

### Tests fail with "Element not found"

**Cause**: Page load timeout or missing Test IDs

**Solution**:
1. Check page renders: `await page.goto('/')`
2. Wait for Test ID: `await page.waitForSelector('[data-testid="..."]', { timeout: 60000 })`
3. Verify Test ID exists in `src/app/page.tsx`

### Tests timeout on CI

**Cause**: Limited CI runner resources or slow network

**Solution**:
1. Reduce parallelism in `playwright.config.ts`: `workers: 1`
2. Increase timeout: `timeout: 90000` (ms)
3. Check artifact uploads don't exceed limits

### AI API errors (400/401)

**Cause**: Invalid API key or unauthorized access

**Solution**:
1. Verify secrets are set in GitHub repository
2. Test locally with same API key
3. Check API key has required permissions

### Playwright browser installation fails

**Cause**: Network or system dependency issues

**Solution**:
1. Cache npm packages: Already configured with `node-setup-node@v4`
2. Install system deps: Playwright installs with `--with-deps`
3. Check Ubuntu runner resources

## Performance Optimization

### Current Settings

| Setting | Value | Impact |
|---------|-------|--------|
| Workers | 1 (CI) | Sequential test execution |
| Timeout | 60s | Allows slow page loads |
| Retries | 2 (CI) | Handles flaky tests |
| Browser | 3 (parallel) | Full coverage |

### Optimization Tips

1. **Reduce browsers** to 1 (Chromium) for quick feedback
2. **Increase workers** to 2-4 for faster full runs
3. **Skip non-critical** tests with `.skip` during development
4. **Cache results** - Playwright already caches page traces

## Integration with PR Workflow

### Example PR Check Output

```
✅ E2E Test Results (chromium): 13 passed
✅ E2E Test Results (firefox): 13 passed
✅ E2E Test Results (webkit): 13 passed

Artifacts:
- playwright-report-chromium.zip (5MB)
- playwright-report-firefox.zip (5MB)
- playwright-report-webkit.zip (5MB)
- test-results-chromium.zip (1MB)
- test-results-firefox.zip (1MB)
- test-results-webkit.zip (1MB)
```

## Manual Workflow Triggers

To manually trigger the workflow:

```bash
# Via GitHub CLI
gh workflow run e2e.yml

# Via GitHub web interface
1. Go to Actions tab
2. Select "E2E Tests" workflow
3. Click "Run workflow"
4. Choose branch and commit
```

## Next Steps

1. Add secrets to GitHub repository
2. Push to `main` or create PR to trigger workflow
3. Monitor Actions tab for test results
4. Review artifacts in PR checks section

---

**Generated**: 2026-02-10
**Workflow File**: `.github/workflows/e2e.yml`
**Test Count**: 13 (chromium/firefox/webkit = 39 total)
**Estimated Runtime**: 1.5 minutes per browser (~4.5 minutes total)
