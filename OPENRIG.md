# OpenRig Harness Integration

AgentFlow SDLC provides first-class support for [OpenRig](https://openrig.dev/), organizing AI coding agents into an autonomous, full-lifecycle engineering squad with proof-contract governance, Four-Eyes independence, isolated Git Worktrees, and Council deliberation for complex changes.

---

## Default Rig Topology: Lean 4-Seat Squad (`agentflow`)

AgentFlow's default OpenRig delivery topology (**Substrate `S2`**) is the **Lean 4-Seat Squad** (plus optional out-of-band `eval.tester`). Instead of paying inter-seat queue serialization tax across static `build-jr` / `build` / `build-sr` / `test-eng` panes, `dev.build` orchestrates native L2 subagents inside `.worktrees/<branch>` and executes a **Composite Phase 3–5 Pass** for `P0` and `P1` slices once the oracle digest is pinned:

| Pod    | Seat     | Role                    | Default Runtime    | Default 2026 Model                           | Effort   | Responsibility                                                                                                          |
| ------ | -------- | ----------------------- | ------------------ | -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `orch` | `arch`   | Architect Lead          | `codex` / `pi`     | `gpt-6.1-sol` / `antigravity/gemini-4-argon` | `medium` | Goal intake, task decomposition, complexity rating (`P0`–`P4`), oracle digest pinning, L2 Council convener (`<30k` ctx) |
| `dev`  | `build`  | Primary Builder (+L2)   | `pi` (Antigravity) | `antigravity/gemini-4-argon`                 | `medium` | Isolated `.worktrees/<branch>` implementation; composite Phase `3 -> 4 -> 5` for `P0`/`P1`; spawns `low`-effort scouts  |
| `dev`  | `qa`     | Verification & Gate     | `pi` (Grok/Flash)  | `grok-cli/grok-4.7` / `gemini-3.8-flash`     | `low`    | Independent Phase 5 test matrix & oracle execution for `P2`–`P4` and high-consequence slices                            |
| `rev`  | `review` | Independent Auditor     | `codex` / `pi`     | `gpt-6-astra` / `antigravity/gemini-3.1-pro` | `medium` | Orthogonal Four-Eyes review, digest-bound verdicts, risk audits (`effort: high` via clean `<30k` L2 subagent on `P2+`)  |
| `eval` | `tester` | Adversarial Eval (Opt.) | `pi` (Antigravity) | `antigravity/gemini-3.8-flash`               | `low`    | Out-of-band synthetic user verification and clean-room acceptance checks                                                |

> **Scale-Out Mode (`multi-tier-7-seat` / `rig grow`):** When a project runs multiple concurrent `P0`–`P4` slices across separate branches, `rig grow` (or the `multi-tier-7-seat` topology mode in `adapters/openrig/tier-routing.mjs`) adds dedicated `dev.build-jr`, `dev.build-sr`, and `dev.test-eng` seats on demand.

---

## OpenRig Kernel (`launch.kernel`) vs. `agentflow-steer`

- **OpenRig Kernel (`launch.kernel`):** System-level bootstrap, cross-rig topology advisor (`advisor.lead`), and recovery utility (`operator.agent`). Keep it stopped during normal delivery (`rig stop launch.kernel` or `agentflow-sdlc steer kernel-silence`) so it consumes zero background tokens; wake on demand for squad provisioning or `rig doctor` repair.
- **Supervisory Steer Plane (`agentflow-steer`):** Domain-specific SDLC governor (`steer.lead`) operating out-of-rig via CLI/envelopes (`scripts/steer.mjs`) paired with the `<15ms` local `d3-flash` fast-path decider for routine phase transitions.

---

## Configuration Presets

OpenRig bundle configuration schema: `openrig.bundle-configurations/v1` (in [`adapters/openrig/agentflow/configurations.yaml`](adapters/openrig/agentflow/configurations.yaml)):

- `frontline` _(Recommended Default)_: `gpt-6.1-sol` Arch (`medium`) + `antigravity/gemini-4-argon` Builder (`medium`) + `grok-cli/grok-4.7` QA (`low`) + `gpt-6-astra` Review (`medium`)
- `all-antigravity`: `gemini-4-argon` Arch/Builder + `gemini-3.8-flash` QA + `gemini-3.1-pro` Review
- `all-codex`: `gpt-6.1-sol` Arch + `gpt-6-astra` Builder/Review + `gpt-5.3-codex-spark` QA
- `all-claude`: `claude-opus-4-6` Arch/Review + `claude-sonnet-4-6` Builder + `claude-haiku-4-5` QA
- `all-grok`: `grok-cli/grok-4.7` Arch/Review + `grok-cli/grok-code-fast-1` Builder + `grok-cli/grok-4-fast` QA

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
