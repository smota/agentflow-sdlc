# Codex adapter

Generated Codex adapters project AgentFlow SDLC skills into Codex-compatible skill/plugin surfaces.

Rules:

- Keep plugin metadata generated from canonical product payload.
- Do not install duplicate modes for one harness: choose skills-only, native-plugin, or cli-managed.
- Codex adapters delegate validation to `agentflow-sdlc` CLI commands.
