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
