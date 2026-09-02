# Operator path

Operators diagnose installed state, provider availability, source connectivity, evidence health,
and optional Cockpit behavior.

```bash
node bin/cli.mjs adopt plan --profile standard --target /path/to/project --json
node bin/cli.mjs sdlc validate-authority --target /path/to/project --json
node bin/cli.mjs providers list --json
node bin/cli.mjs providers inspect <id> --json
node bin/cli.mjs cockpit doctor --json
```

Use [troubleshooting](troubleshooting.md) for failure classes and
[upgrade and rollback](../adopters/upgrade-and-rollback.md) for transactional recovery. Cockpit is
optional; source and core validation remain usable when it is stopped or absent.
