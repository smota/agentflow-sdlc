# Intelligent collaboration flow

This example shows how AgentFlow can use extra AI intelligence without increasing visible workflow complexity.

## Scenario

Issue: standard-profile feature with architecture uncertainty.

## Plan

```json
{
  "collaborationMode": "advisory",
  "reason": "standard profile with architecture uncertainty; read-only scout reduces risk",
  "helpers": [{ "role": "risk-scout", "permissions": "read-only" }],
  "writer": "parent",
  "humanGate": false
}
```

## Human-visible evidence

```text
Mode: advisory. Reason: architecture uncertainty.
Helper: risk-scout, read-only.
Decision: choose Option B because it preserves existing API boundaries.
Critique disposition: accepted rollback note; deferred broader refactor to follow-up.
Validation: passed.
```

## Guardrails preserved

- Parent writes final SDD and owns synthesis.
- Helper remains read-only.
- Raw helper notes stay in `.agent-runs/`.
- PR manifest records only compact evidence.
