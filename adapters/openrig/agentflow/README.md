# AgentFlow SDLC Rig

An autonomous, full-lifecycle engineering squad for parallel, independent software development across projects in `~/code`. Governed by AgentFlow SDLC contracts, Four-Eyes independence, isolated Git Worktrees, proof-driven delivery, and Council deliberation for complex decisions.

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
rig up agentflow --cwd /home/sam/code/holoself

# Inverted Codex lead preset
rig up agentflow --cwd /home/sam/code/holoself --preset inverted-codex-lead

# Dry run / inspection
rig up agentflow --cwd /home/sam/code/holoself --plan
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
- **Council Deliberation**: P2-P4 tasks trigger deliberative Council sessions between `orch.arch`, `rev.review`, and `dev.build-sr`.
