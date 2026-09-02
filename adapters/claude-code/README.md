# Claude Code adapter

Generated Claude Code adapters project AgentFlow SDLC skills into `.claude/skills/`.
The plugin namespace is `agentflow`; public skills are invoked as `agentflow:<role>`.

Rules:

- Canonical source remains under `skills/` and product docs/schemas.
- Canonical lifecycle roles remain under `roles/`; generated portable projections are written to
  `.agentflow/roles/claude-code/` and do not replace Claude Code's native configuration.
- Generated adapters instruct Claude to use deterministic `agentflow-sdlc sdlc ...` validators.
- `.claude` settings/skills are generated or harness-owned local artifacts, not source of truth.
- A noninteractive acceptance fixture must return canonical roles, action boundary, `ArtifactRef`,
  and transition-envelope JSON, then pass the deterministic evidence/lifecycle validators.
- Provenance is `platform: claude`, `executor: claude-cli`, `transport: local-cli` for local CLI runs.
