# Project configuration contract

The engines in this framework (`scripts/ensure-workflow-artifacts.mjs`, `scripts/validate-bounded.mjs`)
are stack-agnostic. A consuming project supplies its own values in a single root-level
`agent-workflow.config.json`, which these scripts read at runtime. Nothing here is required —
every field has a safe, fails-closed default — but without it, bounded-work classification will
never mark anything as bounded, and PR manifests will use placeholder CI commands.

## Shape

```json
{
  "ciCommands": [
    "pnpm lint",
    "pnpm --filter @scope/pkg-a exec tsc --noEmit",
    "pnpm test:coverage",
    "pnpm build"
  ],
  "bounded": {
    "maxFiles": 50,
    "maxChangedLines": 10000,
    "defaultBase": "origin/main",
    "deniedPathFragments": ["/auth/", "/billing/", "/migrations/"],
    "allowedExactPaths": ["README.md"],
    "allowedPathPrefixes": ["docs/", "packages/ui/src/"],
    "allowedPathFragments": ["/test/fixtures/", "/__fixtures__/"],
    "sensitiveAdditionPattern": "(TenantGuard|stripe|process\\.env|secret)"
  }
}
```

## Fields

- `ciCommands` — the exact lint/typecheck/test/build commands this project's CI runs, used to
  pre-fill the PR manifest template's `## CI-equivalent validation` section.
- `bounded.maxFiles` / `bounded.maxChangedLines` — hard limits on Lane B (bounded, self-reviewable)
  diffs.
- `bounded.defaultBase` — the branch bounded diffs are compared against when `--base` isn't passed.
- `bounded.deniedPathFragments` — any changed path containing one of these fragments is never
  bounded, regardless of the allow-list below.
- `bounded.allowedExactPaths` / `allowedPathPrefixes` / `allowedPathFragments` — the only paths
  eligible for bounded classification. With this empty (the default), nothing is bounded.
- `bounded.sensitiveAdditionPattern` — a regex (case-insensitive) checked against added diff lines;
  a match disqualifies the diff from bounded status even if every path is otherwise allowed.

See `agents/templates/stack-conventions.md` for the companion doc that carries a project's
role-persona domain checklists (the parts of `docs/stack-conventions.md` this config file doesn't
cover).
