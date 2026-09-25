# AgentFlow SDLC packaging and harness adapters

Canonical AgentFlow SDLC product source is harness-neutral. Do not place product-owned source under `.pi`, `.claude`, `.agy`, or `.codex`.

## Current distribution status

Install the CLI directly from GitHub using npm; no manual source checkout is required:

```bash
npm install -g github:smota/agentflow-sdlc
agentflow-sdlc adopt plan --profile standard --target /path/to/project --json
agentflow-sdlc sdlc validate --target /path/to/project --json
```

For a one-off invocation, use `npx -y github:smota/agentflow-sdlc <command>`.
The GitHub package source is explicit in both forms; these commands do not require an npm registry release.

## Composition profiles

Logical composition precedes physical package extraction. `minimal`, `standard`, `github`, and
`cockpit` form the supported progression; `standard` is the default.

```bash
agentflow-sdlc adopt profiles --json
agentflow-sdlc adopt plan --profile standard --target /path/to/project --json
```

`manifests/composition-profiles.json` is the profile authority. Contract and installed-payload tests
must pass before any physical npm package split. Package directories remain implementation details;
consumers bind to versioned contracts.

Skill-only distribution uses the portable packages under `skills/agentflow-<skill>/`.
The single public identity is `agentflow-<skill>`, used unchanged in source frontmatter,
catalog entries, plugin payloads and generated flat adapters. Short and colon-separated
skill names are not supported aliases. See [default skills](default-skills.md) for the six names.

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
- `skills/agentflow-orchestrator/`
- `skills/agentflow-collaborator/`
- `skills/agentflow-scanner/`
- `skills/agentflow-designer/`
- `skills/agentflow-migrator/`
- `skills/agentflow-auditor/`

## Generated targets

Generated adapters may be written to harness-specific folders:

- Claude Code: `.claude/skills/`
- Pi: `.pi/skills/`
- Agy, Antigravity, and Codex use a shared skill-compatible target, `.agents/skills/`, while retaining distinct runtime provenance identities.

Generated `SKILL.md` files preserve YAML frontmatter as the first bytes, then identify the canonical
source. Supporting `references/`, `scripts/`, `assets/`, and `agents/` content is copied with the
skill so progressive-disclosure links remain valid.

## Adapter commands

With the CLI installed, run these commands from your project directory:

```bash
agentflow-sdlc skills sync --harness all --dry-run
agentflow-sdlc skills catalog --json
agentflow-sdlc skills validate --json
agentflow-sdlc skills sync --harness claude-code,agy,codex,pi --apply
agentflow-sdlc skills status --harness all --json
agentflow-sdlc roles catalog --json
agentflow-sdlc roles validate --json
agentflow-sdlc roles sync --harness all --dry-run
agentflow-sdlc roles status --harness all --json
agentflow-sdlc methods validate --json
agentflow-sdlc plugins validate --harness all --json
agentflow-sdlc plugins build --harness all --dry-run
agentflow-sdlc settings validate --harness all --json
agentflow-sdlc settings merge --harness all --dry-run
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
