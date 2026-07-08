# Execution targets

An agent slug (`agy`, `codex`, `claude`, `pi`) names **who** is being asked to do work. It does not
say **how** that work runs. This document makes the "how" explicit so a bare mention such as `with
claude`, `with agy`, or `with pi` cannot silently resolve to the wrong runtime, transport, provider,
or delegation boundary. `lib/execution-targets.mjs` implements the vocabulary and resolution rule
defined here; `lib/role-routing.mjs` and `scripts/resolve-role-route.mjs` apply it to role routing.

## Why this exists

During issue #52 orchestration, `with claude` was ambiguous in two different ways in the same run:

- A multi-agent chain intended as Claude-mode inherited the launching agent's current provider model
  (`openai-codex/gpt-5.5`) because no per-step execution target was recorded.
- A later reviewer step explicitly used `model: anthropic/claude-sonnet-4`. That model identifier
  routed through the Anthropic Messages API (`anthropic-messages` transport) instead of the local
  Claude CLI, and failed with `404 not_found_error` because the local environment has no configured
  Anthropic API/model access.

**`model: anthropic/claude-*` is not Claude CLI.** Naming a brand's model does not launch that
brand's local agent CLI — it routes through that brand's provider API unless the configured
transport explicitly says otherwise. The same rule holds for any `<brand>/<model>` identifier: it
names a provider-backed call, not a local CLI launch.

## Core concepts

- **Agent slug** — which agent is being asked to work: `agy`, `codex`, `claude`, `pi`, or `human`.
  See `docs/agent-routing.md` for the supported slugs.
- **`executionTarget`** — the specific runtime/API surface used to do the work for that agent slug.
  See the table below.
- **`executor`** — the agent/runtime actually doing the work right now. In practice this is the
  resolved `executionTarget` (for example `claude-cli`, `anthropic-api`, `pi-subagent`) — never
  copied from the launcher or from a prior pass.
- **`launcher`** — the agent/runtime that initiated the work. May be the same as the executor
  (single-agent execution) or a different agent (one agent launching/handing off to another).
- **`transport`** — the mechanism used to reach the executor: `local-cli`, `provider-api`,
  `pi-subagent`, `intercom-session`, `orchestrated-worktree`, or `manual`.
- **`delegationBoundary`** — where the work happens relative to the launcher: `current-session`,
  `child-subagent`, `separate-local-session`, `child-worktree`, or `human-handoff`.
- **`model`** — the actual model identifier when known, for example `claude-sonnet-4-20250514` or
  `openai-codex/gpt-5.5`. Recorded separately from `executionTarget` — the execution target says how
  the call was launched, the model says what generated the output.

## Execution targets by agent

| Agent slug | Execution target    | Meaning                                                                                                              | Transport               | Default delegation boundary |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------- |
| `claude`   | `claude-cli`        | Local Claude Code/CLI execution. Does not require an Anthropic API subscription.                                     | `local-cli`             | `current-session`           |
| `claude`   | `anthropic-api`     | Anthropic Messages API execution. Requires configured API credentials and model access.                              | `provider-api`          | `current-session`           |
| `agy`      | `agy-cli`           | Local Agy CLI/runtime execution, when available.                                                                     | `local-cli`             | `current-session`           |
| `agy`      | `agy-session`       | Agy-owned session/worktree, or an external agent session reached through a documented handoff mechanism.             | `orchestrated-worktree` | `child-worktree`            |
| `pi`       | `pi-parent`         | The current Pi session acting as orchestrator/decision-maker.                                                        | `local-cli`             | `current-session`           |
| `pi`       | `pi-subagent`       | A child launched through Pi's subagent runtime.                                                                      | `pi-subagent`           | `child-subagent`            |
| `pi`       | `pi-session`        | A separate Pi session reached through intercom/control-socket style coordination.                                    | `intercom-session`      | `separate-local-session`    |
| `pi`       | `pi-subagent-model` | Pi subagent execution using Pi's configured model provider, e.g. `openai-codex/gpt-5.5`.                             | `provider-api`          | `child-subagent`            |
| `codex`    | `codex-cli`         | Local Codex CLI execution, typically `codex exec` unless configured otherwise.                                       | `local-cli`             | `current-session`           |
| `codex`    | `provider-api`      | Any provider-backed model call, distinct from local CLI execution even when the model brand matches the agent brand. | `provider-api`          | `current-session`           |
| `human`    | `human`             | A human performs the work directly.                                                                                  | `manual`                | `human-handoff`             |

