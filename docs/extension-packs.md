# Extension Packs

Extension packs are repository-level overlays for the core multi-agent SDLC process. The core framework stays neutral: it owns phase order, issue/PR governance, role-pass evidence, execution-target attribution, and safety/review gates. A pack adds opinionated engineering guidance, tools, templates, required skills, harness capabilities, and validators without forking the process framework.

## Design goals

- **Complete from day one:** a configured pack must be documented, machine-readable, and validatable.
- **Per-repository activation:** packs are enabled in `agent-workflow.config.json`, not ad hoc per issue.
- **Executable support:** packs may include helper tools and validators.
- **Capability-aware:** packs can declare required skills and harness capabilities before work starts.
- **Role-pass compatible:** packs extend analyst, architect, implementer, reviewer, validator, and orchestrator expectations instead of replacing them.

## Repository configuration

```json
{
  "extensions": {
    "enabledPacks": ["extensions/my-engineering-approach"]
  }
}
```

Run validation with:

```bash
node scripts/validate-extension-packs.mjs
```

If a pack declares executable validators, run them too:

```bash
node scripts/validate-extension-packs.mjs --run-validators
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

## Helper commands

List discovered packs:

```bash
node scripts/extension-pack.mjs list
```

Inspect one pack:

```bash
node scripts/extension-pack.mjs inspect extensions/my-engineering-approach
```

Scaffold a pack:

```bash
node scripts/extension-pack.mjs scaffold extensions/my-engineering-approach my-engineering-approach
```

## Safety and review

Extension tools run with the same repository safety expectations as any other implementation tool. Do not use packs to bypass issue scope, PR review, high-assurance human gates, or protected branch rules. Pack validators should be deterministic, cross-platform Node scripts when possible.
