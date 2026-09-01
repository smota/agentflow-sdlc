---
name: sdlc-migration
description: Migrate existing projects to AgentFlow SDLC with dry-run inventory, mapping, safe patch plans, and gated application.
---

# AgentFlow SDLC Migration

Canonical source: `skills/sdlc-migration/SKILL.md`.

Preserve role-pass v1 and legacy input aliases while migrating new output to canonical roles,
portable evidence contracts, and separate capability/permission/control namespaces.

Default to preview-first. Preserve existing project policy and harness settings. Run:

```bash
agentflow-sdlc sdlc migrate --json
agentflow-sdlc settings merge --harness all --dry-run --json
```

Apply only after explicit approval.
