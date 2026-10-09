# AgentFlow SDLC Rig

An autonomous, full-lifecycle engineering squad for parallel, independent software development in the repository given as its working directory. Governed by AgentFlow SDLC contracts, Four-Eyes independence, isolated Git Worktrees, proof-driven delivery, and Council deliberation for complex decisions.

This rig is optional. It is one harness binding for AgentFlow SDLC: it binds seats to roles and
carries handoffs between them. It does not define phases, gates, acceptance, or the product and
delivery seam. Those stay in [the SDLC definition](../../../docs/sdlc-definition.md) and
[the agent workflow](../../../docs/agent-workflow.md), and one agent with no rig follows the same
contract (see [ADR 004](../../../docs/adr/004-separate-sdlc-policy-from-harness-execution.md)).

---

## Squad Topology

| Pod    | Seat       | Role                | Default Runtime    | Default Model       | Responsibility                                                                                |
| ------ | ---------- | ------------------- | ------------------ | ------------------- | --------------------------------------------------------------------------------------------- |
| `orch` | `arch`     | Architect Lead      | `pi` (Grok bridge) | `grok-cli/grok-4.7` | Goal intake, task decomposition, complexity rating (P0-P4), proof contracts, Council convener |
| `dev`  | `build-jr` | Junior Builder      | `claude-code`      | Claude              | Linear bug fixes, minor tasks, single-file edits (P0)                                         |
| `dev`  | `build`    | Standard Builder    | `claude-code`      | Claude              | Feature delivery, subsystem extensions, bilateral workflows (P1)                              |
| `dev`  | `build-sr` | Senior Builder      | `claude-code`      | Claude              | Core refactorings, multi-module architecture, Council participant (P2-P3)                     |
| `dev`  | `qa`       | QA & Verification   | `codex`            | Codex               | Test matrix execution, regression proof verification, edge cases                              |
| `rev`  | `review`   | Independent Auditor | `pi` (Grok bridge) | `grok-cli/grok-4.7` | Four-Eyes review, digest-bound verdicts, risk audits, Council peer                            |

---

## Configurations & Presets

The rig declares 8 runtime configuration presets to accommodate provider availability and preference:

1. **`balanced-grok-lead`** _(Recommended)_:
   - `orch.arch`: `pi` (`grok-4.7`)
   - `dev.build-jr`: `claude-code`
   - `dev.build`: `claude-code`
   - `dev.build-sr`: `claude-code`
   - `dev.qa`: `codex`
   - `rev.review`: `pi` (`grok-4.7`)

2. **`inverted-codex-lead`**:
   - `orch.arch`: `codex`
   - Builders (`build-jr`, `build`, `build-sr`): `codex`
   - `dev.qa`: `claude-code`
   - `rev.review`: `pi` (`grok-4.7`)

3. **`grok-heavy`**:
   - `orch.arch`: `pi` (`grok-4.7`)
   - Builders: `pi` (`grok-4.7`)
   - `dev.qa`: `codex`
   - `rev.review`: `pi` (`grok-4.7`)

4. **`claude-heavy`**:
   - `orch.arch`: `claude-code`
   - Builders: `claude-code`
   - `dev.qa`: `codex`
   - `rev.review`: `claude-code`

5. **`codex-heavy`**:
   - `orch.arch`: `codex`
   - Builders: `codex`
   - `dev.qa`: `codex`
   - `rev.review`: `codex`

6. **`all-grok`**:
   - All 6 seats run on `pi` (`grok-4.7`).

7. **`all-claude`**:
   - All 6 seats run on `claude-code`.

8. **`all-codex`**:
   - All 6 seats run on `codex`.

---

## Operating Instructions

### Launching on a Project

Launch the squad attached to any project directory with `--cwd`:

```bash
# Recommended preset (balanced-grok-lead)
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
