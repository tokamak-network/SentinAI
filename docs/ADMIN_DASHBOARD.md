# Marketplace Admin Dashboard

## Overview

The Marketplace Admin Dashboard is a secure, authenticated interface for managing marketplace operations in SentinAI. It provides complete CRUD operations for catalog agents, dynamic pricing management, transaction history viewing, and analytics insights.

**Key Features:**
- SIWE (Sign-In with Ethereum) authentication with MetaMask
- Session-based access control (7-day TTL)
- Catalog management (add/edit/delete agents)
- Dynamic pricing tier configuration
- Order history and transaction tracking
- Comprehensive analytics dashboard

## Architecture

### Authentication Flow

1. **Login Page** (`/admin/login`)
   - MetaMask wallet connection
   - SIWE (Sign-In with Ethereum) message signing
   - Session cookie generation (sentinai_admin_session)

2. **Verification** (`/api/admin/auth/verify`)
   - Validates SIWE signature
   - Issues session cookie with 7-day TTL
   - HMAC-based token verification

3. **Middleware Protection** (`middleware.ts`)
   - All `/admin` routes require valid session cookie
   - Automatic redirect to login for unauthenticated access

4. **Logout** (`/api/admin/auth/logout`)
   - Clears session cookie
   - Redirects to login page

### Data Storage

**Marketplace Store** (Redis-backed with in-memory fallback)
```
IMarketplaceStore interface:
├── Pricing Management
│   ├── getPricingConfig()
│   ├── updatePricing()
│   └── resetPricingToDefaults()
├── Bonus Configuration
│   ├── getBonusConfig()
│   └── updateBonusConfig()
├── Catalog Management
│   ├── getCatalogAgents()
│   ├── createCatalogAgent()
│   ├── updateCatalogAgent()
│   └── deleteCatalogAgent()
└── Orders
    ├── getOrders(page, limit)
    ├── createOrder()
    └── getOrdersSummary()
```

**State Store Integration**
- `RedisStateStore`: Redis-backed persistence with JSON serialization
- `InMemoryStateStore`: Fallback for development/testing
- TTL: No expiration for marketplace data (persistent storage)

## Pages

### 1. Marketplace Admin Dashboard (`/admin`)
Quick-access dashboard with navigation cards:
- **Catalog**: Manage agents available in marketplace
- **Pricing**: Configure pricing tiers (trainee, junior, senior, expert)
- **Orders**: View transaction history
- **Analytics**: Revenue and performance metrics

### 2. Catalog Management (`/admin/catalog`)
**Features:**
- Search and filter agents by name and tier
- Add new agents with form validation
- Edit agent details (name, description, tier, capabilities)
- Delete agents with confirmation dialog
- Color-coded tier badges
- Real-time updates after operations

**API Endpoints:**
- `GET /api/admin/catalog` - Fetch all agents
- `POST /api/admin/catalog` - Create new agent
- `PATCH /api/admin/catalog/[id]` - Update agent
- `DELETE /api/admin/catalog/[id]` - Delete agent

### 3. Pricing Management (`/admin/pricing`)
**Features:**
- Display current pricing for all 4 tiers
- Real-time price editing with validation
- Change tracking (highlight modified fields)
- Save changes atomically
- Reset to defaults functionality
- Price in USD cents for precision

**Pricing Defaults:**
- Trainee: $0 (0 cents)
- Junior: $199 (19,900 cents)
- Senior: $499 (49,900 cents)
- Expert: $799 (79,900 cents)

**API Endpoint:**
- `GET/PUT /api/marketplace/pricing` - Manage pricing configuration

### 4. Orders (`/admin/orders`)
**Features:**
- Paginated order table (10, 20, 50, 100 per page)
- Search by order ID, agent ID, or buyer address
- Summary cards showing total orders and revenue
- Tier-colored badges
- Formatted prices and timestamps
- Read-only view (no edit/delete)

**Columns:**
- Order ID (truncated)
- Agent ID (truncated)
- Buyer Address (truncated)
- Tier (color-coded)
- Price (USD formatted)
- Created At (formatted timestamp)

**API Endpoint:**
- `GET /api/admin/orders?page=1&limit=20` - Fetch paginated orders

### 5. Analytics (`/admin/analytics`)
**Features:**
- Key metrics: Total orders, total revenue
- Revenue breakdown by tier
- Order distribution visualization
- Top agents by revenue
- Average order value per agent
- Empty state messaging

**Metrics Computed:**
- Revenue by tier (absolute and percentage)
- Order count by tier
- Top 5 agents by revenue
- Average order value calculations

**API Endpoint:**
- `GET /api/admin/orders?page=1&limit=1000` - Fetch all orders for analytics

## Data Models

### CatalogAgent
```typescript
interface CatalogAgent {
  id: string;
  name: string;
  description: string;
  tier: 'trainee' | 'junior' | 'senior' | 'expert';
  capabilities: string[];
  createdAt: number;
  updatedAt: number;
}
```

### MarketplaceOrder
```typescript
interface MarketplaceOrder {
  id: string;
  agentId: string;
  buyerAddress: string;
  tier: 'trainee' | 'junior' | 'senior' | 'expert';
  priceInCents: number;
  createdAt: number;
}
```

### MarketplacePricingConfig
```typescript
interface MarketplacePricingConfig {
  traineePrice: number;      // cents
  juniorPrice: number;       // cents
  seniorPrice: number;       // cents
  expertPrice: number;       // cents
  updatedAt: string;         // ISO 8601
  updatedBy?: string;        // optional operator address
}
```

## Security

**Authentication:**
- SIWE (Sign-In with Ethereum) - cryptographically signed messages
- MetaMask wallet verification
- Session cookies with HMAC verification
- 7-day TTL (configurable)

**Authorization:**
- Middleware checks session cookie on all /admin routes
- Automatic redirect to login for expired sessions
- Admin address validation via environment variable

**Data Validation:**
- Input validation on all API endpoints
- Positive integer enforcement for prices
- Required field validation
- Array length validation

**API Security:**
- All admin endpoints protected by session middleware
- CORS headers on OPTIONS requests
- No sensitive data exposure in error messages
- Proper HTTP status codes

## Environment Variables

```bash
NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x<admin_address>  # Admin wallet address
REDIS_URL=redis://localhost:6379                     # Optional Redis connection
```

## Testing

**Build Verification:**
```bash
next build    # Should complete with 0 new errors
```

**Development:**
```bash
npm run dev   # Start dev server on port 3002
```

## Integration with Marketplace

**Pricing Updates:** Changes made in admin pricing page → cached in Redis → served to marketplace via `/api/marketplace/pricing`

**Catalog Sync:** Agents added/edited/deleted in admin → stored in Redis → available to marketplace consumers

**Order Tracking:** Orders created via marketplace → stored in Redis → visible in admin orders page

**Revenue Analytics:** Order data → aggregated in analytics page → tier and agent breakdowns

## Future Enhancements

- [ ] Bulk agent imports (CSV)
- [ ] Price change history and audit log
- [ ] Order filtering by date range
- [ ] Export analytics to CSV
- [ ] Real-time order notifications
- [ ] Agent performance recommendations
- [ ] Automated tier-up suggestions based on orders
- [ ] Multi-admin support with role-based access
