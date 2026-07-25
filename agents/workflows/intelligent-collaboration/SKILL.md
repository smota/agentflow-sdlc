---
name: intelligent-collaboration
description: Select and execute the smallest sufficient AgentFlow collaboration mode when harness intelligence can reduce SDLC uncertainty without increasing cognitive load.
---

# Intelligent collaboration

Use this workflow when a phase has meaningful uncertainty, broad discovery scope, review risk, or explicit user request for harness leverage.

## Essential rules

- Default to `auto-minimal` and prefer `single-agent` for routine work.
- Use helpers only when they reduce risk more than they add coordination cost.
- Keep helpers read-only unless using an explicit isolated `spike` worktree.
- Parent orchestrator owns synthesis and final evidence.
- Durable evidence is compact; raw helper output stays local by default.
- Never bypass role-pass, workflow-status, handover, PR manifest, validation, or human high-assurance gates.

## Workflow

1. Resolve the plan:

```bash
node scripts/resolve-collaboration-plan.mjs --issue <N> --profile <profile> --risk <risk> --effort <effort> --uncertainty <level> --change-surface <csv> --json
```

2. If mode is `single-agent`, continue normal AgentFlow orchestration.
3. If helpers are selected, create local artifacts under `.agent-runs/issues/<N>/collaboration/`.
4. Run only the selected bounded pattern from `references/collaboration-modes.md`.
5. Write parent synthesis using `templates/strategy-synthesis.md`.
6. Validate evidence when JSON evidence is produced:

```bash
node scripts/validate-collaboration-evidence.mjs --path <evidence.json>
```

7. Summarize mode, reason, helpers, synthesis, dissent, and validation in role-pass/PR evidence.

## Must not use when

- Low-risk work is clear and `single-agent` is sufficient.
- Required helper capability is unavailable.
- User asked for no delegation.
- Collaboration would expose secrets or private local data.
- The pattern would create multiple writers in one shared worktree.

## Supporting files

- `references/collaboration-modes.md`
- `references/bounded-environments.md`
- `references/harness-adapters.md`
- `templates/collaboration-plan.md`
- `templates/helper-evidence.json`
- `templates/strategy-synthesis.md`
- `checklists/evidence-audit.md`
- `checklists/subagent-guardrails.md`
- `examples/`
