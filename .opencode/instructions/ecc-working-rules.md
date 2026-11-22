# ECC Working Rules

Working rules adopted from **Everything Claude Code (ECC) v2.2.3** and trimmed for this
repository. These load on every session and apply to all work in `underground-music`.

## Core Principles

1. **Agent-First** — delegate domain work to a specialised subagent when one fits.
2. **Test-Driven** — change behaviour only behind a test that first fails, then passes.
3. **Security-First** — never compromise on security; validate every input.
4. **Immutability** — build new values; do not mutate what you were given.
5. **Plan Before Execute** — plan non-trivial work before writing code.

## Security (CRITICAL)

Before ANY commit:

- [ ] No hardcoded secrets (API keys, passwords, tokens).
- [ ] All user input validated at the system boundary.
- [ ] SQL injection prevented (parameterised queries only).
- [ ] XSS prevented (escape/sanitise anything rendered as HTML).
- [ ] CSRF protection enabled where state changes.
- [ ] Authentication and authorisation verified.
- [ ] Rate limiting on every network endpoint.
- [ ] Error messages never leak sensitive data.

Secret management: never hardcode a secret. Read it from the environment or a secret
store, validate it at startup, and fail fast with a clear message when it is missing.
If an exposed secret is found: STOP, review with the security agent, fix CRITICAL issues,
rotate the secret, then sweep the codebase for the same mistake.

## Code Style

**Immutability (CRITICAL)** — return new values instead of mutating:

```js
// WRONG
function rename(user, name) { user.name = name; return user; }

// CORRECT
function rename(user, name) { return { ...user, name }; }
```

**File organisation** — many small files beat few large ones: high cohesion, low
coupling, organised by feature/domain rather than by type.

**Error handling** — handle errors at every level; give the user a friendly message and
keep the technical detail in logs. Never silently swallow an error.

**Input validation** — validate at boundaries; fail fast with a clear message; never
trust external data.

**Quality checklist** before calling work done:

- [ ] Readable, well-named identifiers.
- [ ] Functions small (< ~50 lines); files focused (< ~800 lines).
- [ ] No nesting deeper than ~4 levels.
- [ ] Proper error handling; no swallowed errors.
- [ ] No leftover debug logging.
- [ ] No hardcoded values that belong in config.
- [ ] No mutation where an immutable value would do.

## Verification & Testing

- Prefer proving behaviour with a test over asserting it in prose.
- Workflow: write the test first (RED) → make it pass (GREEN) → refactor (IMPROVE).
- When a test fails, fix the implementation — only change the test when the test itself
  is wrong.
- Never report a task as done without running the relevant checks and confirming the
  result. State plainly what was run and what it returned.

## Workflow

1. **Plan** — for anything non-trivial, plan first: dependencies, risks, phases.
2. **Implement** — smallest change that satisfies the requirement, tests alongside.
3. **Review** — review the change for quality, security and maintainability; fix
   CRITICAL/HIGH issues before moving on.
4. **Verify** — run the tests/smoke checks and confirm, don't assume.
5. **Commit** — conventional commits, with a summary that explains the "why".

## Git

- Commit format: `<type>: <description>` where type is one of
  `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- Keep unrelated changes out of a commit; one concern per commit.
- Do not push, merge to the default branch, or deploy without explicit approval.

## Applying These Rules Here

`underground-music` is a static site: plain HTML/CSS/JS with no bundler or `package.json`.
So "run the tests" means the `node:test` suites under `tests/` (`node tests/<name>.test.mjs`)
plus a manual smoke check against a local server. "No build step" does not relax the
security, immutability, verification or git rules above. Treat the Supabase schema and
stored data as read-only unless a task explicitly asks otherwise, and never break the
existing theme/routing/Supabase wiring.
