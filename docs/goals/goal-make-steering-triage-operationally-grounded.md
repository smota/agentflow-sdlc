<!-- agentflow-work:{"kind":"goal","parent":null,"changeClass":"standard","admission":null} -->

# Goal: Make Steering Triage Decisions Operationally Grounded

**Kind:** goal  
**Issue:** #500

## Job

When the external supervisory steering plane triages stalled squad seats, prioritizes candidate execution queues, and classifies new defect observations against open issues, I want decisions grounded in explicit operational policies, symmetric structured attributes, and unambiguous threshold boundaries, so that heuristic triage behaves predictably, entropy collapse is eliminated, and genuine defect signals remain visible.

## Outcome

AgentFlow SDLC establishes grounded, calibrated decision contracts for the Type-1 non-causal decider port (`lib/providers/decider-port.mjs`) across its three allowed triage operations:

1. **Deterministic Nudge Escalation Boundaries (#501)**:
   - Evaluates numeric thresholds (`round >= 2 || idleSec >= 300` -> `interrupt`, `idleSec >= 120` -> `standard`, else `gentle`) deterministically in code immediately upon steering authorization.
   - Eliminates external model network calls for pure numeric comparisons, completely resolving the empirical entropy collapse (confidence ~0.083 under uniform distribution).

2. **Grounded Queue Priority Selection (#502)**:
   - Symmetrically exposes all ranking comparator attributes (`blocked`, `reworkRound`, `failuresCount`, `priority`, `createdAt`, `inputOrder`) in state items and task criteria strings.
   - Injects explicit lexicographic precedence rules in prompt instructions to align choice token probabilities with operational urgency.

3. **Symmetrical Defect Observation Deduplication (#503)**:
   - Exposes structured attributes (`title`, `criterionId`, `errorCategory`, `exitCode`) symmetrically for both candidate and existing issues.
   - Normalizes missing fields to `unknown` and specifies clear deduplication rules in prompt instructions.
   - Tightens deterministic match shortcuts to require matching both non-empty `criterionId` and non-empty `errorCategory`, preventing partial matches from suppressing distinct defects.

## Release Intent

Ships across `lib/providers/decider-port.mjs` and `lib/__tests__/decider-port.test.mjs`, verified against both offline vitest suites and live service checks on port 8002.

## Split Judgment

This goal delivers three sequenced, bounded capabilities delivered in a single cohesive workstream:

### Capability 1: Apply Deterministic Nudge Escalation Boundaries

- **Issue:** #501
- **Target:** `lib/providers/decider-port.mjs` (`triageNudgeLevel`), `lib/__tests__/decider-port.test.mjs`
- **Contract:** Enforce steering plane and seat authorization check, evaluate numeric thresholds directly in code, and return `{ ok: true, source: 'deterministic', level }` without calling `queryDecider`.

### Capability 2: Ground Queue Selection in Explicit Priority Attributes

- **Issue:** #502
- **Target:** `lib/providers/decider-port.mjs` (`triageQueueOrdering`), `lib/__tests__/decider-port.test.mjs`
- **Contract:** Symmetrically expose all comparator attributes in state and criteria strings with explicit lexicographic instructions.

### Capability 3: Compare Defect Observations Symmetrically

- **Issue:** #503
- **Target:** `lib/providers/decider-port.mjs` (`triageIssueDedupe`), `lib/__tests__/decider-port.test.mjs`
- **Contract:** Symmetrical issue representation, tightened deterministic match checks, and explicit duplicate criteria.
