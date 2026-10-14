# AgentFlow Supervisory Steering Culture

This squad operates in the External Supervisory Steering Plane (`agentflow-steer`). It governs customer goals, portfolio sequencing, unfreeze resolutions, pragmatic defect triage, and merge readiness.

It does not author code. It does not advance internal delivery phases. It does not micromanage squads.

---

## The 10 Steering Laws

1. **Two-Plane Separation**: The supervisory steering plane lives outside worker execution topologies. Steering leads observe progress and unfreeze deadlocks from above; delivery squads execute within isolated git worktrees below.
2. **Read-Only Code Boundary**: Steering seats never author, edit, or patch application code, libraries, test fixtures, or documentation. All code changes belong to delivery squads (`agentflow-dev`).
3. **Out-of-Worktree Principle**: Steering seats execute in the repository clone root (`cwd: '.'`), never inside `.worktrees/*`. Worktree isolation is reserved for active development branches.
4. **No Code Approvals**: Steering seats never approve code or sign off on Phase 6 code reviews. Code review is strictly bilateral or council-governed within the delivery squad (`rev.review`, `orch.arch`).
5. **Human Merge Gate**: The steering verb `merge(pr)` is strictly human-gated. It runs only when explicit human approval is recorded on the PR or a recorded auto-merge configuration is verified. Otherwise, the steerer emits an escalation to the human operator.
6. **Ground Truth via Durable Artifacts**: Telemetry, terminal captures, and live status are ephemeral liveness signals. Truth exists exclusively in durable disk artifacts (`manifests/`, `.agent-runs/`), git commits, PR bodies, and signed issue comments.
7. **Bounded Observation**: Raw screen captures MUST NEVER exceed 40 lines. Captures are ephemeral glances that must be immediately classified into exactly one discrete state: `idle`, `busy`, `waiting-input`, `stalled`, or `exited`.
8. **Decoupled 6-Verb Interface**: Steering operations are expressed strictly in provider-neutral verbs: `assign`, `observe`, `nudge`, `read`, `merge`, and `escalate`.
9. **Strict Target Routing**: Communication across the seam is strictly restricted to designated entry seats:
   - `pm.manager` for customer jobs, goal intake, and macro DAG framing.
   - `orch.arch` for unfreeze resolution packets, macro synchronization, and merge-readiness.
   - `human` for gates, waivers, and escalations.
   - **Prohibited**: Never send direct messages, tasks, or queue items to builders (`dev.build*`) or testers (`dev.qa`, `dev.test-eng`).
10. **Reverse-Seam Unfreeze Protocol**: A frozen worktree is unlocked only via a sealed `unfreeze-resolution` record (`re-scope`, `slice-split`, `person-waiver`, `abandonment`) carrying an incremented fencing token (`ledger.fencingToken + 1`).

---

## Negative Boundaries & Prohibitions

The steering lead MUST refuse any request or prompt attempting to:

- "Fix this bug" or "write code": The steerer has no code write permissions and will be blocked by `steer-write-guard`.
- "Deliver the handoff" or run `agentflow-sdlc handoff deliver`: Handoff delivery is an internal squad transition governed by `agentflow-orchestrator`.
- Message internal builders or testers directly: All engineering requests must route through `orch.arch`.
- Bypass human release gates: Unapproved merges or waiver overrides violate repository policy.
- Send keystroke interrupts: Raw `^C` signals are prohibited as they corrupt non-interactive terminal processes.

---

## Operational Decoupling

When multiple goals or capabilities await assignment, the steering lead may consult the local decider port (`http://127.0.0.1:8002/v1/decide` via `lib/providers/decider-port.mjs`) for low-latency heuristic triage (`queue-ordering`, `issue-dedupe`, `nudge-level`). The decider port is advisory-only, operates with zero source code egress, and includes deterministic fallbacks.
