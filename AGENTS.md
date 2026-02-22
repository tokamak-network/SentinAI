# Repository Guidelines

## Project Structure & Module Organization
- `src/app` hosts the Next.js App Router entry points (pages, layouts, API routes).
- `src/components` contains reusable UI components.
- `src/lib` contains core business logic (scaling, AI, and K8s utilities).
- `src/types` defines shared TypeScript types.
- Static assets live in `public`, and global styles are in `src/app/globals.css`.
- Tests live alongside code in `src/lib/__tests__`.

## Build, Test, and Development Commands
- `npm run dev`: start the local dev server on port 3002.
- `npm run build`: create a production build.
- `npm run start`: run the production server.
- `npm run lint`: run ESLint with Next.js rules.
- `npm run test`: run Vitest in watch mode.
- `npm run test:run`: run Vitest once (CI-friendly).
- `npm run test:coverage`: generate coverage reports.


## Coding Style & Naming Conventions
- Use TypeScript and React function components; keep logic in `src/lib` and UI in `src/components`.
- Follow existing formatting: 2-space indentation and single quotes in TS/TSX.
- Use PascalCase for components and types (e.g., `RCAResult`), camelCase for functions/variables.
- Write all code and code comments in English.
- Korean is allowed for guide/operations documentation under `docs/**`.
- Run `npm run lint` before pushing changes.

## Testing Guidelines
- Testing framework: Vitest (see `vitest.config.ts`).
- Test files are named `*.test.ts` and typically live in `src/lib/__tests__`.
- Coverage is scoped to `src/lib/**/*.ts` (excluding tests). Run `npm run test:coverage` when modifying core logic.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:` (see recent history).
- PRs should include a concise description, linked issues if applicable, and screenshots/GIFs for UI changes.
- Note any new environment variables or setup steps in the PR description.

## AI Model Configuration (Tier-Based)

SentinAI uses automatic tier-based model selection:

### Model Tiers

**Fast Tier** — Real-time operations (latency < 5s):
- Primary: `qwen3-80b-next` (1.8s, 100% accuracy, $30/mo)
- Fallback: `qwen3-coder-flash` (3.3s, 100% accuracy, $15/mo)

**Best Tier** — Complex analysis (latency < 15s):
- Primary: `qwen3-235b` (11s, 100% accuracy, $60/mo)
- Alternative: `gpt-5.2-codex` (10s, 100% accuracy, $300/mo)

### Automatic Tier Selection

```typescript
// No model name needed — tier automatically selects optimal model
await chatCompletion({
  systemPrompt: '...',
  userPrompt: '...',
  modelTier: 'fast'   // → auto-selects qwen3-80b-next
});

await chatCompletion({
  systemPrompt: '...',
  userPrompt: '...',
  modelTier: 'best'   // → auto-selects qwen3-235b
});
```

### Configuration

Set only the API key in `.env.local`:
```bash
QWEN_API_KEY=your-qwen-api-key-here
```

No model override needed; tier-based selection works automatically.

---

## Security & Configuration Tips
- Keep secrets in `.env.local`; never commit API keys.
- Required config is documented in `ENV_GUIDE.md`. Copy `.env.local.sample` and edit, or use `scripts/install.sh` for EC2 deployment.
