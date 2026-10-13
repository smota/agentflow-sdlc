# OpenRig Execution Adapter Reference

This document maps the provider-neutral 6-verb steering PO interface to concrete OpenRig CLI operations. It establishes execution layer decoupling: the steering PO reasons in abstract steering verbs, while this reference specifies how those verbs execute within an OpenRig topology.

## Invariants

1. **Ground Truth Invariant**: Seats report progress through durable artifacts (`.agent-runs/`, git commits, PR bodies, issue comments). Process telemetry and terminal captures are strictly for liveness checks and stall detection, never for certifying task completion.
2. **Bounded Observation Invariant**: Raw terminal captures MUST NEVER exceed 40 lines. Captures are ephemeral glances that MUST be immediately classified into exactly one discrete state: `idle`, `busy`, `waiting-input`, `stalled`, or `exited`. Raw capture text MUST NOT be retained across ticks or leaked into conversation context.
3. **Decoupled Execution Invariant**: Steering logic depends only on the 6 verb signatures. Runtimes without OpenRig use alternative adapter tables (see [adapter-tmux](adapter-tmux.md) and [adapter-github](adapter-github.md)) without altering steering rules.

---

## The 6-Verb Interface

### 1. `assign(seat, brief_ref)`

Dispatches an admitted task brief to a designated squad seat.

- **Signature**: `assign(seat: string, brief_ref: string) -> { assigned: boolean, queue_id?: string }`
- **Preconditions**:
  - `brief_ref` points to an immutable, admitted specification or task packet on disk.
  - `seat` is a valid, recognized seat in the squad topology.
- **OpenRig Mapping**:
  ```bash
  # Enqueue durable work item with goal and transition pointers
  rig queue create --seat <seat> --brief <brief_ref>
  # Direct prompt notification into target seat pane
  rig send <seat> "Goal: <goal_uri> | Transition: <transition_uri> | Brief: <brief_ref>"
  ```
- **Postconditions**: Task is durable in the seat's queue; target terminal is nudged.

### 2. `observe(seat)`

Inspects seat liveness and operational posture without disrupting its context.

- **Signature**: `observe(seat: string) -> { state: "idle" | "busy" | "waiting-input" | "stalled" | "exited", lines_captured: number }`
- **Preconditions**: `seat` exists in current rig topology.
- **OpenRig Mapping**:
  ```bash
  # Check node process status
  rig ps --nodes --json
  # Ephemeral glance at screen (bounded to last 40 lines)
  rig capture <canonicalSessionName> | tail -n 40
  ```
- **Classification Rules**:
  - `idle`: Prompt is waiting for user/agent input, no active task executing.
  - `busy`: Tool execution, compilation, test run, or generation in progress.
  - `waiting-input`: Interactive confirmation prompt (permission, gate, question) detected.
  - `stalled`: Process active but unchanged across multiple heartbeats with zero progress.
  - `exited`: Process or pane terminated.

### 3. `nudge(seat, level)`

Sends a prompt, wake, or interrupt signal to an executing seat.

- **Signature**: `nudge(seat: string, level: "gentle" | "standard" | "interrupt", message?: string) -> { sent: boolean }`
- **Levels**:
  - `gentle`: Informational wake or status reminder.
    ```bash
    rig send <seat> "Status update check: please report current step on <brief_ref>"
    ```
  - `standard`: Expected transition or handoff overdue notice.
    ```bash
    rig send <seat> "Handoff pending: please record phase evidence and transition"
    ```
  - `interrupt`: Cancel hung command or recover stuck execution.
    ```bash
    # Send SIGINT then recovery instruction
    rig send <seat> "^C"
    rig send <seat> "Recovering turn: check last error and resume or yield"
    ```

### 4. `read(artifact)`

Loads durable execution artifacts from the filesystem or repository.

- **Signature**: `read(artifact: string) -> { exists: boolean, content: string, digest: string }`
- **Behavior**: Reads evidence files, phase transition receipts, test summaries, or git patches. Telemetry or volatile console buffers are prohibited here.
- **Paths**: `.agent-runs/issues/<issue>/...`, `manifests/...`, `.worktrees/<branch>/...`.

### 5. `merge(pr)`

Executes squash-and-merge of a verified pull request after bilateral/council review sign-off.

- **Signature**: `merge(pr: number) -> { merged: boolean, sha?: string }`
- **Preconditions**:
  - Independent reviewer or auditor sign-off recorded.
  - Four-eyes principle satisfied (builder != reviewer).
  - All CI status checks green.
- **Mapping**:
  ```bash
  gh pr merge <pr> --squash --delete-branch
  ```

### 6. `escalate(class, msg)`

Raises an out-of-band escalation to the human operator or supervising orchestrator.

- **Signature**: `escalate(class: "human-gate" | "contract-breach" | "blocker" | "resource-exhaustion", msg: string) -> { escalated: boolean }`
- **OpenRig Mapping**:
  ```bash
  # Send direct alert to OpenRig operator seat
  rig send operator.agent "ESCALATION [<class>]: <msg>"
  # Record durable escalation on issue or PR
  gh issue comment <issue> --body "⚠️ **ESCALATION [<class>]**: <msg>"
  ```
