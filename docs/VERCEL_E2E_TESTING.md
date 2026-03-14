# Vercel Deployment E2E Testing Guide

Testing the admin dashboard on a deployed Vercel instance.

## Quick Start

### 1. Deploy to Vercel

```bash
# Push to GitHub (if using GitHub integration)
git push origin feature/dashboard-admin

# Or deploy directly via Vercel CLI
npm i -g vercel
vercel --prod

# Vercel URL will be shown: https://sentinai-dashboard.vercel.app
```

### 2. Run Tests Against Vercel

```bash
# Using your Vercel deployment URL
VERCEL_URL=https://sentinai-dashboard.vercel.app \
  npx playwright test --config=playwright.vercel.config.ts

# Or with local dev server
npx playwright test e2e/admin-dashboard.spec.ts
```

### 3. View Results

```bash
# Open HTML report
npx playwright show-report playwright-report-vercel
```

---

## Detailed Guide

### Environment Variables

Before running tests, set these environment variables:

```bash
# Required: Vercel deployment URL
export VERCEL_URL=https://your-deployment.vercel.app

# Optional: Test admin key (if different from default)
export NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x742d35Cc6634C0532925a3b844Bc9e7595f42bE3

# Optional: Test session key
export MARKETPLACE_SESSION_KEY=e2e-test-secret-key-for-session-hmac
```

### Test Execution

#### Option 1: Against Vercel Deployment

```bash
# Run all tests on Vercel
VERCEL_URL=https://sentinai-dashboard.vercel.app \
  npx playwright test --config=playwright.vercel.config.ts

# Run specific test file
VERCEL_URL=https://sentinai-dashboard.vercel.app \
  npx playwright test e2e/admin-dashboard.spec.ts \
  --config=playwright.vercel.config.ts

# Run with HTML report
VERCEL_URL=https://sentinai-dashboard.vercel.app \
  npx playwright test --config=playwright.vercel.config.ts \
  --reporter=html
```

#### Option 2: Against Local Dev Server

```bash
# Start dev server in one terminal
npx next dev -p 3002

# Run tests in another terminal
npx playwright test e2e/admin-dashboard.spec.ts

# Or using local config
npx playwright test --config=playwright.config.ts
```

### Configuration Files

**`playwright.config.ts`** - Local development testing
- Starts Next.js dev server automatically
- Uses http://localhost:3002
- Includes webServer configuration

**`playwright.vercel.config.ts`** - Production deployment testing
- Does NOT start a server (tests external URL)
- Requires `VERCEL_URL` environment variable
- Creates separate report directory
- Supports all three browsers (Chromium, Firefox, WebKit)

### Test Reports

#### Local Testing
```bash
npx playwright show-report playwright-report
```

#### Vercel Testing
```bash
npx playwright show-report playwright-report-vercel
```

## CI/CD Integration

### GitHub Actions - Test After Deploy

```yaml
name: E2E Tests on Vercel Deployment

on:
  deployment_status:

jobs:
  test:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - run: npm install

      # Get deployment URL from GitHub
      - name: Get Vercel URL
        id: vercel
        run: |
          echo "url=${{ github.event.deployment_status.environment_url }}" >> $GITHUB_OUTPUT

      # Install Playwright browsers
      - run: npx playwright install --with-deps

      # Run tests against deployed URL
      - name: Run E2E Tests
        run: |
          VERCEL_URL=${{ steps.vercel.outputs.url }} \
            npx playwright test --config=playwright.vercel.config.ts

      # Upload artifacts
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report-vercel
          path: playwright-report-vercel/
          retention-days: 30
```

### Vercel Deployment Hook

Create a deployment hook in Vercel dashboard:

1. Go to Project Settings → Git
2. Create new Deployment Hook
3. Point to your CI/CD service
4. Trigger E2E tests after deployment

Example webhook:
```
https://github.com/your-repo/dispatches
```

## Vercel Environment Setup

### Required Environment Variables (in Vercel)

