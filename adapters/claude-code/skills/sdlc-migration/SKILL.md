---
name: sdlc-migration
description: Migrate existing projects to AgentFlow SDLC with dry-run inventory, mapping, safe patch plans, and gated application.
---

# AgentFlow SDLC Migration

Canonical source: `skills/sdlc-migration/SKILL.md`.

Default to preview-first. Preserve existing project policy and harness settings. Run:

```bash
agentflow-sdlc sdlc migrate --json
agentflow-sdlc settings merge --harness all --dry-run --json
```

Apply only after explicit approval.
