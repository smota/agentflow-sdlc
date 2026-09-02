# AGY adapter

Generated AGY adapters project AgentFlow SDLC skills into skill-compatible local adapter surfaces.
The shared namespace is `agentflow`; public skills are identified as `agentflow:<role>`.

Rules:

- Use Windows-safe generated files, not symlinks.
- The AGY-facing skill must run deterministic CLI validators and interpret JSON results.
- `.agy` or AGY plugin folders are generated adapter surfaces only.
- A noninteractive acceptance fixture must return canonical roles, action boundary, `ArtifactRef`,
  and transition-envelope JSON, then pass the deterministic evidence/lifecycle validators.
- Provenance is `platform: agy`, `executor: agy-cli`, `transport: local-cli` for local CLI runs.
- Antigravity is a separate runtime identity even if a harness shares a compatible destination.
- Portable lifecycle-role projections are generated under `.agentflow/roles/agy/`.