`lib/execution-targets.mjs` exports this table as `EXECUTION_TARGETS_BY_AGENT`,
`EXECUTION_TARGET_TRANSPORT`, and `EXECUTION_TARGET_DELEGATION_BOUNDARY`. Treat that module as the
source of truth if this table and the code ever disagree.

The delegation boundary column is a **default**, not a fixed property of the target. A launcher must
override it when the actual mechanism differs — for example, `codex` spawning `claude-cli` into a
fresh worktree is `child-worktree`, not `current-session`, even though `claude-cli`'s default is
`current-session` for a self-launched run.

## Resolving ambiguous requests

Ambiguous requests such as `with claude`, `with agy`, or `with pi` — a bare agent-brand mention with
no execution target — must resolve deterministically before work launches, never by inheriting the
launcher's current model or provider:

1. If `agent-workflow.config.json` sets `routing.agents.<slug>.defaultExecutionTarget`, use it. This
   is the normal path for a project that has made its intent explicit once, in config, rather than
   depending on chat context every time.
2. Otherwise, if the agent is resolving a bare mention of **itself** (the current executor asking
   what "claude" means when it _is_ Claude), it defaults to that agent's built-in local-CLI target
   (`claude-cli`, `agy-cli`, `codex-cli`, or `pi-parent`).
3. Otherwise — a different agent asking to launch/hand off to a bare-mentioned agent, with no
   configured default — the request is ambiguous. Ask a clarifying question before launching work.
   Do not guess, and do not silently reuse the launcher's own model/provider for the target agent.

A model/provider identifier (for example `anthropic/claude-sonnet-4`, `openai-codex/gpt-5.5`, or a
raw model id like `claude-sonnet-4-20250514`) is **not** a bare agent mention. It resolves to that
agent's provider-backed execution target (`anthropic-api`, `provider-api`, or `pi-subagent-model`)
and must be recorded as such — never reported as if the target's local CLI ran.

`lib/execution-targets.mjs#resolveExecutionTarget()` implements this resolution order and is the
function `scripts/resolve-execution-target.mjs` wraps for CLI/preflight use.

## Preflight validation

Run this before launching a routed role or handing work to another agent when the target is not
already an explicit, known `executionTarget`:

```bash
node scripts/resolve-execution-target.mjs --agent claude --requested "with claude" --current-agent pi --json
node scripts/resolve-execution-target.mjs --agent claude --requested "anthropic/claude-sonnet-4" --json
node scripts/resolve-execution-target.mjs --agent pi --requested "openai-codex/gpt-5.5" --current-agent pi --json
```

The command exits `0` with a resolved `executionTarget`/`transport`/`delegationBoundary` when the
request is deterministic, and exits non-zero with `requiresClarification: true` when it is not —
catching an unavailable or ambiguous Claude CLI/API/model, Agy CLI/session, or Pi
subagent/session/model request before a long-running orchestration starts.

Role-level routing already resolves an `executionTarget` for the selected agent as part of
`node scripts/resolve-role-route.mjs --role <role> --current <agent> --json` — see
`docs/agent-routing.md`. Use `resolve-execution-target.mjs` for the additional case this issue
targets: a free-text or chat-level mention (`with claude`, a raw model id) that route resolution
alone does not disambiguate.

## Workflow evidence

Record `launcher`, `executor` (i.e. the resolved `executionTarget`), `transport`,
`delegationBoundary`, and `model` as distinct fields in role-passes, workflow-status comments,
handover comments, and PR manifests — see `docs/agent-workflow.md` §4 and the corresponding
templates under `agents/templates/`. Do not collapse them into a single freeform field; if a project
genuinely cannot distinguish two of these fields for a given evidence surface, it must record a
deterministic reason why, not silently drop one.

These fields answer _how_ a single pass ran. They do not say whether a run's SDLC roles actually
alternated across independent intelligences, or whether a `multi-agent` claim is backed by more
than one role intelligence — that is `contextBoundary`, `independenceBoundary`, and the
`roleAttributionMatrix` from [`agent-workflow.md` §4a](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode).
`contextBoundary` is derived from `transport` + `delegationBoundary`
(`lib/role-attribution.mjs#deriveContextBoundary`) rather than recorded as a separate fact, so the
two vocabularies cannot drift apart.

## Per-agent routing docs

Each agent-specific routing guide distinguishes its execution targets:

- `docs/agents/claude-routing.md` — `claude-cli` vs `anthropic-api`
- `docs/agents/agy-routing.md` — `agy-cli` vs `agy-session`
- `docs/agents/pi-routing.md` — `pi-parent`, `pi-subagent`, `pi-session`, `pi-subagent-model`
- `docs/agents/codex-routing.md` — `codex-cli` vs `provider-api`
