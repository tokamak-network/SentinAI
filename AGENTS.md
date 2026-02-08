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
- `npm run setup`: interactive `.env.local` setup wizard.

## Coding Style & Naming Conventions
- Use TypeScript and React function components; keep logic in `src/lib` and UI in `src/components`.
- Follow existing formatting: 2-space indentation and single quotes in TS/TSX.
- Use PascalCase for components and types (e.g., `RCAResult`), camelCase for functions/variables.
- Run `npm run lint` before pushing changes.

## Testing Guidelines
- Testing framework: Vitest (see `vitest.config.ts`).
- Test files are named `*.test.ts` and typically live in `src/lib/__tests__`.
- Coverage is scoped to `src/lib/**/*.ts` (excluding tests). Run `npm run test:coverage` when modifying core logic.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:` (see recent history).
- PRs should include a concise description, linked issues if applicable, and screenshots/GIFs for UI changes.
- Note any new environment variables or setup steps in the PR description.

## Security & Configuration Tips
- Keep secrets in `.env.local`; never commit API keys.
- Required config is documented in `ENV_GUIDE.md`. Use `npm run setup` to generate `.env.local`.
