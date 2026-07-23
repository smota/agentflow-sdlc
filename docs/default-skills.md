# Default skills and upstream sources

This page documents the default and recommended skills/workflows used with **AgentFlow SDLC**, where they come from, and how consuming projects should track local changes. Skills are local workflow capabilities: they make agent behavior repeatable, but they do not replace `AGENTS.md`, `docs/agent-workflow.md`, issue comments, commits, PR bodies, or validators as durable evidence.

Skills should request portable advanced capabilities such as `plan-before-edit`, `workflow-orchestration`, `bounded-loop`, and `delegated-subagents` instead of hard-coding platform-specific mechanisms such as Claude subagents, Codex profiles, or Pi package commands. See [`capabilities.md`](capabilities.md) for the capability vocabulary and resolver model.

Skills should request portable advanced capabilities such as `plan-before-edit`, `workflow-orchestration`, `bounded-loop`, and `delegated-subagents` instead of hard-coding platform-specific mechanisms such as Claude subagents, Codex profiles, or Pi package commands. See [`capabilities.md`](capabilities.md) for the capability vocabulary and resolver model.

Skills should request portable advanced capabilities such as `plan-before-edit`, `workflow-orchestration`, `bounded-loop`, and `delegated-subagents` instead of hard-coding platform-specific mechanisms such as Claude subagents, Codex profiles, or Pi package commands. See [`capabilities.md`](capabilities.md) for the capability vocabulary and resolver model.

## Why provenance matters

Documenting skills makes agent-assisted work easier to audit:

- maintainers can see which local capabilities are expected before work starts;
- reviewers can trace a workflow back to its upstream repository or website;
- project-specific overrides are explicit instead of hidden in one agent's local setup;
- compliance-minded teams can explain why a single-agent or optional multi-agent workflow used a given skill.

## Framework-owned skills

| Skill / workflow | Purpose                                                                                         | When to use                                                                                   | Local source                                                                        | Upstream repository                       | Website / docs                                |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| `orchestrate`    | Run one issue through the role-based SDLC phases, create evidence, commit, push, and open a PR. | Issue implementation, chores, fixes, and workstreams that need the formal role-pass workflow. | [`agents/workflows/orchestrate/SKILL.md`](../agents/workflows/orchestrate/SKILL.md) | <https://github.com/smota/agentflow-sdlc> | [`docs/agent-workflow.md`](agent-workflow.md) |
| `scan`           | Perform broad-context scans that feed planning, review, or security evidence.                   | Architecture, security, risk, or cross-cutting discovery before implementation or review.     | [`agents/workflows/scan/SKILL.md`](../agents/workflows/scan/SKILL.md)               | <https://github.com/smota/agentflow-sdlc> | [`docs/index.md`](index.md)                   |

## Capability-aware skill authoring

Framework-owned skills should describe advanced behavior as capability requirements:

```yaml
capabilities:
  requires:
    - plan-before-edit
  optional:
    - workflow-orchestration
    - bounded-loop
    - delegated-subagents
fallbacks:
  plan-before-edit: framework-emulated
  delegated-subagents: inline-parent-work
```

Use the skill body to state constraints and evidence, for example:

- PLAN: write or cite the plan artifact before edits.
- WORKFLOW: map any native/package workflow back to the SDLC phase model.
- LOOP: set max iterations and stop conditions.
- SUB-AGENTS: default reviewers/researchers to read-only, keep one writer per worktree, and record launcher/executor/transport/delegation/context/independence boundaries.

A skill may be intentionally platform-specific, but it must say so explicitly in its description and should still record capability evidence in role passes and PR manifests.

## Capability-aware skill authoring

Framework-owned skills should describe advanced behavior as capability requirements:

```yaml
capabilities:
  requires:
    - plan-before-edit
  optional:
    - workflow-orchestration
    - bounded-loop
    - delegated-subagents
fallbacks:
  plan-before-edit: framework-emulated
  delegated-subagents: inline-parent-work
```

Use the skill body to state constraints and evidence, for example:

- PLAN: write or cite the plan artifact before edits.
- WORKFLOW: map any native/package workflow back to the SDLC phase model.
- LOOP: set max iterations and stop conditions.
- SUB-AGENTS: default reviewers/researchers to read-only, keep one writer per worktree, and record launcher/executor/transport/delegation/context/independence boundaries.

A skill may be intentionally platform-specific, but it must say so explicitly in its description and should still record capability evidence in role passes and PR manifests.

## Capability-aware skill authoring

