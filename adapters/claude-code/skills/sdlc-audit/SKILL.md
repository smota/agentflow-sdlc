---
name: sdlc-audit
description: Audit AgentFlow SDLC compliance for project, issue, PR, release, role-pass, agent, skill, plugins, settings, and release packaging.
---

# AgentFlow SDLC Audit

Canonical source: `skills/sdlc-audit/SKILL.md`.

Audit canonical vocabulary, portable source authority, transition validity, action-boundary
non-escalation, requirement namespaces, eval provenance, and derived-only outcome metrics.

Use deterministic commands first:

```bash
agentflow-sdlc sdlc audit --json
agentflow-sdlc plugins validate --harness all --json
agentflow-sdlc settings validate --harness all --json
node scripts/validate-npm-package.mjs --json
```

Read-only unless explicitly asked to remediate.
