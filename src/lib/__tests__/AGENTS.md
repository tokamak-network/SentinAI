# AGENTS.md — src/lib/__tests__/

## Test Framework

Vitest. All tests run via `npm run test:run`.

## Patterns

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env vars (preferred over process.env mutation)
beforeEach(() => {
  vi.stubEnv('SENTINAI_CLIENT_FAMILY', 'nethermind');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// Mock modules
vi.mock('@/lib/client-detector', () => ({
  detectClient: vi.fn(),
  detectExecutionClient: vi.fn(),
}));
```

## Coverage Scope

`src/lib/**/*.ts` — tests in this directory count toward coverage.

## Naming Convention

- `<module-name>.test.ts` for src/lib/* modules
- `client-profile.test.ts` for builtin-profiles + types
- `client-profile-env.test.ts` for env-overrides
- `sync-parsers.test.ts` for sync-parsers
