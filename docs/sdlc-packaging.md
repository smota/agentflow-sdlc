# AgentFlow SDLC packaging and harness adapters

Canonical AgentFlow SDLC product source is harness-neutral. Do not place product-owned source under `.pi`, `.claude`, `.agy`, or `.codex`.

## Current distribution status

The package is not currently published on npm. Use a source checkout:

```bash
git clone https://github.com/smota/agentflow-sdlc.git
cd agentflow-sdlc
pnpm install
node bin/cli.mjs init --target /path/to/project
node bin/cli.mjs sdlc validate --target /path/to/project --json
```

After npm publication, the equivalent interface is intended to be:

```bash
npx agentflow-sdlc init
npx agentflow-sdlc sync
npx agentflow-sdlc sdlc validate --json
```

These `npx agentflow-sdlc` examples are post-publication guidance, not a current installation path.

Skill-only distribution uses `npx skills` with the harness-neutral skill directories under `skills/`.

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
- Agy, Antigravity, and Codex use a shared skill-compatible target, `.agents/skills/`, while retaining distinct runtime provenance identities.

Generated files include a header identifying the canonical source and must be regenerated, not manually edited.

## Adapter commands

From a source checkout:

```bash
node bin/cli.mjs skills sync --harness all --dry-run
node bin/cli.mjs skills sync --harness claude-code,agy,codex,pi --apply
node bin/cli.mjs skills status --harness all --json
node bin/cli.mjs plugins validate --harness all --json
node bin/cli.mjs plugins build --harness all --dry-run
node bin/cli.mjs settings validate --harness all --json
node bin/cli.mjs settings merge --harness all --dry-run
```

`skills status` fails when generated adapters are stale or missing. `plugins validate` checks canonical native manifests. `settings merge` preserves project-owned keys and refuses non-object JSON roots instead of overwriting harness config.

## Product rules

- Harness adapters delegate deterministic validation to CLI commands.
- Adapter drift is a product defect and should be surfaced by `doctor` or `skills status`.
- `sdlc.config.json` is project-owned seed-once state.
- Harness settings use structural merge to preserve project-owned configuration.
