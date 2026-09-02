# Codex adapter

Generated Codex adapters project AgentFlow SDLC skills into Codex-compatible skill/plugin surfaces.
The plugin namespace is `agentflow`; public skills are identified as `agentflow:<role>`.

Rules:

- Keep plugin metadata generated from canonical product payload.
- Do not install duplicate modes for one harness: choose skills-only, native-plugin, or cli-managed.
- Codex adapters delegate validation to `agentflow-sdlc` CLI commands.
- Portable lifecycle-role projections are generated under `.agentflow/roles/codex/`; role
  accountability remains independent from Codex runtime identity.
