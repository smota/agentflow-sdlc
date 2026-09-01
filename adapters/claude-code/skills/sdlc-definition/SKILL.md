---
name: sdlc-definition
description: Maintain AgentFlow SDLC definitions, paths, roles, gates, labels, release model, readiness, and harness-neutral compliance.
---

# AgentFlow SDLC Definition

Canonical source: `skills/sdlc-definition/SKILL.md`.

Use repository root `docs/sdlc-definition.md`, `sdlc.config.json` or `defaults/sdlc.config.json`,
`docs/agent-workflow.md`, `docs/evidence-contracts.md`, and `docs/lifecycle-boundaries.md`.

Emit canonical vocabulary, versioned portable evidence, and a non-widening action boundary. Keep
workflow capabilities, tool permissions, and controls distinct.

Run deterministic validation:

```bash
agentflow-sdlc sdlc validate --json
agentflow-sdlc sdlc run-evals --manifest agents/evals/manifests/framework-contracts.json --json
```

Do not create canonical product source under `.claude`, `.pi`, `.agy`, or `.codex`.
