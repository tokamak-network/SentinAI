# Playwright E2E Test Guide

## SentinAI Marketplace E2E Testing

### ✅ Current Status
- **WSL2 (Linux)**: Cannot run Playwright browser (GUI libraries missing)
- **Windows Host**: Chrome available with remote debugging
- **Solution**: Use Windows Chrome via remote debugging protocol

---

## 📋 Prerequisites

### 1. **Windows (Host)**
```bash
# Install Playwright browser binaries on Windows
npm install --save-dev @playwright/test

# Or run directly
npx playwright install
```

### 2. **WSL2 (Linux)** - Already Done
```bash
✅ npm install @playwright/test
✅ Playwright test infrastructure ready
✅ API layer tested and passing
```

---

## 🚀 Option A: Windows Chrome (Recommended)

### Step 1: Enable Remote Debugging in Windows Chrome
```powershell
# Option 1: Launch Chrome with remote debugging port
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
& $chromePath --remote-debugging-port=9222

# Option 2: If Chrome is already running, enable in browser
# Open chrome://inspect in the running Chrome instance
```

### Step 2: Configure WSL2 to Connect to Windows Chrome
```bash
# Find Windows host IP (from WSL2 perspective)
cat /etc/resolv.conf | grep nameserver
# Returns: nameserver 172.24.80.1 (this is Windows gateway)

# Or use hostname
cat /proc/sys/kernel/hostname
```

### Step 3: Run Playwright Tests
```bash
cd /home/theo/.openclaw/workspace/SentinAI/website

# Test with Windows Chrome via remote debugging
PLAYWRIGHT_TEST_BASE_URL=http://localhost:3003 \
npx playwright test e2e/marketplace-page.spec.ts \
  --config=playwright.config.ts \
  --project=chromium-desktop
```

---

## 🐳 Option B: Docker (Alternative)

### Step 1: Install Docker
```bash
# Already installed in this environment
docker --version
```

### Step 2: Obtain Sudo Access (if needed)
```bash
# If you get "permission denied" error
sudo usermod -aG docker $USER
sudo su - $USER  # Refresh group membership
```

### Step 3: Run Playwright in Docker
```bash
cd /home/theo/.openclaw/workspace/SentinAI/website

docker run --rm \
  -v $(pwd):/app \
  -w /app \
  mcr.microsoft.com/playwright:latest \
  npx playwright test e2e/marketplace-page.spec.ts
```

---

## 📊 Expected Test Results

### Tests Should Pass:
- ✅ API endpoints (catalog, payment-requirements)
- ✅ Data services return 402 (X-402 auth required)
- ✅ Payment flow initialization

### Tests May Fail (UI-specific):
- ❌ Navigation to pages (requires actual localhost:3003 server)
- ❌ Element visibility checks (requires rendered DOM)

---

## 🔍 Debugging Failed Tests

### 1. Check Playwright Report
```bash
# After tests run, open HTML report
open playwright-report/index.html  # macOS
start playwright-report/index.html  # Windows
```

### 2. Run Single Test with Debug
```bash
npx playwright test e2e/marketplace-page.spec.ts --debug
```

### 3. View Test Screenshots
```bash
ls -la test-results/
```

---

## 📝 Test Structure

### File: `e2e/marketplace-page.spec.ts`
- **Marketplace Navigation**: Page accessibility, navbar
- **Marketplace Content**: Main content area, rendering
- **API Endpoints**: Catalog, payment, data services
- **Tab Navigation**: Registry, instance, guide, sandbox

### File: `e2e/marketplace-operators.spec.ts` (Optional)
- **Operators Page**: Load and display
- **Trust Metrics**: Rating, uptime, latency
- **Navigation**: Links and buttons

### File: `e2e/purchase-flow.spec.ts` (Optional)
- **Purchase Modal**: Open and close
- **MetaMask Integration**: Connection flow
- **Payment Authorization**: EIP-712 signing

---

## ✨ Quick Start Command

```bash
# WSL2 → Windows Chrome (via remote debugging)
cd /home/theo/.openclaw/workspace/SentinAI/website

# Make sure Windows Chrome is running with --remote-debugging-port=9222
# Then run:
npx playwright test e2e/marketplace-page.spec.ts --headed

# With local dev server (if needed):
npm run dev &  # Background
npx playwright test e2e/marketplace-page.spec.ts
```

---

## 🎯 Next Steps

1. **Option A**: 
   - Open Windows Chrome with `--remote-debugging-port=9222`
   - Run WSL2 command above

2. **Option B**:
   - Run Docker command above
   - (May require `sudo usermod -aG docker $USER`)

3. **Manual Testing** (No automation needed):
   - https://sentinai-xi.vercel.app/marketplace
   - Click through UI, verify functionality

---

## 📚 Resources

- [Playwright Docs](https://playwright.dev)
- [Playwright VS Code Extension](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright)
- [Chrome Remote Debugging](https://chromedevtools.github.io/devtools-protocol/)
