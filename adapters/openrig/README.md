# AgentFlow SDLC for OpenRig

This adapter integrates AgentFlow SDLC with [OpenRig](https://openrig.dev/), providing a fully autonomous, full-lifecycle engineering squad for parallel, independent software development in the repository each squad is launched against.

---

## Architecture & Layout

- **`agentflow/`**: Canonical OpenRig Rig Bundle.
  - `rig.yaml`: Pods `orch`, `dev`, `rev` with Grok 4.7 lead/review and Claude/Codex builders/QA.
  - `configurations.yaml`: 8 declared presets (`balanced-grok-lead`, `inverted-codex-lead`, `grok-heavy`, `claude-heavy`, `codex-heavy`, `all-grok`, `all-claude`, `all-codex`).
  - `CULTURE.md`: AgentFlow SDLC laws (mandatory Git Worktrees, Four-Eyes Principle, proof contracts before code).
  - `agents/agentflow/`: Agent manifests, 12 profiles, guidance, and vendored skills.
- **`scripts/install-rig.sh`**: One-line installer and recovery script that syncs the base bundle to `~/.openrig/specs/agentflow`, sets up the Pi state bridge for Grok 4.7, ensures credentials, and enforces Git hygiene.
- **`scripts/spawn-squad.sh`**: Dynamic squad factory for running parallel, concurrent AgentFlow squads across different repositories.

---

## Installation & Recovery

To install or restore the canonical base rig setup on any machine running OpenRig:

```bash
./adapters/openrig/scripts/install-rig.sh
```

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
./adapters/openrig/scripts/spawn-squad.sh my-project /path/to/my-project
./adapters/openrig/scripts/spawn-squad.sh other-project /path/to/other-project

# 2. Launch each squad in parallel
rig up agentflow-my-project --cwd /path/to/my-project
rig up agentflow-other-project --cwd /path/to/other-project

# Product squad for the same project. This is not the delivery topology.
./adapters/openrig/scripts/spawn-squad.sh --kind product --sibling agentflow-my-project pm /path/to/my-project
rig up agentflow-pm --cwd /path/to/my-project

# 3. Monitor both squads concurrently
rig ps

# 4. List or cleanup squads
./adapters/openrig/scripts/spawn-squad.sh --list
./adapters/openrig/scripts/spawn-squad.sh --remove my-project
```