Add these in Vercel dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x742d35Cc6634C0532925a3b844Bc9e7595f42bE3
MARKETPLACE_SESSION_KEY=your-secure-session-key
NEXT_PUBLIC_SENTINAI_API_KEY=sentinai-api-key
L2_RPC_URL=<your-l2-rpc>
AWS_CLUSTER_NAME=<your-cluster>
```

### Production vs Preview

Tests can target different environments:

```bash
# Production deployment
VERCEL_URL=https://sentinai-dashboard.vercel.app npx playwright test --config=playwright.vercel.config.ts

# Preview deployment (PR)
VERCEL_URL=https://sentinai-dashboard-pr-123.vercel.app npx playwright test --config=playwright.vercel.config.ts
```

## Troubleshooting

### Authentication Fails

**Problem**: Tests redirected to login, session not recognized

**Solutions**:
1. Verify environment variables on Vercel:
   ```bash
   vercel env ls
   ```

2. Check `MARKETPLACE_SESSION_KEY` is set:
   ```bash
   vercel env pull .env.local
   ```

3. Update Vercel env variables:
   ```bash
   vercel env add MARKETPLACE_SESSION_KEY
   ```

### Timeout on Vercel

**Problem**: `Timeout waiting for page to load`

**Solutions**:
1. Increase timeout in `playwright.vercel.config.ts`:
   ```typescript
   timeout: 60000 // 60 seconds
   ```

2. Check Vercel deployment is healthy:
   ```bash
   curl -v https://your-deployment.vercel.app/admin/login
   ```

3. Check network connectivity
4. Verify base URL is correct

### Test Can't Find Elements

**Problem**: `Timeout waiting for element [data-testid="..."]`

**Solutions**:
1. Verify Vercel deployment is running the latest code:
   ```bash
   vercel promote <preview-url>
   ```

2. Check Vercel build logs for errors
3. Verify static assets are deployed:
   ```bash
   curl https://your-deployment.vercel.app/admin
   ```

### CORS Issues

**Problem**: Network requests blocked by CORS

**Solutions**:
1. Check CORS headers in Vercel deployment
2. Verify API endpoints are accessible
3. Check middleware configuration

## Performance Notes

- Vercel deployments have higher latency than localhost
- Tests run slower on first deployment (cold start)
- Use `--workers=1` for serial execution (more stable)
- Increase timeouts: `--timeout=60000`

## Best Practices

### Before Deploying

1. ✅ Run tests locally:
   ```bash
   npx playwright test e2e/admin-dashboard.spec.ts
   ```

2. ✅ Check build output:
   ```bash
   npm run build
   ```

3. ✅ Verify all environment variables are set

### After Deploying

1. ✅ Run tests on Vercel:
   ```bash
   VERCEL_URL=<your-url> npx playwright test --config=playwright.vercel.config.ts
   ```

2. ✅ Review test report
3. ✅ Check for flaky tests (retry 2-3 times)
4. ✅ Archive results for records

### Monitoring

```bash
# Run tests periodically (hourly)
0 * * * * cd /path/to/project && VERCEL_URL=https://your-app.vercel.app npx playwright test --config=playwright.vercel.config.ts

# Set up monitoring dashboard
npx playwright show-report # Review HTML locally
```

## Common Deployment URLs

Replace with your actual Vercel project:

```bash
# Production
VERCEL_URL=https://sentinai-dashboard.vercel.app

# Preview (from branch)
VERCEL_URL=https://sentinai-dashboard-preview.vercel.app

# Staging
VERCEL_URL=https://sentinai-dashboard-staging.vercel.app

# Local (default)
VERCEL_URL=http://localhost:3002
```

## Test Results Example

```
Running tests with Vercel deployment...

Tests run on: https://sentinai-dashboard.vercel.app
Duration: 52.3s
Browsers: Chromium, Firefox, WebKit

✅ 17 tests PASSED
   - 3 Admin dashboard tests
   - 3 Catalog tests
   - 3 Pricing tests
   - 3 Orders tests
   - 2 Analytics tests
   - 3 Authentication tests

Report: playwright-report-vercel/index.html
```

## Support & Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Playwright Guide](https://playwright.dev)
- [Vercel Analytics](https://vercel.com/analytics)
- [Vercel Speed Insights](https://vercel.com/docs/speed-insights)

---

**Key Point**: Use `playwright.vercel.config.ts` for production testing, `playwright.config.ts` for local development.
