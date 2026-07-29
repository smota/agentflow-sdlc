# Claude Code adapter

Generated Claude Code adapters project AgentFlow SDLC skills into `.claude/skills/`.

Rules:

- Canonical source remains under `skills/` and product docs/schemas.
- Generated adapters instruct Claude to use deterministic `agentflow-sdlc sdlc ...` validators.
- `.claude` settings/skills are generated or harness-owned local artifacts, not source of truth.
