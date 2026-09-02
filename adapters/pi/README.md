# Pi adapter

Generated Pi adapters project AgentFlow SDLC skills into `.pi/skills/` or future Pi package surfaces.
The shared namespace is `agentflow`; public skills are identified as `agentflow:<role>`.

Rules:

- `.pi` is not canonical product source.
- Pi adapter copies are generated from harness-neutral `skills/` sources.
- Pi workflows must record launcher/executor/transport/delegation boundary like every other harness.
- Portable lifecycle-role projections are generated under `.agentflow/roles/pi/`.
