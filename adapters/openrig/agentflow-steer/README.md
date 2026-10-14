# AgentFlow Supervisory Steering Rig (`agentflow-steer`)

This base specification provisions the **External Supervisory Steering Plane** for AgentFlow SDLC projects.

## Overview

The steering rig hosts the executive supervisor (`steer.lead`), responsible for:

- Framing and decomposing customer goals into vertical capabilities.
- Ordering macro dependency DAGs across project workstreams.
- Unfreezing deadlocked worktrees via sealed `unfreeze-resolution` records.
- Triage of minor findings via pragmatic defect triage (`accept_and_register`).
- Performing merge checks before triggering squashed integrations.

## Core Architectural Invariants

1. **Two-Plane Separation**: The steering rig operates out-of-rig from above execution topologies.
2. **Out-of-Worktree**: The seat executes in the primary repository clone root (`cwd: '.'`), never inside `.worktrees/*`.
3. **Read-Only Code Boundary**: The steering seat has zero write permissions to code, libraries, tests, or documentation. Writes and git commits are mechanically blocked by `steer-write-guard` and `steer-guard.mjs`.
4. **Target Routing**: Communicates exclusively with `pm.manager` (product squad) and `orch.arch` (delivery squad). Never communicates directly with builders (`dev.build*`) or testers (`dev.qa`, `dev.test-eng`).

## Structure

```
adapters/openrig/agentflow-steer/
├── rig.yaml                 # Base rig specification (pod: steer, seat: lead)
├── CULTURE.md               # The 10 steering laws and operational principles
├── README.md                # Overview and architectural invariants
├── configurations.yaml      # Declared runtime presets (claude-lead, codex-lead, pi-lead)
├── steer-guard.mjs          # Runtime safety guard preventing writes and violations
├── policies/
│   └── steer.yaml           # Non-yolo permission policy
├── startup/
│   ├── context.md           # Rig-wide startup context
│   └── lead.md              # Seat orientation checklist
└── agents/
    └── agentflow-steer/
        ├── agent.yaml       # Agent definition (excludes orchestrator/builders)
        ├── guidance/
        │   └── lead.md      # Negative prompt tests and deflection guidance
        └── runtime/
            ├── steer-guard.claude.json  # PreToolUse hook for Claude Code
            └── steer-guard.codex.toml   # PreToolUse hook for Codex
```
