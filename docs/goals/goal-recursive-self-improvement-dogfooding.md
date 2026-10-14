<!-- agentflow-work:{"kind":"goal","parent":null,"changeClass":null,"admission":null} -->

# Goal: Recursive Self-Improvement Out-of-Band Dogfooding and Process Evaluation

**Kind:** goal
**Issue:** #484

## Job

When engineering teams run autonomous AgentFlow SDLC squads across projects, I want an out-of-band dogfooding and recursive self-improvement (RSI) engine that continuously tests shipped products against real usage and audits agent execution sessions, so that backlog push forces and framework refinements are generated empirically without human bottleneck or delivery gate contamination.

## Outcome

AgentFlow SDLC establishes a decoupled Recursive Self-Improvement (RSI) engine inspired by `factory-rsi`, operating across two distinct feedback loops:

### Phase 1: Functional Product Dogfooding Loop

1. **Commit & Backlog Delta Reader**: Bounded reader discovering merged trunk deltas (`git log`), correlating them with recently closed issues, goals, and anti-goals, while filtering out accepted human trade-offs from PR comments.
2. **Autonomous Dogfood Seat (`eval.tester` / `dogfood.tester`)**: Dedicated out-of-band OpenRig seat exercising shipped binaries/packages against golden user journeys, load scenarios, and exploratory test matrices.
3. **Structured Intake Finding & Push Emitter**: Standardized finding schema (`.agentflow/intake/finding-*.json`) capturing repro steps, observed vs. expected behavior, and JTBD push classifications (Crash, Friction, EdgeCase, Regression) feeding directly into product intake queues (`triage:intake`).

### Phase 2: Process & Meta-Dogfooding Evaluation Harness

4. **Session Trace Telemetry Ingestion**: Analyzer for `.agent-runs/*.jsonl` and OpenRig session logs extracting turn counts, token expenditure, command failures, rework loop iterations, and circuit-breaker trips.
5. **Prompt Drift & Boundary Violation Auditor**: Diagnostic evaluator inspecting agent reasoning traces for protocol violations (attempted worktree breaches, in-rig steering hallucinations, decider port bypasses, role confusion).
6. **Closed-Loop Policy & Prompt Synthesizer**: Generates evidence-backed prompt refinement diffs, permission adjustments, and rig configuration improvements for human/supervisory review.

## Release Intent

Ships across `agentflow-sdlc` core schemas (`schemas/intake-finding.json`), OpenRig adapter templates (`adapters/openrig/`), evaluation scripts (`scripts/dogfood/`, `scripts/telemetry/`), and telemetry verification libraries (`lib/core/session-eval.mjs`).

## Split Judgment

This goal breaks down into two distinct phases comprising six sequenced, independently verifiable capabilities:

### Phase 1: Functional Product Dogfooding Loop

#### Slice 1: Out-of-Band Git Delta & Backlog Surface Reader (Standard)

- **Target**: `scripts/dogfood/surface-reader.mjs`, `lib/dogfood-surface.mjs`
- **Issue**: #485
- **Contract**: Resolves commit delta between last dogfood run marker and current `HEAD` of integration line/trunk. Correlates commit messages and PR bodies with closed issues (`Closes #<id>`). Ingests issue bodies to extract Acceptance Criteria and explicit Anti-Goals / Out-of-Scope sections. Ingests PR comments and human review remarks to extract accepted limitations and deferred scope. Emits a structured `dogfood-surface.json` manifest specifying blast radius, changed modules, and exclusion filters.

#### Slice 2: Autonomous Exploratory Dogfood Seat & Execution Profile (Standard)

- **Target**: `adapters/openrig/agentflow/`, `adapters/openrig/agentflow-eval/`, seat guidance docs
- **Issue**: #486
- **Contract**: Defines optional `eval` pod or `dogfood.tester` seat in OpenRig adapter configurations. Establishes out-of-band execution discipline: runs against installed/built binary or local running server, never inside dirty worktrees. Cross-runtime diversity support (Codex or Claude Code runtime target). Strict negative constraints: never self-routes to inner delivery, never passes/fails active PRs, never commits code changes.

