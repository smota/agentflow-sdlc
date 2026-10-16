# Operator path

Operators diagnose installed state, provider availability, source connectivity, evidence health,
and optional Cockpit behavior.

For OpenRig, preview [execution contracts](openrig-execution-contracts.md) before changing a squad.
Use the [verified mutation contract](openrig-mutations.md) for source-authorized changes and compensating rollback.

```bash
agentflow-sdlc onboarding verify --target /path/to/project --json
agentflow-sdlc sdlc validate-authority --target /path/to/project --json
agentflow-sdlc providers list --json
agentflow-sdlc providers inspect <id> --json
agentflow-sdlc cockpit doctor --json
```

Use [troubleshooting](troubleshooting.md) for failure classes and
[upgrade and rollback](../adopters/upgrade-and-rollback.md) for transactional recovery. Cockpit is
optional; source and core validation remain usable when it is stopped or absent.

For the dated Dendro and AgentFlow incident adoption preparation, see
[the held Dendro preview](adoption-516/dendro-preview.md).

AgentFlow uses the same [source and installed adoption boundary](adoption-516/agentflow-preview.md).
