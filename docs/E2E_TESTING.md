# E2E Testing Guide - Admin Dashboard

Comprehensive end-to-end testing for marketplace admin dashboard using Playwright.

## Overview

The E2E test suite validates critical user flows in the admin dashboard:

- **Authentication**: SIWE session management and login protection
- **Catalog Management**: Add, edit, delete agents with search
- **Pricing Management**: Update tier prices and reset to defaults
- **Orders Management**: View, search, and paginate orders
- **Analytics**: Revenue metrics, tier distribution, top agents

## Test Structure

```
e2e/
├── fixtures/
│   └── admin-session.ts        # Session token generation for tests
├── pages/
│   ├── AdminDashboard.ts       # Main dashboard navigation
│   ├── CatalogPage.ts          # Agent management
│   ├── PricingPage.ts          # Tier pricing
│   ├── OrdersPage.ts           # Order listing
│   └── AnalyticsPage.ts        # Metrics & analytics
├── admin-dashboard.spec.ts     # Main test suite (17 tests)
├── admin-simple.spec.ts        # Simplified tests
└── smoke.spec.ts              # Smoke test
```

### Page Object Model Pattern

Each page is represented as a class with:
- **Selectors**: Locators for UI elements
- **Actions**: Methods to interact with the page
- **Assertions**: Methods to verify page state

Example:
```typescript
const catalog = new CatalogPage(page);
await catalog.goto();
await catalog.clickAddAgent();
await catalog.fillAgentForm({ name: 'Test Agent', ... });
await catalog.saveAgent();
await catalog.expectAgentVisible('Test Agent');
```

## Running Tests

### Prerequisites

1. **Environment Setup**
   ```bash
   npm install
   export NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x742d35Cc6634C0532925a3b844Bc9e7595f42bE3
   export MARKETPLACE_SESSION_KEY=e2e-test-secret-key-for-session-hmac
   ```

2. **Start Development Server** (optional - Playwright can auto-start)
   ```bash
   npm run dev
   # or
   npx next dev -p 3002
   ```

### Run All Tests

```bash
# Basic run
npx playwright test

# With HTML report
npx playwright test --reporter=html
npx playwright show-report

# Watch mode
npx playwright test --watch

# Debug mode (inspect each step)
npx playwright test --debug

# Specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Run Specific Test Suite

```bash
# Admin dashboard tests
npx playwright test e2e/admin-dashboard.spec.ts

# Simplified tests
npx playwright test e2e/admin-simple.spec.ts

# Smoke test
npx playwright test e2e/smoke.spec.ts
```

### Run Specific Test

```bash
# Single test by name
npx playwright test -g "User can access admin dashboard"

# Test with grep pattern
npx playwright test -g "Catalog"
```

### Test Options

```bash
# Run with specific number of workers (serial)
npx playwright test --workers=1

# Disable headless mode (see browser)
npx playwright test --headed

# Retries on failure
npx playwright test --retries=3

# Timeout per test (ms)
npx playwright test --timeout=30000
```

## Test Cases (17 total)

| # | Test | Module | Purpose |
|---|------|--------|---------|
| 1 | Dashboard landing | Dashboard | Navigation to admin home |
| 2 | Navigate to catalog | Dashboard | Card click navigation |
| 3 | View agents | Catalog | Load and display agent list |
| 4 | Search agents | Catalog | Filter agents by name |
| 5 | Navigate to pricing | Dashboard | Card click navigation |
| 6 | View pricing | Pricing | Display tier prices |
| 7 | Update pricing | Pricing | Edit and save prices |
| 8 | Reset pricing | Pricing | Restore default prices |
| 9 | Navigate to orders | Dashboard | Card click navigation |
| 10 | View orders | Orders | Display order table |
| 11 | Pagination | Orders | Change items per page |
| 12 | Search orders | Orders | Filter orders by query |
| 13 | Navigate to analytics | Dashboard | Card click navigation |
| 14 | View analytics | Analytics | Display metrics and charts |
| 15 | Full navigation | Dashboard | Navigate all sections |
| 16 | Unauthenticated redirect | Auth | Session validation |
| 17 | Logout flow | Auth | Clear session and redirect |

## Authentication in Tests

### How It Works

Tests use HMAC-based session tokens instead of MetaMask:

1. **Token Generation**: `generateTestSessionToken()`
   - Creates valid admin session token
   - Format: `admin_{address}_{issuedAt}_{expiresAt}_{hmac}`
   - Uses MARKETPLACE_SESSION_KEY for HMAC

2. **Cookie Injection**: `setAdminSessionCookie()`
   - Adds session cookie to browser context
   - No MetaMask popup required
   - Valid for 8 hours

3. **Protected Routes**: Middleware validates session
   - `/admin` routes require valid cookie
   - Invalid/missing tokens redirect to login
   - Logout clears cookie

Example:
```typescript
// Setup authenticated session
await setAdminSessionCookie(page);

