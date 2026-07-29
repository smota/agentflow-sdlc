---
name: sdlc-definition
description: Maintain AgentFlow SDLC definitions, paths, roles, gates, labels, release model, readiness, and harness-neutral compliance.
---

# AgentFlow SDLC Definition

Canonical source: `skills/sdlc-definition/SKILL.md`.

Use repository root `docs/sdlc-definition.md`, `sdlc.config.json` or `defaults/sdlc.config.json`, `docs/agent-workflow.md`, and `docs/issue-standards.md`.

Run deterministic validation:

```bash
agentflow-sdlc sdlc validate --json
```

Do not create canonical product source under `.claude`, `.pi`, `.agy`, or `.codex`.
