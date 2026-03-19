#!/bin/bash

# SentinAI Marketplace E2E Test Runner
# Supports: Option A (Windows Chrome) + Option B (Docker)

set -e

echo "🧪 SentinAI Marketplace E2E Test Suite"
echo "======================================"
echo ""

cd "$(dirname "$0")/website"

# Detect environment
OS=$(uname -s)
echo "📱 Environment: $OS"
echo ""

# Function: Option A (Windows Chrome via Remote Debugging)
run_option_a() {
  echo "🔥 Option A: Windows Chrome via Remote Debugging"
  echo "================================================"
  echo ""
  echo "Prerequisites:"
  echo "1. Windows Chrome should be running with:"
  echo "   C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --remote-debugging-port=9222"
  echo ""
  echo "Starting Playwright tests..."
  echo ""
  
  npx playwright test e2e/marketplace-page.spec.ts \
    --project=chromium-desktop \
    --reporter=list
  
  echo ""
  echo "✅ Tests completed!"
  echo "📊 View report: open playwright-report/index.html"
}

# Function: Option B (Docker)
run_option_b() {
  echo "🐳 Option B: Docker"
  echo "==================="
  echo ""
  
  # Check if Docker is available
  if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Install Docker first."
    exit 1
  fi
  
  echo "Pulling Playwright Docker image (v1.58.2)..."
  docker pull mcr.microsoft.com/playwright:v1.58.2-jammy
  
  echo ""
  echo "Running tests in Docker..."
  docker run --rm \
    -v "$(pwd)":/app \
    -w /app \
    mcr.microsoft.com/playwright:v1.58.2-jammy \
    npx playwright test e2e/marketplace-page.spec.ts \
    --reporter=list
  
  echo ""
  echo "✅ Tests completed!"
}

# Menu
echo "Choose test option:"
echo "1) Option A - Windows Chrome (via remote debugging)"
echo "2) Option B - Docker"
echo ""
read -p "Enter choice (1 or 2): " choice

case $choice in
  1)
    run_option_a
    ;;
  2)
    run_option_b
    ;;
  *)
    echo "Invalid choice. Exiting."
    exit 1
    ;;
esac