// Navigate to protected page
await page.goto('/admin/catalog');

// Page loads without login prompt
```

## Debugging Failed Tests

### View Traces

```bash
# Run test with trace enabled
npx playwright test e2e/admin-dashboard.spec.ts --trace=on

# View trace file
npx playwright show-trace ./test-results/trace.zip
```

### Inspect Elements

```bash
# Debug mode - inspect DOM at each step
npx playwright test --debug

# Take screenshots on failure
npx playwright test --screenshot=only-on-failure
```

### Log Network Activity

```bash
# Enable network logging
npx playwright test --reporter=list

# Check request/response in trace
npx playwright show-trace ./test-results/trace.zip
```

### Test Output

```bash
# Verbose output
npx playwright test --reporter=verbose

# JSON output
npx playwright test --reporter=json > results.json

# HTML with timeline
npx playwright test --reporter=html
```

## CI/CD Integration

### GitHub Actions

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - run: npm install
      - run: npm run build

      - run: npx playwright install --with-deps
      - run: npx playwright test

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Troubleshooting

### Tests Not Running

**Problem**: `PASS (0) FAIL (0)` - No tests detected

**Solutions**:
1. Check `playwright.config.ts` exists
2. Verify `testDir: './e2e'` setting
3. Check test file names end with `.spec.ts`
4. Ensure files are in correct directory
5. Build should complete without errors
6. `npx playwright install` to download browsers

### Port Already in Use

**Problem**: `Error: Could not bind to port 3002`

**Solution**:
```bash
# Kill process on port 3002
lsof -ti:3002 | xargs kill -9

# Or use different port
PW_TEST_PORT=3003 npx playwright test
```

### Session Invalid

**Problem**: Tests redirected to login, not accessing admin pages

**Solutions**:
1. Verify environment variables:
   ```bash
   echo $NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY
   echo $MARKETPLACE_SESSION_KEY
   ```

2. Update `playwright.config.ts` with correct values

3. Check session fixture generates valid tokens:
   ```typescript
   const token = generateTestSessionToken();
   console.log('Token:', token);
   ```

### Timeout Errors

**Problem**: `Timeout waiting for element` or `Timeout navigating to URL`

**Solutions**:
1. Increase timeout in test:
   ```typescript
   await expect(element).toBeVisible({ timeout: 10000 });
   ```

2. Check server is running:
   ```bash
   curl http://localhost:3002
   ```

3. Increase webServer timeout in `playwright.config.ts`:
   ```typescript
   timeout: 600_000 // 10 minutes
   ```

## Best Practices

### Writing New Tests

1. **Use Page Objects**
   ```typescript
   // ✅ Good
   const page = new CatalogPage(page);
   await page.searchAgent('test');

   // ❌ Avoid
   await page.locator('input').fill('test');
   ```

2. **Wait for Network**
   ```typescript
   // ✅ Good
   await page.waitForLoadState('networkidle');

   // ❌ Avoid
   await page.waitForTimeout(1000);
   ```

3. **Use Data Attributes**
   ```typescript
   // In component: <div data-testid="agent-card">
   // In test:
   await page.locator('[data-testid="agent-card"]').click();
   ```

4. **Clear State Between Tests**
   ```typescript
   test.afterEach(async ({ page }) => {
     await clearAdminSession(page);
   });
   ```

### Performance

- Run tests in parallel when possible (set `workers` > 1)
- Reuse existing server: `PW_REUSE_SERVER=1 npx playwright test`
- Use `test.describe.serial()` only for dependent tests

### Maintenance

- Update Page Objects when UI changes
- Keep selectors stable (use data-testid)
- Review tests quarterly for flakiness
- Document new test cases

## Test Report Example

```
╔══════════════════════════════════════════════════════════════╗
║                  E2E Test Results                            ║
╠══════════════════════════════════════════════════════════════╣
║ Status:     ✅ ALL TESTS PASSED                              ║
║ Tests:      17 passed, 0 failed                              ║
║ Duration:   45.2s                                            ║
║ Browsers:   Chromium, Firefox, WebKit                        ║
║ Artifacts:  screenshots, videos, traces (on failure)         ║
╚══════════════════════════════════════════════════════════════╝
```

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [API Reference](https://playwright.dev/docs/api/class-test)
- [Page Object Model](https://playwright.dev/docs/pom)

## Support

For issues or questions:
1. Check `playwright-report/index.html` for detailed test results
2. Review trace files with `npx playwright show-trace`
3. Inspect DOM in `--debug` mode
4. Check `CLAUDE.md` for environment setup