#### Slice 3: Structured Intake Finding Schema & Push-Force Emitter (Standard)

- **Target**: `schemas/intake-finding.json`, `scripts/dogfood/emit-finding.mjs`, `lib/core/intake-emitter.mjs`
- **Issue**: #487
- **Contract**: Defines `schemas/intake-finding.json` with required fields (`findingId`, `timestamp`, `commitSha`, `category`, `reproSteps`, `observedOutput`, `expectedProgress`, `severity`, `jtbdPushForce`). Emitter validates findings against schema before writing, persists them locally in `.agentflow/intake/finding-<id>.json`, and connects to backlog intake queue with `kind:capability` and `triage:intake` (or candidate status), preventing duplicates via fingerprint hashing.

---

### Phase 2: Process & Meta-Dogfooding Evaluation Harness

#### Slice 4: Session Trace Telemetry Extractor & Metrics Analyzer (Standard)

- **Target**: `scripts/telemetry/session-extractor.mjs`, `lib/core/session-telemetry.mjs`
- **Issue**: #488
- **Contract**: Ingests `.agent-runs/*.jsonl` transcripts and OpenRig session histories across all workflow phases. Aggregates execution metrics: total turns per role/seat, prompt vs. completion tokens, shell command error rates (`exit_code != 0`), rework loop count (`reworkCount`), and freeze/unfreeze events. Produces structured session telemetry digest `.agentflow/telemetry/run-<run-id>.json`.

#### Slice 5: Prompt Drift & Boundary Violation Auditor (High-Assurance)

- **Target**: `scripts/telemetry/audit-traces.mjs`, `lib/core/trace-auditor.mjs`
- **Issue**: #489
- **Contract**: Scans tool call sequences against path ownership policies (`manifests/path-ownership.json`): identifies unauthorized file touch attempts, git commit commands from non-builder seats, or decider port calls from in-rig seats. Evaluates agent role assertions: detects in-rig seats adopting steering personas (e.g., claiming `orch.steer` or attempting to execute supervisory verbs). Emits violation report with severity rankings (Critical, High, Medium, Low) and specific trace references.

#### Slice 6: Closed-Loop Policy & Prompt Refinement Synthesizer (Standard)

- **Target**: `scripts/telemetry/synthesize-refinements.mjs`, `lib/core/refinement-engine.mjs`
- **Issue**: #490
- **Contract**: Groups audit findings by root cause (ambiguous prompt guidance, missing negative constraints, loose permission defaults). Formulates structured remediation proposals: prompt diffs (`skills/**/SKILL.md`, `agents/**/role.md`), path ownership rule updates, or timeout/turn limits. Packages proposals into a reviewable draft artifact (`.agentflow/refinements/refinement-<id>.md`) surfaced to `steer.lead` and human supervisors for approval before application.

## Child Work & History

> **Status:** All capabilities delivered; closing workstream PR
> **Progress:** 6/6 capabilities delivered (100%)

| Part | Kind       | Title                                                                 | Status    | Replacement | Delivery PR | Commit    | Date       |
| :--- | :--------- | :-------------------------------------------------------------------- | :-------- | :---------- | :---------- | :-------- | :--------- |
| #485 | capability | capability: out-of-band git delta and backlog surface reader          | Delivered | —           | #497        | `56c6e55` | 2026-10-14 |
| #486 | capability | capability: autonomous exploratory dogfood seat and execution profile | Delivered | —           | #498        | `d9df16c` | 2026-10-14 |
| #487 | capability | capability: structured intake finding schema and push-force emitter   | Delivered | —           | pending     | `5424660` | 2026-10-14 |
| #488 | capability | capability: session trace telemetry extractor and metrics analyzer    | Delivered | —           | pending     | `d6c0c5f` | 2026-10-14 |
| #489 | capability | capability: prompt drift and boundary violation auditor               | Delivered | —           | pending     | `7258303` | 2026-10-14 |
| #490 | capability | capability: closed-loop policy and prompt refinement synthesizer      | Delivered | —           | pending     | `a3ceb14` | 2026-10-14 |
