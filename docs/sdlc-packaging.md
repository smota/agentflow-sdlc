# AgentFlow SDLC packaging and harness adapters

Canonical AgentFlow SDLC product source is harness-neutral. Do not place product-owned source under `.pi`, `.claude`, `.agy`, or `.codex`.

## Distribution channels

1. Full product install through the npm CLI:
   ```bash
   npx agentflow-sdlc init
   npx agentflow-sdlc sync
   npx agentflow-sdlc sdlc validate --json
   ```
2. Skill-only install through `npx skills`, using the harness-neutral skill directories under `skills/`.
3. Generated harness adapters through:
   ```bash
   npx agentflow-sdlc skills sync --harness all --apply
   ```

## Canonical source

- `docs/sdlc-definition.md`
- `defaults/sdlc.config.json`
- `schemas/sdlc-config.schema.json`
- `lib/sdlc-state.mjs`
- `skills/sdlc-definition/`
- `skills/sdlc-migration/`
- `skills/sdlc-audit/`

## Generated targets

Generated adapters may be written to harness-specific folders:

- Claude Code: `.claude/skills/`
- Pi: `.pi/skills/`
- AGY / Antigravity and Codex skill-compatible target: `.agents/skills/`

Generated files include a header identifying the canonical source and must be regenerated, not manually edited.

## Adapter commands

```bash
agentflow-sdlc skills sync --harness all --dry-run
agentflow-sdlc skills sync --harness claude-code,agy,codex,pi --apply
agentflow-sdlc skills status --harness all --json
```

`skills status` fails when generated adapters are stale or missing.

## Product rules

- Harness adapters delegate deterministic validation to CLI commands.
- Adapter drift is a product defect and should be surfaced by `doctor`/`skills status`.
- `sdlc.config.json` is project-owned seed-once state.
- Harness settings should use structural merge before production-grade overwrite behavior.
