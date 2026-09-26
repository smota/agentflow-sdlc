# Guiding Principles & Core Values

This document defines the foundational tenets, engineering philosophy, and core product values of **AgentFlow SDLC**. It serves as an authoritative guide for both **human developers/leaders** and **autonomous AI agents** contributing to or building with this framework.

---

## 1. Executive Summary

AgentFlow SDLC is an orchestration and governance framework for AI-driven software delivery in modern, regulated, and high-velocity engineering environments.

Rather than treating AI coding agents as opaque, unconstrained code generators, AgentFlow provides **deterministic rails, risk-proportional supervision, and cross-platform durability**.

### The Core Invariant

> **Autonomy without auditability is a liability. Governance without ergonomics is abandoned.**
> AgentFlow maximizes agent autonomy within bounded, verifiable constraints while preserving transparent human comprehension at every transition boundary.

---

## 2. The Six Guiding Principles

### Principle 1: Extensibility & Harness Neutrality

**Statement:** The framework must remain strictly agnostic to the underlying AI model, CLI harness, or execution target.

- **Normative Rules:**
  - `INVARIANT`: Never couple core SDLC logic to vendor-specific session formats or proprietary database engines.
  - `MUST`: Distinguish between the **runtime platform slug** (who provided workflow evidence, e.g., `agy`, `claude`, `codex`, `pi`) and the **execution target** (how commands run, e.g., `local-cli`, `anthropic-api`, `xai-api`).
  - `MUST NOT`: Assume an agent executes in its own native environment or inherit providers implicitly.
- **Codebase Manifestation:**
  - `manifests/runtime-platforms.json`
  - `lib/execution-targets.mjs`
  - Adapter files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `AGY.md`)

---

### Principle 2: Regulated Assurance & Compliance-by-Design

**Statement:** Compliance, traceability, and separation of duties must be structural properties of the workflow, not post-hoc paperwork.

- **Normative Rules:**
  - `INVARIANT`: All completed role transitions produce tamper-evident, cryptographically chained records.
  - `MUST`: Enforce the **Four-Eyes Principle (Dual-Control)** on standard and high-assurance artifacts. An author cannot approve their own transition gate without a formalized, auditable emergency waiver.
  - `MUST`: Enforce strict Separation of Duties. The `tester` and `reviewer` roles are strictly read-only (`observe` boundary) and must never repair or modify candidate source code directly.
- **Codebase Manifestation:**
  - Cryptographic Span Ledger: `lib/audit/role-flow-span.mjs` (`verifySpanChain`)
  - Interactive Dual-Control Gates: `lib/cockpit-actions.mjs`, `lib/sparring-gate.mjs`
  - Black-Box QA Separation of Duties: `roles/tester/tool-policy.json`, `lib/qa/qa-contract-verifier.mjs`

---

### Principle 3: Risk-Aware Card Taxonomy & Adaptive Execution

**Statement:** Avoid one-size-fits-all workflows. Delivery pipelines must dynamically adapt based on the intrinsic risk and impact surface of the work.

- **Normative Rules:**
  - `INVARIANT`: Cards are categorized into explicit taxonomy profiles: `light`, `standard`, and `high-assurance`.
  - `MUST`: Dynamically bypass non-applicable design or verification gates for `light` tasks (e.g., minor docs, non-functional tweaks) when project posture allows.
  - `MUST`: Require multi-agent consensus, rigorous exploratory QA, and formal human security sign-off for `high-assurance` tasks.
  - `MUST`: Enforce topological dependency ordering (`blocked_by`). A card cannot transition to implementation if prerequisite dependency cards remain unverified.
- **Codebase Manifestation:**
  - Goal & Board Model: `lib/cockpit-goal-model.mjs`, `lib/cockpit-markdown.mjs`
  - Posture Profiles: `lib/sdlc-vocabulary.mjs` (`DEFAULT_PROFILE_MAXIMUMS`)

---

### Principle 4: Agentic Flow with Human Decision Comprehension

**Statement:** Humans must remain in meaningful control at decision boundaries without introducing artificial workflow friction or blind rubber-stamping.

