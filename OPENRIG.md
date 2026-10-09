# OpenRig Harness Integration

AgentFlow SDLC provides first-class support for [OpenRig](https://openrig.dev/), organizing AI coding agents into an autonomous, full-lifecycle engineering squad with proof-contract governance, Four-Eyes independence, isolated Git Worktrees, and Council deliberation for complex changes.

---

## Rig Topology (`agentflow`)

| Pod    | Seat       | Role                | Default Runtime    | Default Model       | Responsibility                                                                                |
| ------ | ---------- | ------------------- | ------------------ | ------------------- | --------------------------------------------------------------------------------------------- |
| `orch` | `arch`     | Architect Lead      | `pi` (Grok bridge) | `grok-cli/grok-4.7` | Goal intake, task decomposition, complexity rating (P0-P4), proof contracts, Council convener |
| `dev`  | `build-jr` | Junior Builder      | `claude-code`      | Claude              | Linear bug fixes, minor tasks, single-file edits (P0)                                         |
| `dev`  | `build`    | Standard Builder    | `claude-code`      | Claude              | Feature delivery, subsystem extensions, bilateral workflows (P1)                              |
| `dev`  | `build-sr` | Senior Builder      | `claude-code`      | Claude              | Core refactorings, multi-module architecture, Council participant (P2-P3)                     |
| `dev`  | `qa`       | QA & Verification   | `codex`            | Codex               | Test matrix execution, regression proof verification, edge cases                              |
| `rev`  | `review`   | Independent Auditor | `pi` (Grok bridge) | `grok-cli/grok-4.7` | Four-Eyes review, digest-bound verdicts, risk audits, Council peer                            |

---

## Configuration Presets

OpenRig bundle configuration schema: `openrig.bundle-configurations/v1`:

- `balanced-grok-lead` _(Recommended)_: Grok 4.7 Lead/Review + Claude Builders + Codex QA
- `inverted-codex-lead`: Codex Lead/Builders + Claude QA + Grok 4.7 Review
- `grok-heavy`: Grok 4.7 Lead/Review/Builders + Codex QA
- `claude-heavy`: Claude Lead/Review/Builders + Codex QA
- `codex-heavy`: Codex Lead/Review/Builders/QA
- `all-grok`: All 6 seats on Grok 4.7 via Pi
- `all-claude`: All 6 seats on Claude Code
- `all-codex`: All 6 seats on Codex

---

## Quick Start & Recovery

All rig assets are maintained in [`adapters/openrig/agentflow/`](adapters/openrig/agentflow/).

To install or recover the canonical rig into your OpenRig user library:

```bash
./adapters/openrig/scripts/install-rig.sh
```

### Context Switching Mode (Single Squad)

To pause and resume between projects without losing state:

```bash
# Freeze current project
rig down agentflow --snapshot

# Resume on target repository
rig up agentflow --existing --cwd /path/to/project
```

### Parallel Multi-Squad Mode (Concurrent Teams)

To run simultaneous squads on different projects at the same time:

```bash
# Provision a dedicated squad for a project (creates spec + Pi bridges)
./adapters/openrig/scripts/spawn-squad.sh my-project /path/to/my-project
./adapters/openrig/scripts/spawn-squad.sh other-project /path/to/other-project

# Launch squads in parallel
rig up agentflow-my-project --cwd /path/to/my-project
rig up agentflow-other-project --cwd /path/to/other-project

# Monitor all squads
rig ps

# Teardown when done
./adapters/openrig/scripts/spawn-squad.sh --remove my-project
```
