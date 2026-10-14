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

To install or recover the delivery, product, and steer bases into your OpenRig user library:

```bash
agentflow-sdlc adapters install openrig [--preset <name>] [/path/to/project]
```

Run it again to recover. With a project path, it also adds the AgentFlow Git excludes to that
repository. To refresh the bases after upgrading AgentFlow:

```bash
agentflow-sdlc adapters update openrig
```

This refreshes the AgentFlow bases only. It does not install or upgrade OpenRig.

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
# Provision all 3 squads (product, delivery, steer) atomically with cross-rig bindings
agentflow-sdlc adapters squads provision openrig --kind all my-project /path/to/my-project

# Or provision dedicated squads individually
agentflow-sdlc adapters squads provision openrig my-project /path/to/my-project
agentflow-sdlc adapters squads provision openrig --kind product --sibling agentflow-my-project pm /path/to/my-project
agentflow-sdlc adapters squads provision openrig --kind steer --product agentflow-my-project-pm --delivery agentflow-my-project-dev my-project-steer /path/to/my-project

# Launch squads in parallel
rig up agentflow-my-project-pm --cwd /path/to/my-project
rig up agentflow-my-project-dev --cwd /path/to/my-project
rig up agentflow-my-project-steer --cwd /path/to/my-project

# Monitor all squads
rig ps
agentflow-sdlc adapters squads list openrig

# Refresh a squad after `adapters update openrig` (keeps seat runtime state)
agentflow-sdlc adapters squads update openrig my-project

# Teardown when done (preserves steering audit state unless --purge is passed)
agentflow-sdlc adapters squads remove openrig [--purge] my-project
```

## Product-to-delivery handoffs

A product seat (`pm.manager`, `pm.analyst`) sends work to delivery only with
`agentflow-sdlc handoff deliver`. While the delivery squad has unfinished work, queued work, a
seat that does not report idle, a busy record, or a state that cannot be read, the handoff is held
and no delivery seat is woken. Idle seats do not make the squad free.

```bash
agentflow-sdlc handoff list                        # held handoffs: goal, transition, target, sender, signal, since
agentflow-sdlc handoff flush                       # deliver the oldest hold if its squad is free
agentflow-sdlc handoff release <hold-id>           # the person only, at a terminal: deliver now
agentflow-sdlc handoff busy agentflow-my-project --set --note "finishing a release"
agentflow-sdlc handoff busy agentflow-my-project --clear   # the person only
```

Product seats cannot use `rig send`, `rig queue create`, `rig queue handoff`, or `tmux send-keys`:
a guard in each seat's runtime blocks them (a Claude Code and Codex PreToolUse hook, and a Pi
extension). There is no option that sends anyway. Running seats pick the guard up when they start,
so restart a product squad after `agentflow-sdlc adapters update openrig` and
`agentflow-sdlc adapters squads update openrig <project>`.
