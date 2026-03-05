# Session & Context Management Rules

> IF 세션 시작 또는 컨텍스트 관리 → READ this file

## Context Minimization

- Load only information **directly needed** for the current task.
- Never reference unrelated previous session info, unnecessary files, or irrelevant skills.

## Post-Compaction Recovery

When context is compressed, always:
1. Re-read RULE.md.
2. Re-read the current task plan.
3. Re-read related working files.
4. **Never rely on "memory" — never assume.**

## No Assumptions

- If information is insufficient, **verify it**.
- Do not fill gaps with guesses.
- "It's probably X" is forbidden. Read the file or ask the user.

## Research ≠ Implementation

- If the implementation approach is unclear, **research first only**.
- Report research results to the user.
- Do NOT write code during the research phase.
- After research, get user's choice, then implement in a **fresh context**.

## Sycophancy Control

- Do not fabricate things that don't exist.
- "Find a bug" → may force-create bugs that don't exist. Use neutral prompts instead.
- If something doesn't exist, honestly report **"it doesn't exist"**.

## Plan Mode Default

- Non-trivial tasks (3+ steps or architecture decisions) **must start in plan mode**.
- If progress derails, stop immediately and re-plan. Do not force through.
- Use plan mode for verification steps too, not just implementation.
- Write detailed specs upfront to reduce ambiguity.

## Subagent Strategy

- Use subagents (Planner, Tester, etc.) to keep main context clean.
- Offload research, exploration, and parallel analysis to subagents.
- Invest more subagent compute in complex problems.
- One task per subagent for focus.

## Self-Improvement Loop

- Record pattern-based lessons in `rules/` whenever corrections occur.
- Write self-rules to prevent repeated mistakes; iterate relentlessly until error rate drops.
- Review project-relevant lessons at session start.

## Task Management

- **Plan First**: Write checkable items in `docs/todo.md`.
- **Verify Plan**: Review plan before implementation.
- **Track Progress**: Mark items complete as you go.
- **Explain Changes**: Write high-level summary at each step.
- **Document Results**: Add review section to `docs/todo.md`, update lessons.

## Session Scope

- Long sessions cause context pollution.
- One task contract per session.
- Do not mix unrelated task contexts.