Framework-owned skills should describe advanced behavior as capability requirements:

```yaml
capabilities:
  requires:
    - plan-before-edit
  optional:
    - workflow-orchestration
    - bounded-loop
    - delegated-subagents
fallbacks:
  plan-before-edit: framework-emulated
  delegated-subagents: inline-parent-work
```

Use the skill body to state constraints and evidence, for example:

- PLAN: write or cite the plan artifact before edits.
- WORKFLOW: map any native/package workflow back to the SDLC phase model.
- LOOP: set max iterations and stop conditions.
- SUB-AGENTS: default reviewers/researchers to read-only, keep one writer per worktree, and record launcher/executor/transport/delegation/context/independence boundaries.

A skill may be intentionally platform-specific, but it must say so explicitly in its description and should still record capability evidence in role passes and PR manifests.

## Recommended companion skills/tooling

These are not vendored by this repository, but they are common local companions for teams that use this framework.

| Skill / tool           | Purpose                                                                                          | Upstream repository                       | Website / docs                                               | Notes                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `ccpm`                 | Spec-driven project management using PRDs, epics, GitHub Issues, worktrees, and agent execution. | <https://github.com/automazeio/ccpm>      | <https://github.com/automazeio/ccpm>                         | Useful reference source for issue/epic management patterns.                            |
| Agent CLI routing docs | Explain how `agy`, `codex`, `claude`, and `pi` hand work off when project routing selects them.  | <https://github.com/smota/agentflow-sdlc> | [`docs/agent-routing.md`](agent-routing.md)                  | Project-configured; validate with `node scripts/validate-role-routing.mjs`.            |
| Vibium                 | Default browser QA skill/tool for optional `qa-expert` exploratory sessions.                     | <https://github.com/VibiumDev/vibium>     | <https://vibium.com>                                         | Opinionated default for `qa-expert`; projects may override with a documented QA stack. |
| Project sync CLI       | Installs and syncs hooks, docs, validators, templates, and seed-once files.                      | <https://github.com/smota/agentflow-sdlc> | [`README.md`](../README.md#install--initialize-in-a-project) | Run `node bin/cli.mjs init`, `sync`, `doctor`, or `mark-merged`.                       |

## Original CCPM-sourced skill surfaces

The upstream CCPM repository publishes one `ccpm` skill with phase references and deterministic scripts under [`skill/ccpm`](https://github.com/automazeio/ccpm/tree/main/skill/ccpm). When this framework or a consuming project borrows CCPM-style workflow ideas, keep the original source visible. The table below names nine CCPM-sourced skill surfaces that are useful to document in project setup notes.

| CCPM-sourced surface | What it covers                                                                         | Original source                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Plan                 | Capture a feature idea as a PRD and refine requirements.                               | [`references/plan.md`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/plan.md)                       |
| Structure            | Break an epic into concrete tasks with dependencies and parallelization.               | [`references/structure.md`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/structure.md)             |
| Sync                 | Push local PRDs/epics/tasks to GitHub and sync progress comments.                      | [`references/sync.md`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/sync.md)                       |
| Execute              | Start issue work, analyze parallel streams, and coordinate worktrees.                  | [`references/execute.md`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/execute.md)                 |
| Track                | Check status, standups, search, in-progress work, next work, blockers, and validation. | [`references/track.md`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/track.md)                     |
| Status               | Report project status deterministically.                                               | [`references/scripts/status.sh`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/scripts/status.sh)   |
| Standup              | Produce a standup report.                                                              | [`references/scripts/standup.sh`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/scripts/standup.sh) |
| Next                 | Identify the next priority item.                                                       | [`references/scripts/next.sh`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/scripts/next.sh)       |
| Blocked              | Identify blocked work.                                                                 | [`references/scripts/blocked.sh`](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/scripts/blocked.sh) |

Do not imply these nine surfaces are vendored by `agentflow-sdlc` unless a consuming project actually installs or copies them. Treat them as CCPM-sourced references and record any local adoption in project documentation.

## Local management checklist

When adding, removing, or overriding a skill in a consuming project:

1. Record the skill name, purpose, upstream repository, and website/docs link.
2. Note where it is installed locally for each supported agent CLI.
3. State whether it is required, recommended, or optional.
4. Update `agent-workflow.config.json` if the skill changes role routing or availability.
5. Update `AGENTS.md` or `docs/stack-conventions.md` when the skill changes project policy.
6. Open a follow-up issue instead of leaving hidden TODOs when provenance or setup is incomplete.
