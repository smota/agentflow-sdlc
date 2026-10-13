# Reverse Seam Governance and Multi-Seat Rig Coordination

This document codifies the seam discipline, handoff contracts, and reverse seam return protocols between `agentflow-pm` (product shaping) and `agentflow-dev` (engineering delivery) squads.

## 1. Seam Architecture

The seam establishes a clean, non-leaking boundary between product discovery and software engineering:

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│         agentflow-pm            │                 │         agentflow-dev           │
│                                 │                 │                                 │
│  - Steering Product Owner (PO)  │                 │  - Orchestrator (orch.arch)     │
│  - Analyst (pm.analyst)         │                 │  - Builders (dev.build / sr)    │
│  - Sponsor / Human Supervisor   │                 │  - Tester (dev.qa)              │
│                                 │                 │  - Reviewer (rev.review)        │
│  Owns: What and Why             │                 │  Owns: How and Verification     │
└──────────────┬──────────────────┘                 └─────────────────┬───────────────┘
               │                                                      │
               │─────── Forward Handoff: Immutable Spec ─────────────>│
               │                                                      │
               │<────── Reverse Seam: Technical Roadblock / Defect ───│
```

- **`agentflow-pm`** owns: Customer Jobs (JTBD), Four Forces, vertical capability mapping, topological prerequisite ordering, observable Given-When-Then criteria, anti-goals, autonomy envelopes, and person release gates.
- **`agentflow-dev`** owns: Software architecture, worktree isolation, proof contracts, code authorship, unit/integration testing, independent peer review, and PR readiness.
- **Seam Invariant**: Product framing never dictates internal code abstractions or file layouts; engineering delivery never unilaterally alters customer promises, anti-goals, or acceptance criteria.

---

## 2. Artifact-Only Handoff Invariant

All forward work moving from `agentflow-pm` to `agentflow-dev` MUST be packaged as immutable disk artifacts:

1. **Permitted Handoff Payload**:
   - Stable capability identifier (kebab-case, e.g. `unified-config-projection`).
   - Parent goal reference URI.
   - Path to an immutable specification file on disk (`specs/...` or `.agent-runs/issues/...`).
   - Customer job summary and Given-When-Then observable acceptance boundaries.
   - Explicit anti-goals and out-of-scope exclusions.
2. **Prohibited Handoff Formats**:
   - Conversational chat instructions, slack pings, or interactive terminal context.
   - Ephemeral memory, undocumented assumptions, or verbal approvals.
3. **Rule of Absence**: If a requirement or constraint is not present in the immutable specification artifact on disk, it does not exist for the `agentflow-dev` squad. Builders MUST NOT accept out-of-band oral modifications.

---

## 3. Reverse Seam Return Protocol

When an engineering seat encounters a fundamental blocker that cannot be resolved within the accepted spec constraints, the seat MUST NOT hallucinate fixes or secretly reshape scope. It MUST trigger a **Reverse Seam Return**.

### Return Trigger Conditions

1. **Technical Infeasibility**: The target platform, dependencies, or runtime invariants cannot satisfy the outcome within specified constraints (e.g. impossible latency, missing OS primitive).
2. **Assumption Defect**: Empirical testing or architectural spikes prove a foundational requirement assumption is factually wrong or internally contradictory.
3. **Scope Explosion**: Satisfying the outcome requires splitting the slice into multiple separate customer progress increments, violating the single-outcome vertical slice invariant.
4. **Hidden Macro Coupling**: An undetected circular dependency or cross-cutting state collision is identified that requires re-sequencing the macro backlog DAG.

### Return Procedure

1. **Halt Delivery**: Builder immediately pauses code authoring and prevents phase advancement beyond Phase 1/Phase 2.
2. **Emit Reverse Seam Packet**: Builder/Architect authors a structured return packet:
   - `impactedCapability`: Capability ID and spec path.
   - `triggerCondition`: One of the 4 conditions above.
   - `observedEvidence`: Commands executed, error logs, reproduction script, or contradictory constraints.
   - `engineeringAssessment`: Why the current spec is unworkable.
   - `proposedTradeoffs`: Concrete alternatives for product re-evaluation (e.g. degrade non-critical requirement, split capability, alter dependency sequence).
3. **Route to Phase 1 (Product Intake)**: The return packet is submitted back across the seam to `agentflow-pm` (Analyst/PO).
4. **Product Re-evaluation**: `agentflow-pm` re-analyzes the job, adjusts the capability mapping or acceptance criteria, secures sponsor/person re-admission if necessary, and dispatches a revised immutable spec.

---

## 4. Four-Eyes Principle and Code Approval Prohibition

To guarantee integrity and eliminate conflicts of interest, authority is strictly separated:

1. **PO Code Approval Prohibition**:
   - The Steering Product Owner seat and PM seats MUST NEVER approve code, self-certify verification, or merge pull requests on their own authority.
   - A PO "accepting" a capability verifies that customer criteria are met, not that the code is architecturally sound or free of security flaws.
2. **Mandatory Four-Eyes Baseline**:
   - No builder approves their own pull request or self-certifies verification.
   - Every merge into `development` requires bilateral sign-off: Builder (`dev.build`) + Independent Reviewer (`rev.review` or `agentflow-auditor`).
3. **Council Consensus (P2–P3)**:
   - Structural, architectural, or cross-cutting capabilities require unanimous council consensus:
     - `orch.arch` (architectural integrity)
     - `dev.build-sr` (implementation)
     - `dev.qa` (black-box verification & proof contracts)
     - `rev.review` (independent code & security review)
4. **Human Release Gate (P4)**:
   - Production releases, breaking API contracts, and schema migrations require explicit sponsor confirmation phrase: `agree <gate_id> as <sponsor>`.

---

## 5. Multi-Seat Rig Coordination

When operating across distinct OpenRig pods (`agentflow-pm` pod and `agentflow-dev` pod):

1. **Inter-Pod Messaging via Durable Queues**:
   - Pods communicate via `rig queue create` and explicit queue item tracking.
   - Direct `rig send` prompts serve strictly as notifications/nudges pointing to durable queue rows.
2. **Hot-Potato Terminal Turn Rule**:
   - An active seat does not end its turn by idling. It ends its turn by passing work to the next seat via `agentflow-sdlc phase append` or queue handoff.
   - Every queue item MUST include the goal URI and transition URI.
3. **Crash & Compaction Resilience**:
   - Because terminal sessions may compact or restart, volatile conversational context is never durable.
   - The seam relies entirely on disk-committed evidence (`.agent-runs/`, `manifests/`, `specs/`, git commits, PR manifests).
