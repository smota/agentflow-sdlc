# Operator path

Operators diagnose installed state, provider availability, source connectivity, evidence health,
and optional Cockpit behavior.

```bash
agentflow-sdlc adopt plan --profile standard --target /path/to/project --json
agentflow-sdlc sdlc validate-authority --target /path/to/project --json
agentflow-sdlc providers list --json
agentflow-sdlc providers inspect <id> --json
agentflow-sdlc cockpit doctor --json
```

Use [troubleshooting](troubleshooting.md) for failure classes and
[upgrade and rollback](../adopters/upgrade-and-rollback.md) for transactional recovery. Cockpit is
optional; source and core validation remain usable when it is stopped or absent.
