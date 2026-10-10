# AgentFlow SDLC for OpenRig

This adapter integrates AgentFlow SDLC with [OpenRig](https://openrig.dev/), providing a fully autonomous, full-lifecycle engineering squad for parallel, independent software development in the repository each squad is launched against.

---

## Architecture & Layout

- **`agentflow/`**: Canonical OpenRig Rig Bundle.
  - `rig.yaml`: Pods `orch`, `dev`, `rev` with Grok 4.7 lead/review and Claude/Codex builders/QA.
  - `configurations.yaml`: 8 declared presets (`balanced-grok-lead`, `inverted-codex-lead`, `grok-heavy`, `claude-heavy`, `codex-heavy`, `all-grok`, `all-claude`, `all-codex`).
  - `CULTURE.md`: AgentFlow SDLC laws (mandatory Git Worktrees, Four-Eyes Principle, proof contracts before code).
  - `agents/agentflow/`: Agent manifests, 12 profiles, guidance, and vendored skills.
- **`agentflow-product/`**: Generic product squad base (`pm.manager`, `pm.analyst`).
- **`lifecycle.mjs`**: Install, update, and squad operations, run through `agentflow-sdlc adapters ... openrig` on macOS, Linux, and Windows. It syncs both bases to `~/.openrig/specs`, sets up Pi state bridges for the preset's Pi seats, adds the grok-cli marker, and applies Git hygiene.

---

## Installation & Recovery

To install or restore the delivery and product bases on any machine running OpenRig:

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
# 1. Provision a dedicated squad for a target project
agentflow-sdlc adapters squads provision openrig my-project /path/to/my-project
agentflow-sdlc adapters squads provision openrig other-project /path/to/other-project

# 2. Launch each squad in parallel
rig up agentflow-my-project --cwd /path/to/my-project
rig up agentflow-other-project --cwd /path/to/other-project

# Product squad for the same project. This is not the delivery topology.
agentflow-sdlc adapters squads provision openrig --kind product --sibling agentflow-my-project pm /path/to/my-project
rig up agentflow-pm --cwd /path/to/my-project

# 3. Monitor both squads concurrently
rig ps

# 4. List, refresh, or remove squads
agentflow-sdlc adapters squads list openrig
agentflow-sdlc adapters squads update openrig my-project
agentflow-sdlc adapters squads remove openrig my-project
```
