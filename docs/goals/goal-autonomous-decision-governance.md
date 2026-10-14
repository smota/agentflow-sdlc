<!-- agentflow-work:{"kind":"goal","parent":null,"changeClass":null,"admission":null} -->

# Goal: Autonomous Decision Governance & Anti-Loop Engine

**Kind:** goal

## Job

When software delivery squads execute autonomously without human supervision across multi-agent rigs (OpenRig, Pi, Claude, Codex, Grok), I want an external supervisory steering plane with cryptographic fencing, oracle-pinned test authoring, pragmatic defect triage (`accept_and_register`), and deterministic model escalation, so I can eliminate infinite rework loops, prevent metric-gaming/evidence tampering, and ship verified production code without over-engineering or human bottlenecking.

## Outcome

AgentFlow SDLC eliminates autonomous deadlocks and over-engineering by establishing a strict Two-Plane Separation between external supervisory steering and internal execution worker squads:

1. **Deterministic Ledger Circuit Breaker & Epoch Fencing**: Rework rounds are counted monotonically from the transition ledger (keyed per criterion). When `round > 2`, execution freezes immediately with an epoch fencing token. All subsequent commits on the worktree are cryptographically orphaned and rejected, halting loops cleanly.
2. **Oracle Immutability via Dedicated SDET (`dev.test-eng`)**: Verification oracles and simulation harnesses are authored by `dev.test-eng` in Phase 3/4 from the specification and pinned by an immutable digest before builder code is authored. Phase 5 QA remains strictly read-only verification. Builders are barred from modifying test oracles, and test-engineers are barred from modifying application source.
3. **Mechanical Product Squad Write Guard**: Product Managers and Analysts are strictly locked to `.agentflow/` and `goals/**`. Any commit or PR from a PM seat touching application code or tests (`src/**`, `tests/**`) is mechanically rejected in CI.
4. **Pragmatic Defect Triage (`accept_and_register`)**: The external steerer can accept non-critical observations and auxiliary telemetry edge cases without stalling release. It maps to `accepted-with-conditions` with mandatory, idempotent GitHub follow-up issue creation. It is strictly prohibited from waiving initial blocker findings, sensitive surfaces (security, auth, crypto, billing), or broken core suites.
5. **Decider Acceleration Port (`d3-flash` / Jev Auth)**: The running local non-causal decision model on port 8002 is integrated via a provider port exclusively in the external steering plane. It operates behind an allowlist for heuristic triage (queue ordering, issue dedupe, nudge levels), with pure deterministic fallbacks if offline. It is strictly banned from granting gate waivers or merging code.
6. **Pure-Function Model Escalation Ladder**: Builder seats escalate to frontier reasoning models (Codex GPT-6.1 Sol / Gemini Pro High) only when genuine application implementation failures occur across distinct test failures, completely independent of self-reported confidence.

## Release Intent

Ships across `agentflow-sdlc` core verification libraries (`lib/core/role-collaboration.mjs`, `lib/core/decision-policy.mjs`), protocol schemas (`schemas/resolution-ledger.schema.json`, `schemas/reverse-seam-packet.schema.json`), steering skills (`skills/agentflow-steerer/`), rig definitions (`~/.openrig/specs/agentflow-dev/rig.yaml`), and GitHub Actions CI guards. Fully backward compatible with existing single-agent and standard delivery workflows.

## Split Judgment

This goal breaks down into eight sequenced, independently verifiable capabilities:

### Slice 1: Ledger-Derived Rework Breaker & Epoch Fencing (High-Assurance)

- **Target**: `lib/core/role-collaboration.mjs`, `schemas/resolution-ledger.schema.json`.
- **Contract**: Rework rounds are derived strictly from ledger transition history (`currentRound + 1`). When `round > 2`, the breaker trips, marks the worktree `status: frozen`, increments an epoch fencing token, and emits a `rework-exhausted` reverse-seam packet. Any commit authored after the fencing token is rejected. Stops appending dead-end `"escalation required"` strings.

### Slice 2: Approval-Gated Steerer Merge & Authorization Hardening (Standard)

- **Target**: `skills/agentflow-steerer/references/adapter-openrig.md`, adapter runtime mirror.
- **Contract**: Fixes the open authorization leak by enforcing delivery-bound human approval (or recorded auto-merge policy) on the `merge` execution verb.

### Slice 3: Reverse-Seam Unfreeze Resolution Protocol (Standard)

- **Target**: `skills/agentflow-steerer/references/seam-rules.md`, transition envelope.
- **Contract**: Codifies the closed set of unfreezing resolutions: re-scope (back to Phase 1), slice split, person waiver, or abandonment. Requires signed resolution record.

### Slice 4: Pragmatic Defect Triage (`accept_and_register`) Guard (High-Assurance)

- **Target**: `lib/core/role-collaboration.mjs` (`verifyRoleAdvance`), CLI commands.
- **Contract**: Maps operator-facing `accept_and_register` to `accepted-with-conditions`. Mechanically rejected if any finding was initially logged as `[B] Blocker`, if breaker is tripped, if on a sensitive surface (auth, crypto, migration), or if missing an idempotent GitHub follow-up issue URL.

### Slice 5: Path-Ownership Manifest, PM Write Guard & `dev.test-eng` Seat (High-Assurance)

- **Target**: `manifests/path-ownership.json`, CI workflow, `agentflow-dev/rig.yaml`, AGENTS.md culture block.
- **Contract**: Mechanical default-deny CI check: PM seats can only write `.agentflow/` and `goals/**`. Introduces `dev.test-eng` (SDET) seat owning `tests/oracles/**`. Builder diffs to oracles and test-eng diffs to `src/**` are rejected. Phase 3 pins oracle digest before code is authored.

### Slice 6: Deterministic Decision Policy & Model Escalation Table (Standard)

- **Target**: `lib/core/decision-policy.mjs`.
- **Contract**: Pure-function rule table evaluating transition history: escalates builder to frontier models on distinct core test failures; routes oracle defects to test-eng; escalates timeouts/unknowns to human. Zero reliance on model self-confidence.

### Slice 7: Decider Provider Port (`d3-flash` & Jev Auth) (Standard)

- **Target**: `lib/providers/decider-port.mjs`, external steering adapters.
- **Contract**: Connects external steering plane to local `http://127.0.0.1:8002/v1/decide` (and Jev authenticated headers). Enforces payload sanitization (digests/stats only, no raw source code egress). Enforces model allowlist (advisory triage only; never gate sign-offs).

### Slice 8: Architecture & Governance Policy Synchronization (Bounded)

- **Target**: `docs/agent-workflow.md`, `docs/role-collaboration.md`, `docs/guiding-principles.md`, `CULTURE.md`.
- **Contract**: Documents the Two-Plane Separation, oracle pinning, epoch fencing, and defect triage laws across all repository authority files.
