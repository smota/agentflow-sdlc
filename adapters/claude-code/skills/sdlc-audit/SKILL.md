---
name: sdlc-audit
description: Audit AgentFlow SDLC compliance for project, issue, PR, release, role-pass, agent, skill, plugins, settings, and release packaging.
---

# AgentFlow SDLC Audit

Canonical source: `skills/sdlc-audit/SKILL.md`.

Use deterministic commands first:

```bash
agentflow-sdlc sdlc audit --json
agentflow-sdlc plugins validate --harness all --json
agentflow-sdlc settings validate --harness all --json
node scripts/validate-npm-package.mjs --json
```

Read-only unless explicitly asked to remediate.
