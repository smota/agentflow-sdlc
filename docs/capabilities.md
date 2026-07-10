# Advanced agent capabilities

`multi-agent-sdlc` is a reusable SDLC governance framework, not a single agent harness. Advanced features such as PLAN, WORKFLOW, LOOP, and SUB-AGENTS are therefore modeled as **portable capabilities**: a skill or workflow requests an intent, and the active execution target resolves that intent through a platform-specific adapter.

This keeps framework-owned skills portable across Claude, Codex, Agy, Pi, humans, and future executors while preserving the existing role, routing, evidence, GitHub issue, and PR contracts.

## Core rule

Do not hard-code a harness feature when a skill needs a portable behavior.

Instead of:

- “Use Claude subagents.”
- “Run the Pi workflow tool.”
- “Enter Plan Mode.”

Say:

- Request `delegated-subagents` with read-only reviewer constraints.
- Request `workflow-orchestration` for the SDLC phase sequence.
- Request `plan-before-edit` before implementation edits.

The adapter for the selected `executionTarget` decides whether the capability is native, package-backed, framework-emulated, manual, optional-unavailable, or required-unavailable.

## Capability resolution modes

| Mode                   | Meaning                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `native`               | The execution target has a first-class feature for the requested capability.                         |
| `package`              | A trusted plugin, package, MCP server, or local extension provides the capability.                   |
| `framework-emulated`   | The framework can produce equivalent governance with docs, role passes, scripts, and explicit gates. |
| `manual`               | A human performs or approves the capability.                                                         |
| `optional-unavailable` | The capability was requested as optional but is not available; continue with recorded fallback.      |
| `required-unavailable` | The capability is required but unavailable; stop and record the blocker.                             |

Resolution order is native, package, framework-emulated, manual, optional-unavailable, required-unavailable.

## Standard capabilities

### `plan-before-edit`

**Intent:** capture and approve the implementation approach before edits begin.

**Use when:** architect, developer-planning, or developer work could otherwise drift into unreviewed changes.

**Allowed implementations:**

- Native: a harness plan mode.
- Package: a workflow package that gates writes on a plan artifact.
- Framework-emulated: a role-pass or plan file created before edits and referenced in workflow evidence.
- Manual: human-approved plan comment or PR note.

**Required evidence:** plan artifact or summary, approval/gate status, whether edits were blocked until the plan existed.

### `workflow-orchestration`

**Intent:** run a multi-step recipe while keeping the framework phase model authoritative.

**Use when:** a skill coordinates phases, role passes, validation, handovers, or PR readiness.

**Allowed implementations:**

- Native: harness workflow primitive.
- Package: local workflow package or slash-command recipe.
- Framework-emulated: `docs/agent-workflow.md` phases plus issue/PR evidence.
- Manual: human-managed checklist using the same evidence contract.

**Required evidence:** workflow id/name, selected phase set, skipped phases with reasons, and how workflow output maps back to SDLC evidence.

### `bounded-loop`

**Intent:** repeat a controlled cycle until an explicit stop condition is met.

**Use when:** review/fix, test/fix, or clarify/plan cycles are useful.

**Required constraints:**

- maximum iteration count;
- explicit stop conditions;
- blocker handling;
- no looping for optional polish;
- no child agent decides the final loop outcome unless the parent workflow explicitly delegates that gate.

**Required evidence:** loop type, current/max iterations, stop conditions, exit reason, and remaining findings/follow-ups.

### `delegated-subagents`

**Intent:** delegate bounded work to another context or specialist while keeping accountability clear.

**Use when:** broad discovery, read-only review, isolated research, or controlled handoff adds value.

**Required constraints:**

- single-writer rule for a shared worktree;
- read-only by default for review/research delegates;
- launcher, executor, transport, delegation boundary, context boundary, and independence boundary recorded distinctly;
- no claim of independent multi-agent review unless the role attribution evidence supports it.

**Required evidence:** delegated task, executor, transport, boundaries, tool/write permissions, result artifact, and parent synthesis.

## Evidence example

```json
{
  "capabilitiesUsed": [
    {
      "name": "plan-before-edit",
      "requested": true,
      "required": true,
      "mode": "framework-emulated",
      "adapter": "generic-framework",
      "artifact": ".agent-runs/issues/123/passes/03-developer-planning.md",
      "status": "satisfied"
    },
    {
      "name": "delegated-subagents",
      "requested": true,
      "required": false,
      "mode": "optional-unavailable",
      "adapter": "codex-cli",
      "reason": "no configured independent subagent transport",
      "status": "skipped"
    }
  ]
}
```

## Relationship to existing framework concepts

| Concept          | Answers                                      | Example                                  |
| ---------------- | -------------------------------------------- | ---------------------------------------- |
| Role             | What SDLC responsibility is being performed? | `developer`, `review`, `tester`          |
| Agent slug       | Who is requested?                            | `claude`, `codex`, `agy`, `pi`, `human`  |
| Execution target | How that agent runs?                         | `claude-cli`, `codex-cli`, `pi-subagent` |
| Capability       | What advanced behavior is requested?         | `plan-before-edit`, `bounded-loop`       |

Capabilities never replace role-pass evidence, issue comments, PR manifests, execution-target resolution, or follow-up issue discipline.

## False-claim guardrails

- A provider model id such as `anthropic/claude-*` is not the same thing as `claude-cli`.
- A same-context self-review is not independent multi-agent review.
- A prose plan after edits is not `plan-before-edit`.
- An unbounded retry cycle is not `bounded-loop`.
- A helper process without recorded boundaries is not sufficient evidence for `delegated-subagents`.
