# SentinAI Website Admin Marketplace Deployment Guide

## Overview

The website admin marketplace is a standalone Next.js application deployed to Vercel. It provides a secure, wallet-based authentication system using Sign-In with Ethereum (SIWE) and allows authorized admins to manage marketplace operations.

**Key Features:**
- ✅ Wallet-based authentication (MetaMask)
- ✅ SIWE token-based session management
- ✅ Self-verifiable HMAC-SHA256 tokens (no database required)
- ✅ Edge Runtime middleware for route protection
- ✅ Full CRUD operations for agents, pricing, orders, and analytics

---

## Prerequisites

1. **Admin Wallet Address**
   - An Ethereum wallet address you control
   - Must be able to sign messages with MetaMask or compatible wallet
   - Recommended: Use a hardware wallet for production

2. **Vercel Account**
   - Create account at https://vercel.com
   - Connect your GitHub repository

3. **Environment Variables**
   - See `.env.local.example` for required variables

---

## Local Development Setup

### 1. Copy Environment Template

```bash
cp .env.local.example .env.local
```

### 2. Configure Admin Address

Edit `.env.local` and set your admin wallet address:

```bash
NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x742d35Cc6634C0532925a3b844Bc92d426D00Eff
```

**Note:** Must be a checksum-formatted Ethereum address. Use [Etherscan](https://etherscan.io) to verify format.

### 3. Generate Session Key

Generate a secure random key for session token signing:

```bash
# macOS/Linux
openssl rand -base64 32 | tr -d '\n' | pbcopy  # Copies to clipboard

# Or directly set in .env.local:
MARKETPLACE_SESSION_KEY=<your-generated-key>
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Start Development Server

```bash
npm run dev
# Server runs on http://localhost:3003
```

### 6. Test Login Flow

1. Navigate to http://localhost:3003/admin/login
2. Click "CONNECT WALLET"
3. Approve MetaMask popup
4. Sign the SIWE message
5. Should redirect to `/admin` dashboard

---

## Production Deployment to Vercel

### Step 1: Push Code to GitHub

Ensure your repository is up to date:

```bash
git push origin main
```

### Step 2: Create Vercel Project

**Option A: Via CLI**

```bash
npm install -g vercel
cd website
vercel
```

**Option B: Via Vercel Dashboard**

1. Go to https://vercel.com
2. Click "New Project"
3. Select your GitHub repository
4. Configure project settings:
   - **Framework Preset:** Next.js
   - **Root Directory:** website (if mono-repo)
   - **Build Command:** `next build`
   - **Output Directory:** `.next`

### Step 3: Add Environment Variables

In Vercel Dashboard > Project Settings > Environment Variables:

```
NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x742d35Cc6634C0532925a3b844Bc92d426D00Eff
MARKETPLACE_SESSION_KEY=<secure-random-key>
```

**Important:**
- `NEXT_PUBLIC_*` variables are exposed to browser (address is public anyway)
- `MARKETPLACE_SESSION_KEY` is sensitive - use Vercel's secret management
- Different values for preview/development/production if needed

### Step 4: Deploy

```bash
git push origin main
```

Vercel automatically deploys on push. Monitor deployment at https://vercel.com/dashboard

---

## Accessing the Admin Panel

### URL Structure

- **Production:** https://sentinai.vercel.app/admin
- **Login Page:** https://sentinai.vercel.app/admin/login
- **Staging:** https://sentinai-staging.vercel.app/admin (if configured)

### First Login

1. Navigate to `/admin/login`
2. Connect wallet that matches `NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY`
3. Approve SIWE message signature
4. Session cookie set for 8 hours
5. Access dashboard and management pages

### Pages Available

| Route | Purpose |
|-------|---------|
| `/admin` | Dashboard with quick links |
| `/admin/catalog` | Manage agents (CRUD) |
| `/admin/pricing` | Set pricing tiers |
| `/admin/orders` | View and manage orders |
| `/admin/analytics` | View statistics |
| `/admin/login` | Wallet connection |

---

## Architecture

### Authentication Flow

```
User Wallet (MetaMask)
    ↓
GET /api/admin/auth/nonce
    ↓ (5-min nonce issued)
personal_sign(SIWE message + nonce)
    ↓
POST /api/admin/auth/verify
    ↓ (verifyMessage + address check)
Issue session token
    ↓ (admin_{address}_{issuedAt}_{expiresAt}_{hmac})
Set-Cookie: sentinai_admin_session (HttpOnly, 8h)
    ↓
Middleware validates token on each request
    ↓
/admin/* pages protected
```

### Session Token

- **Format:** `admin_{address}_{issuedAt}_{expiresAt}_{hmac}`
- **Verification:** Self-verifiable with HMAC-SHA256
- **TTL:** 8 hours
- **Storage:** Client cookie (HttpOnly, Secure, SameSite=Lax)
- **No Database Required:** Token includes all info for verification

### Middleware Protection

- Runs on all `/admin/*` requests
- Validates session cookie
- Checks token expiration
- Verifies HMAC signature
- Confirms admin address match
- Redirects to login if invalid

---

## Security Considerations

### Best Practices

1. **Use Hardware Wallet in Production**
   - Hardware wallets (Ledger, Trezor) are more secure than software wallets
   - Reduces risk of key compromise

2. **Rotate Session Key Periodically**
   - Every 90 days in production
   - All users will need to re-login
   - Keep old key for gradual transition

3. **Monitor Access Logs**
   - Check Vercel analytics for unusual access patterns
   - Review IP geolocation if available

4. **Use HTTPS Only**
   - Vercel enforces HTTPS automatically
   - Session cookies only transmitted over HTTPS

5. **Change Admin Address if Compromised**
   - Update `NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY`
   - All sessions will be invalidated
   - Current admins must log in again

### What's Protected

- ✅ Route access requires valid session
- ✅ API endpoints verify session token
- ✅ Session tokens are HMAC-signed
- ✅ Cookies are HttpOnly (not accessible to JS)
- ✅ Middleware runs on Edge for performance

### What's Public (By Design)

- ⓘ Admin address is public (NEXT_PUBLIC_* env var)
- ⓘ Login page is public (anyone can attempt login)
- ⓘ Token nonce endpoint is public (required for login flow)

---

## Troubleshooting

### Issue: MetaMask Not Detected

**Solution:**
- Ensure MetaMask extension is installed
- Try a different browser (Chrome, Firefox, Brave)
- Check that `window.ethereum` is available

### Issue: "Invalid Signature" Error

**Possible Causes:**
1. Wallet address doesn't match `NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY`
2. User signed wrong message or cancelled
3. Nonce expired (5-minute timeout)

**Solution:**
- Verify wallet address matches exactly (case-insensitive)
- Try login again (new nonce is issued)
- Check browser console for detailed error

### Issue: Session Expires Too Quickly

**Solution:**
- Check token TTL: should be 8 hours (28,800,000 ms)
- Verify `MARKETPLACE_SESSION_KEY` hasn't changed
- Browser cookies not blocked by privacy settings?

### Issue: Cannot Deploy to Vercel

**Common Causes:**
1. Build command fails
2. TypeScript errors
3. Missing environment variables

**Solution:**
```bash
# Test local build
npm run build

# Check for errors
npx tsc --noEmit

# Verify env vars
echo $NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY
echo $MARKETPLACE_SESSION_KEY
```

---

## Testing

### Run E2E Tests

```bash
npm run test e2e/admin-pages.spec.ts
```

### Test Coverage

- ✅ Session protection (32 tests)
- ✅ UI structure and navigation
- ✅ API authentication
- ✅ Redirect behavior

---

## Monitoring & Maintenance

### Vercel Dashboard

Monitor at https://vercel.com/dashboard:
- Deployment status
- Build logs
- Function analytics
- Error tracking

### Application Metrics

- **Session Duration:** Check average session length
- **Login Success Rate:** Track failed login attempts
- **API Response Times:** Ensure endpoints perform well

### Regular Tasks

- [ ] Check deployment logs weekly
- [ ] Rotate session key every 90 days
- [ ] Update dependencies monthly
- [ ] Review access patterns in analytics

---

## Rollback Procedure

If deployment breaks production:

### Option 1: Revert Last Commit

```bash
git revert HEAD
git push origin main
```

Vercel auto-deploys, new version live in ~30 seconds.

### Option 2: Deploy Previous Vercel Deployment

In Vercel Dashboard:
1. Go to Deployments tab
2. Click previous successful deployment
3. Click "Redeploy"

---

## Support & Documentation

- **Next.js Docs:** https://nextjs.org/docs
- **SIWE Spec:** https://eips.ethereum.org/EIPS/eip-4361
- **Vercel Docs:** https://vercel.com/docs
- **MetaMask API:** https://docs.metamask.io

---

## FAQ

**Q: Can multiple admins manage the marketplace?**

A: Current implementation supports single admin. To add multiple admins, modify:
1. Change `NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY` to accept array of addresses
2. Update validation in `admin-session.ts`
3. Update middleware to check against array

**Q: What happens if someone gets the session key?**

A: They could forge session tokens. Rotate immediately:
1. Update `MARKETPLACE_SESSION_KEY`
2. All existing sessions become invalid
3. Everyone re-logs in
4. Check access logs for unauthorized activity

**Q: Can I test with MetaMask testnet?**

A: Yes, but message signature remains valid regardless of network. For production, use mainnet addresses only.

**Q: How do I update the admin address?**

A: Update `NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY` in Vercel environment variables. All users will be logged out automatically (token validation fails).

---

**Last Updated:** March 14, 2026
**Version:** 1.0
