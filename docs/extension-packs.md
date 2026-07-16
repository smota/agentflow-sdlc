# Extension Packs

Extension packs are repository-level overlays for the core AgentFlow SDLC process. The core framework stays neutral: it owns phase order, issue/PR governance, role-pass evidence, execution-target attribution, and safety/review gates. A pack adds opinionated engineering guidance, tools, templates, required skills, harness capabilities, and validators without forking the process framework.

## Design goals

- **Complete from day one:** a configured pack must be documented, machine-readable, and validatable.
- **Per-repository activation:** packs are enabled in `agent-workflow.config.json`, not ad hoc per issue.
- **Executable support:** packs may include helper tools and validators.
- **Capability-aware:** packs can declare required skills and harness capabilities before work starts.
- **Role-pass compatible:** packs extend analyst, architect, implementer, reviewer, validator, and orchestrator expectations instead of replacing them.

## Repository configuration

`agent-workflow.config.json` is the canonical source for extension activation. Enabled pack entries are deterministic, slash-normalized paths relative to the adopting repository root:

```json
{
  "extensions": {
    "enabledPacks": ["extensions/my-engineering-approach"]
  }
}
```

Discovery is automatic; activation is explicit. `init`, `sync`, `doctor`, and the extension helper commands scan `extensions/` and `contrib/` every time they run, so a repo-local pack committed after initial setup is visible without rerunning `init`. Newly shipped framework packs may be discovered by `doctor`/`extensions list`, but they are not enabled unless `agent-workflow.config.json` is changed through review or the deterministic helper.

Run validation with:

```bash
node scripts/validate-extension-packs.mjs
node bin/cli.mjs extensions validate --target /path/to/project
```

If a pack declares executable validators, run them explicitly:

```bash
node scripts/validate-extension-packs.mjs --run-validators
node bin/cli.mjs extensions validate --target /path/to/project --run-validators
```

## Pack layout

```text
extensions/my-engineering-approach/
  extension-pack.yaml
  README.md
  principles.md
  templates/
  tools/
  validators/
```

Required files:

- `extension-pack.yaml` — machine-readable contract.
- `README.md` — contributor-facing usage and scope.

Recommended files:

- `principles.md` — the engineering approach in human terms.
- `templates/` — design notes, runbooks, PR additions, role-pass additions.
- `tools/` — helper commands used by agents or humans.
- `validators/` — deterministic checks.

## Manifest

```yaml
id: my-engineering-approach
kind: engineering-approach
version: 0.1.0
description: Opinionated engineering approach for this repository.
principles: principles.md
documentation:
  - README.md
requiredSkills:
  - context-mode
requiredCapabilities:
  - shell
  - read
  - edit
templates:
  - templates/design-note.md
tools:
  - path: tools/extract-pack.mjs
    description: Extract a candidate pack from an existing repository.
validators:
  - path: validators/check-required-sections.mjs
    command: node validators/check-required-sections.mjs
```

Supported `kind` values:

- `engineering-approach`
- `stack`
- `compliance`
- `runtime`
- `quality-gate`
- `workflow-overlay`

## Role-pass guardrails

A configured extension pack may add requirements to each role pass:

- **Analyst:** identify operational, architecture, local-development, production-reliability, and agent-ergonomics constraints.
- **Architect:** explain how the design follows the pack principles and list tradeoffs.
- **Implementer:** use pack templates/tools where applicable and record deviations.
- **Reviewer:** review pack compliance independently from ordinary code correctness.
- **Validator:** run pack validators or document why they are not applicable.
- **Orchestrator:** summarize pack evidence in the issue/PR workflow evidence.

Extensions must not hide execution-target provenance. Role-pass evidence still records launcher, executor, transport, delegation boundary, and review independence according to the core workflow.

## Built-in packs

This repository includes two stack-neutral packs that can be enabled by consuming projects:

- `extensions/evidence-driven-engineering` — ADRs, analysis guardrails, decision evidence, validation honesty, PR evidence, and follow-up discipline.
- `extensions/agent-handoff-governance` — handoff templates, provenance fields, delegation boundaries, review/implementation separation, human review requests, async resume points, and single-writer/multiple-reviewer coordination.

Enable both when a project wants the full evidence and handoff operating model:

```json
{
  "extensions": {
    "enabledPacks": [
      "extensions/evidence-driven-engineering",
      "extensions/agent-handoff-governance"
    ]
  }
}
```

## Helper commands

Use the main framework CLI in adopting projects:

```bash
node bin/cli.mjs extensions list --target /path/to/project
node bin/cli.mjs extensions inspect extensions/my-engineering-approach --target /path/to/project
node bin/cli.mjs extensions enable extensions/my-engineering-approach --target /path/to/project
node bin/cli.mjs extensions disable extensions/my-engineering-approach --target /path/to/project
node bin/cli.mjs extensions validate --target /path/to/project
```

`enable` and `disable` are idempotent and preserve unrelated `agent-workflow.config.json` fields while canonicalizing `extensions.enabledPacks`. Exact relative paths are preferred. Manifest `id` aliases are accepted only when unique; duplicate ids fail with candidate paths rather than guessing.

Repository-local development helpers remain available:

```bash
node scripts/extension-pack.mjs list
node scripts/extension-pack.mjs inspect extensions/my-engineering-approach
node scripts/extension-pack.mjs scaffold extensions/my-engineering-approach my-engineering-approach
```

Recommended adoption flow:

1. discover available packs;
2. inspect the pack contract;
3. enable deterministically;
4. validate;
5. commit `agent-workflow.config.json` and any repo-local packs;
6. later discover new repo-local or framework-shipped packs without automatic activation.

## Safety and review

Extension tools run with the same repository safety expectations as any other implementation tool. Do not use packs to bypass issue scope, PR review, high-assurance human gates, or protected branch rules. Pack validators should be deterministic, cross-platform Node scripts when possible.
