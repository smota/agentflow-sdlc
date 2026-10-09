# AgentFlow SDLC for OpenRig

This adapter integrates AgentFlow SDLC with [OpenRig](https://openrig.dev/), providing a fully autonomous, full-lifecycle engineering squad for parallel, independent software development across projects in `~/code`.

---

## Architecture & Layout

* **`agentflow/`**: Canonical OpenRig Rig Bundle.
  * `rig.yaml`: Pods `orch`, `dev`, `rev` with Grok 4.7 lead/review and Claude/Codex builders/QA.
  * `configurations.yaml`: 8 declared presets (`balanced-claude-lead`, `inverted-codex-lead`, `grok-heavy`, `claude-heavy`, `codex-heavy`, `all-grok`, `all-claude`, `all-codex`).
  * `CULTURE.md`: AgentFlow SDLC laws (mandatory Git Worktrees, Four-Eyes Principle, proof contracts before code).
  * `agents/agentflow/`: Agent manifests, 12 profiles, guidance, and vendored skills.
* **`scripts/install-rig.sh`**: One-line installer and recovery script that syncs the bundle to `~/.openrig/specs/agentflow`, sets up the Pi state bridge for Grok 4.7, ensures credentials, and enforces Git hygiene.

---

## Installation & Recovery

To install or restore the rig setup on any machine running OpenRig:

```bash
./adapters/openrig/scripts/install-rig.sh
```

Or add the rig spec directly to your OpenRig user library:

```bash
rig specs add adapters/openrig/agentflow
```

---

## Usage

```bash
# Launch attached to a project (Recommended preset: Grok 4.7 Lead/Review + Claude Builders + Codex QA)
rig up agentflow --cwd /path/to/project

# Launch with an alternative preset
rig up agentflow --cwd /path/to/project --preset inverted-codex-lead

# Status and node monitoring
rig ps --nodes --rig agentflow

# Freeze context instantly (snapshot)
rig down agentflow --snapshot

# Resume context instantly
rig up agentflow --existing
```