- **Normative Rules:**
  - `INVARIANT`: Transition gates must present concise, actionable decision context, highlighting residual risk, verification receipts, and test coverage gaps.
  - `MUST NOT`: Force humans into repetitive, low-context approvals for deterministic, evidence-backed steps.
  - `MUST`: Require human justification and explicit logging whenever an automated gate or invariant is bypassed via an emergency waiver.
- **Codebase Manifestation:**
  - Interactive Gate Dialogs: `lib/cockpit-ui.mjs`
  - Human Gate Attestations: `lib/core/review-attestation.mjs`
  - Workflow Evidence Comments: GitHub Issue status comment contracts

---

### Principle 5: Durable Continuity & Portability (Zero Context Loss)

**Statement:** AI-assisted development must be completely resilient against machine crashes, workstation migrations, and API rate limits (HTTP 429).

- **Normative Rules:**
  - `INVARIANT`: Uncommitted work and pipeline state must never be trapped on a single physical machine.
  - `MUST`: Automatically synchronize WIP checkpoint branches (`wip/<task-id>`) upon quota exhaustion or executor handoff.
  - `MUST`: Enforce monotonic fencing tokens to prevent split-brain write collisions if multiple machines or executors attempt to work on the same task.
  - `MUST`: Normalize file paths to POSIX (`/`), clean up stale lock files (`.git/index.lock`), and aggressively scrub credentials, API keys, and local PII before pushing state.
  - `MUST`: Compress handover payloads to strictly remain within <= 15% of the target agent's context window.
- **Codebase Manifestation:**
  - Cross-Platform Sanitizer: `lib/runtime/context-sanitizer.mjs`
  - Lease Fencing Manager: `lib/runtime/lease-fencing.mjs`
  - Handover Protocol: `lib/runtime/handover-protocol.mjs`
  - CLI Commands: `agentflow-sdlc handoff`, `agentflow-sdlc resume`

---

### Principle 6: Bounded Supervision & Zero Deadlock Invariant

**Statement:** No process, gate, or background task may run unbounded or cause pipeline deadlocks.

- **Normative Rules:**
  - `INVARIANT (Zero Deadlock)`: Every asynchronous verification gate must deterministically resolve within a configured deadline (default: 30 minutes).
  - `MUST`: Employ a three-tier gate resolution architecture:
    1. Active real-time webhooks.
    2. Background reconciling sweeper with exponential backoff.
    3. Deterministic timeout resolving hung gates to an explicit, auditable status (`timed_out` with reason).
  - `MUST`: Supervise all spawned child processes in monitored process trees, guaranteeing SIGTERM/SIGKILL termination and zero port lockups (`EADDRINUSE`).
  - `MUST`: Automatically extract external failure logs and inject them directly into downstream revision prompt loops.
- **Codebase Manifestation:**
  - Bounded Evidence Gate Sweeper: `lib/gates/gate-sweeper.mjs`
  - Process Group Supervisor: `lib/qa/process-supervisor.mjs`

---

## 3. Writing for Agents: Rules for Contributing Agents

When creating code, modifying architecture, or authoring documentation in this repository, agents MUST adhere to these cognitive and structural standards:

1. **Be Normatively Deterministic:** Use exact keywords (`MUST`, `MUST NOT`, `INVARIANT`, `RECOMMENDED`). Avoid ambiguous phrases such as "try to" or "if possible".
2. **Prioritize Single Sources of Truth:** Never duplicate definitions or invent parallel configuration mechanisms. Refer to `AGENTS.md` and canonical schema definitions.
3. **Keep Commits Issue-Scoped:** Every commit must link directly to an active GitHub issue via `Refs: #<id>` and specify its role pass metadata (`Role-Pass: developer`).
4. **Never Leak Local State:** Scrub all local workstation paths, user names, auth tokens, and `.agent-runs/` scratch paths before saving durable evidence or opening pull requests.
5. **Enforce Pre-flight Verification:** Run all repository validators (`validate:docs`, `validate:roles`, `test:workflow`, `test:hooks`) before requesting human review or marking issues complete.
