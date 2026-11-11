# AgentFlow SDLC Rig

An autonomous, full-lifecycle engineering squad for parallel, independent software development in the repository given as its working directory. Governed by AgentFlow SDLC contracts, Four-Eyes independence, isolated Git Worktrees, proof-driven delivery, and Council deliberation for complex decisions.

This rig is optional. It is one harness binding for AgentFlow SDLC: it binds seats to roles and
carries handoffs between them. It does not define phases, gates, acceptance, or the product and
delivery seam. Those stay in [the SDLC definition](../../../docs/sdlc-definition.md) and
[the agent workflow](../../../docs/agent-workflow.md), and one agent with no rig follows the same
contract (see [ADR 004](../../../docs/adr/004-separate-sdlc-policy-from-harness-execution.md)).

---

## Execution policy and topology

The base has orchestration, building, QA, independent review and eval seats. Optional junior,
senior and test-engineering profiles do not create seats or task authority by themselves.
The canonical existing/expansion model, client, effort and two fallback options are in the pinned
execution distribution. Run `agentflow-sdlc distribution inspect --target <project> --json`.
See [execution distributions](../../../docs/execution-distributions.md) for policy changes,
upgrade preservation and temporary quota selection. Generated configurations select
`subscription-balanced-v1`; legacy presets remain compatibility options for unselected projects.

---

## Operating Instructions

OpenRig skills come from the managed loadout. Run `rig skill loadout --seat` to see which OpenRig skills this seat has, and `rig context get` to read one. AgentFlow skills stay in this adapter.

### Launching on a Project

Launch the squad attached to any project directory with `--cwd`:

```bash
# Inspect the selected distribution before launching
rig up agentflow --cwd <project-root>

# Inverted Codex lead preset
rig up agentflow --cwd <project-root> --preset inverted-codex-lead

# Dry run / inspection
rig up agentflow --cwd <project-root> --plan
```

### Inspecting Rig Status

```bash
rig ps --nodes --rig agentflow
```

### Freezing and Resuming

To switch focus between projects without losing agent state:

```bash
# Freeze session state with snapshot
rig down agentflow --snapshot

# Resume existing squad session
rig up agentflow --existing
```

---

## Governance Rules

- **Git Worktree Mandatory**: All code edits occur in `.worktrees/<branch-name>`. Never commit directly to `main` or root clone.
- **Four-Eyes Principle**: A builder never approves their own PR. Independent review from `rev.review` and verification from `dev.qa` are required.
- **Proof Before Code**: Proof contracts must be established before implementation begins.
- **Council Deliberation**: P2-P4 work is council or human-gated as the seat ladder below says.

---

## Seat ladder mapping

P0-P4 is this adapter's seat ladder. It is not AgentFlow vocabulary, and using it is optional. It
only chooses the collaboration class and the builder seat. The workflow profile, the phases, and
the person gates still come from AgentFlow, and a rung cannot skip or add a phase.

This table is the one home for the ladder. Rig culture, startup, and guidance files copy it; they
do not define their own.

| Rung  | Collaboration class | Builder seat                                    | Typical work                                                                                        |
| ----- | ------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P0    | `linear`            | `dev.build-jr`                                  | Bounded fixes, single-file or docs edits                                                            |
| P1    | `bilateral`         | `dev.build`                                     | Standard features and routine refactors                                                             |
| P2-P3 | `council`           | `dev.build-sr`                                  | Structural or cross-cutting changes; council of `orch.arch`, `rev.review`, `dev.build-sr`, `dev.qa` |
| P4    | `human-gated`       | chosen by `orch.arch` after the person confirms | Migrations, breaking contracts, security-critical changes                                           |

P0 normally runs at the `bounded` workflow profile and P1 at `standard`. For P2-P4, `orch.arch`
selects the workflow profile in phase 2 by AgentFlow's path rules; the rung does not set it.

---

## Workflow spec

`workflows/agentflow-delivery.workflow.yaml` runs phases 1-8 as an OpenRig workflow: one step per
phase, the seats from `manifests/seats.json`, one `failed` return per step, and a `cleanup` step.
It is generated, not edited. Regenerate with `node scripts/validate-openrig-workflow.mjs --write`.

`node scripts/validate-openrig-workflow.mjs` (CI) fails when the file differs from the generator, when
steps or seats disagree with `lib/core/phase-graph.mjs`, or when a seat owns both phase 4 and phase 6.
AgentFlow keeps the per-loop rework cap (`MAX_RETURN_CYCLES`). `loop_guards.max_hops` is the backstop
for the whole instance, and `unmapped_failed` goes to a person (`human_only`).

OpenRig 0.7.6 or later, with its daemon running, checks the spec itself:
`node scripts/validate-openrig-workflow.mjs --rig`. CI skips that sub-check when `rig` is missing.

---

## Seat authority

Claude tool rules for a member are `claude_permissions` with allow and deny lists in the rig spec, or `rig seat set-permissions <seat> --rules <file.json> --reason "<why>"` for an existing seat. OpenRig never writes those rules into the project's Claude settings.

Launch no longer rewrites `defaultMode` in `.claude/settings.local.json` to `acceptEdits`. OpenRig 0.7.1 stopped that rewrite and does not repair a file already changed. Seats do not wait for that rewrite.

A seat's own account home, when used, is an absolute `CLAUDE_CONFIG_DIR` or `CODEX_HOME` under the member's or the rig's `env:`. `rig up --env` does not apply those two variables.

Typing guard: `rig seat set-typing-guard <seat> --mode off|openrig-urgent|urgent-only|hold`. It is off until set, so automatic input still reaches an existing seat.

Terminal policy: `rig seat set-terminal-policy <seat> --preset no-peer-interventions|help-within-instructions|full-control`. Existing seats keep `full-control` until that command is used.

Hosted members stay off. The unqualified Claude API-key switch stays off.
