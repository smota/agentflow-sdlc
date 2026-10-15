# AgentFlow SDLC for OpenRig

This adapter integrates AgentFlow SDLC with [OpenRig](https://openrig.dev/), providing a fully autonomous, full-lifecycle engineering squad for parallel, independent software development in the repository each squad is launched against.

---

## Architecture & Layout

- **`agentflow/`**: Canonical OpenRig Delivery Rig Bundle (Lean 4-Seat Default Squad + optional `eval.tester`).
  - `rig.yaml`: Pods `orch` (`orch.arch`), `dev` (`dev.build`, `dev.qa`), `rev` (`rev.review`), and `eval` (`eval.tester`) calibrated to `effort: medium` (primary reasoning loops) and `effort: low` (QA/verification) to prevent high-effort context degradation.
  - `configurations.yaml`: 2026 presets (`frontline`, `all-antigravity`, `all-codex`, `all-claude`, `all-grok`) with orthogonal builder (`antigravity/gemini-4-argon`) and reviewer (`gpt-6-astra`) defaults.
  - `CULTURE.md`: AgentFlow SDLC laws (mandatory Git Worktrees, Four-Eyes Principle, proof contracts before code, L2 subagent delegation, and `P0`/`P1` Composite Phase 3–5 Builder Pass).
  - `agents/agentflow/`: Agent manifests, profiles, guidance, and vendored skills.
- **`agentflow-product/`**: Generic product squad base (`pm.manager`, `pm.analyst`) with outbox handoff and multi-writer admission (`handoff-step.mjs`, `pipeline-admission.mjs`).
- **`agentflow-steer/`**: Generic supervisory steering squad base (`steer.lead`), operating strictly out-of-rig without git worktrees or code-authoring permissions, paired with the `d3-flash` fast-path decider.
- **Routing, Fallback & Continuity Modules**:
  - `tier-routing.mjs`: Complexity rung resolution (`P0`–`P4`), Lean 4-Seat vs. Multi-Tier 7-Seat mapping, `P0`/`P1` Composite Phase 3–5 compression, and sticky rework affinity.
  - `platform-fallback.mjs`: Two-level platform/model fallback chains, 2026 model matrix (`gemini-4-argon`, `gpt-6-astra`, `gpt-6.1-sol`, `grok-4.7`, `gemini-3.8-flash`), Four-Eyes orthogonality enforcement, and Effort-Degradation Guard.
  - `continuity-policy.mjs`: Pre-phase token headroom gates and role-differentiated continuity (`ephemeral-slice`, `isolated-review`, `stateful-lead`).
- **`lifecycle.mjs`**: Install, update, and squad operations, run through `agentflow-sdlc adapters ... openrig` on macOS, Linux, and Windows. It syncs all bases to `~/.openrig/specs`, sets up Pi state bridges, manages steering state directories, and applies Git hygiene.

---

## Installation & Recovery

To install or restore the delivery, product, and steer bases on any machine running OpenRig:

```bash
agentflow-sdlc adapters install openrig [--preset <name>] [/path/to/project]
```

Run it again to recover. After upgrading AgentFlow, refresh the installed bases with
`agentflow-sdlc adapters update openrig`. That does not install or upgrade OpenRig itself.

Or add the rig spec directly to your OpenRig user library:

```bash
rig specs add adapters/openrig/agentflow
```

---

## Multi-Project Operation Modes

OpenRig supports two operating workflows:

### Mode 1: Context Switching (Single Squad via Snapshot & Resume)

Best when focusing on one project at a time. Zero idle cost, instant resume.

```bash
# Launch on Project A
rig up agentflow --cwd /path/to/project-a

# Freeze Project A instantly when shifting focus
rig down agentflow --snapshot

# Resume on Project B (or back to Project A)
rig up agentflow --existing --cwd /path/to/project-b
```

### Mode 2: Multi-Squad Parallel Execution (Simultaneous Teams)

Best when running completely concurrent squads on separate projects at the same time. Each squad receives an isolated namespace, distinct tmux sessions (`<seat>@agentflow-<project>`), and dedicated Pi bridges.

```bash
# 1. Provision all 3 squads (product, delivery, steer) atomically
agentflow-sdlc adapters squads provision openrig --kind all my-project /path/to/my-project

# Or provision squads individually
agentflow-sdlc adapters squads provision openrig my-project /path/to/my-project
agentflow-sdlc adapters squads provision openrig --kind product --sibling agentflow-my-project pm /path/to/my-project
agentflow-sdlc adapters squads provision openrig --kind steer --product agentflow-my-project-pm --delivery agentflow-my-project-dev my-project-steer /path/to/my-project

# 2. Launch squads in parallel
rig up agentflow-my-project-pm --cwd /path/to/my-project
rig up agentflow-my-project-dev --cwd /path/to/my-project
rig up agentflow-my-project-steer --cwd /path/to/my-project

# 3. Monitor squads concurrently
rig ps

# 4. List, refresh, or remove squads (preserves steering audit state unless --purge is passed)
agentflow-sdlc adapters squads list openrig
agentflow-sdlc adapters squads update openrig my-project
agentflow-sdlc adapters squads remove openrig [--purge] my-project
```
