# AgentFlow SDLC packaging and harness adapters

Canonical AgentFlow SDLC product source is harness-neutral. Do not place product-owned source under `.pi`, `.claude`, `.agy`, or `.codex`.

## Current distribution status

The package is not currently published on npm. Use a source checkout:

```bash
git clone https://github.com/smota/agentflow-sdlc.git
cd agentflow-sdlc
pnpm install
node bin/cli.mjs adopt plan --profile standard --target /path/to/project --json
node bin/cli.mjs sdlc validate --target /path/to/project --json
```

After npm publication, the equivalent interface is intended to be:

```bash
npx agentflow-sdlc adopt plan --profile standard --target /path/to/project --json
npx agentflow-sdlc sdlc validate --json
```

These `npx agentflow-sdlc` examples are post-publication guidance, not a current installation path.

## Composition profiles

Logical composition precedes physical package extraction. `minimal`, `standard`, `github`, and
`cockpit` form the supported progression; `standard` is the default.

```bash
node bin/cli.mjs adopt profiles --json
node bin/cli.mjs adopt plan --profile standard --target /path/to/project --json
```

`manifests/composition-profiles.json` is the profile authority. Contract and installed-payload tests
must pass before any physical npm package split. Package directories remain implementation details;
consumers bind to versioned contracts.

Skill-only distribution uses the harness-neutral packages under `skills/`. The public identity is
the plugin-qualified `agentflow:<role>` name. Raw folder and frontmatter names remain standards-safe
lowercase role slugs because portable skill specifications do not use `:` in the local name.
Flat directory adapters use `agentflow-<role>` as the standards-safe equivalent.

Lifecycle-role distribution is separate from skills. `manifests/role-catalog.json` defines nine
core accountability contracts and the optional QA sidecar; `manifests/method-catalog.json` defines
additive, parameterized ways to perform them. Modern role packages live under `roles/`. Generated
harness projections live under `.agentflow/roles/<harness>/` so the product does not claim that
every harness shares a native subagent format.

## Canonical source

- `docs/sdlc-definition.md`
- `defaults/sdlc.config.json`
- `schemas/sdlc-config.schema.json`
- `lib/sdlc-state.mjs`
- `lib/core/`
- `lib/providers/`
- `lib/sources/`
- `lib/adoption/`
- `manifests/skill-catalog.json`
- `manifests/role-catalog.json`
- `manifests/method-catalog.json`
- `roles/`
- `skills/orchestrator/`
- `skills/collaborator/`
- `skills/scanner/`
- `skills/designer/`
- `skills/migrator/`
- `skills/auditor/`

## Generated targets

Generated adapters may be written to harness-specific folders:

- Claude Code: `.claude/skills/`
- Pi: `.pi/skills/`
- Agy, Antigravity, and Codex use a shared skill-compatible target, `.agents/skills/`, while retaining distinct runtime provenance identities.

Generated `SKILL.md` files preserve YAML frontmatter as the first bytes, then identify the canonical
source. Supporting `references/`, `scripts/`, `assets/`, and `agents/` content is copied with the
skill so progressive-disclosure links remain valid.

## Adapter commands

From a source checkout:

```bash
node bin/cli.mjs skills sync --harness all --dry-run
node bin/cli.mjs skills catalog --json
node bin/cli.mjs skills validate --json
node bin/cli.mjs skills sync --harness claude-code,agy,codex,pi --apply
node bin/cli.mjs skills status --harness all --json
node bin/cli.mjs roles catalog --json
node bin/cli.mjs roles validate --json
node bin/cli.mjs roles sync --harness all --dry-run
node bin/cli.mjs roles status --harness all --json
node bin/cli.mjs methods validate --json
node bin/cli.mjs plugins validate --harness all --json
node bin/cli.mjs plugins build --harness all --dry-run
node bin/cli.mjs settings validate --harness all --json
node bin/cli.mjs settings merge --harness all --dry-run
```

`skills status` fails when generated adapters are stale or missing. `plugins validate` checks canonical native manifests. `settings merge` preserves project-owned keys and refuses non-object JSON roots instead of overwriting harness config.

## Product rules

- Harness adapters delegate deterministic validation to CLI commands.
- Adapter drift is a product defect and should be surfaced by `skills status` or `roles status`.
- `manifests/skill-catalog.json` owns public identities, peer recognition, typed handoffs, and exclusive responsibility areas.
- `manifests/role-catalog.json` owns lifecycle-role identities, exclusive accountability,
  authority, completion, and role-to-role handoff compatibility.
- Method plays are additive. They cannot override ownership, authority, transitions, readiness, or
  approval rules.
- `sdlc.config.json` is project-owned seed-once state.
- Harness settings use structural merge to preserve project-owned configuration.
