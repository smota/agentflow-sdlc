# S0 Baseline — Contract Ownership Map (rework after Codex review)

**Date:** 2026-09-25
**Slice:** S0
**Status:** Baseline (observed current state — not a delivered acceptance)
**Worktree base revision observed:** ffcc3ee071dc32aa7a9c600857e177a8cc6264eb (per execution plan §Evidence)
**Plan ref:** docs/maintainers/process-autonomy-execution-plan.md

> [!IMPORTANT]
> "Proposed" surfaces below are S0 baseline placeholders for S1–S9 implementation.
> Their presence here is not proof of delivery. Do not treat proposed ADRs as accepted.

---

## Layer: Domain (no OTel, GitHub, CLI, or Meshloop imports)

| Surface                                                                | File                                       | ADR                  | Notes                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `createRunEvent`, `reduceRun`, `projectRunStatus`, `RUN_ROLES`         | `lib/core/run-state.mjs`                   | ADR001, ADR004       | Exists. Event reducer is the authoritative state machine                                                                          |
| `createGate`, `satisfyGate`, `deriveCrossings`, `GATE_CLASSES`         | `lib/core/gate.mjs`                        | ADR001, ADR004       | Exists. S2 may extend; any extension requires design review — no new gate class prescribed here                                   |
| `resolvePosture`, `requiredHumanGateClasses`                           | `lib/core/posture.mjs`                     | ADR001, ADR004       | Exists                                                                                                                            |
| `validateDeliveryContract`, `budgetAdmission`, `resolveDeliveryPolicy` | `lib/core/delivery-policy.mjs`             | ADR004, ADR007       | Exists                                                                                                                            |
| `CollaborationIntent`                                                  | `lib/core/collaboration-intent.mjs`        | ADR005               | Exists                                                                                                                            |
| `ProviderBinding`                                                      | `lib/core/provider-binding.mjs`            | ADR005               | Exists                                                                                                                            |
| `ExecutionReceipt`                                                     | `lib/core/execution-receipt.mjs`           | ADR005               | Exists                                                                                                                            |
| `validateSourceAdapter`, `requireSourceMutation`                       | `lib/core/source-adapter.mjs`              | ADR005               | Exists. `validateSourceAdapter` was already called by `resolveSource()` in `integration-lifecycle.mjs` before S0 (W8g D1 comment) |
| `ArtifactRef`                                                          | `lib/core/artifact-ref.mjs`                | ADR005               | Exists                                                                                                                            |
| `DelegationGrant` (proposed)                                           | `lib/core/delegation-grant.mjs` (proposed) | ADR010 (proposed D1) | **Not yet implemented.** S2 deliverable                                                                                           |
| Typed plain observations (proposed)                                    | `lib/core/observations.mjs` (proposed)     | ADR012 (proposed D3) | **Not yet implemented.** S1 deliverable                                                                                           |

---

## Layer: Use Cases

| Surface                                                                      | File                                                  | ADR                  | Notes                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------- | -------------------------------------------------- |
| `requiresHumanAcceptance`, `advance`, `verifyCriteria`, `GovernedBlockError` | `lib/application/run-service.mjs`                     | ADR001, ADR004       | Exists. `authorize` callback returns boolean today |
| Onboarding service                                                           | `lib/application/onboarding-service.mjs`              | ADR006, ADR009       | Exists                                             |
| Continuation service (proposed)                                              | `lib/application/continuation-service.mjs` (proposed) | ADR011 (proposed D2) | **Not yet implemented.** S5 deliverable            |

---

## Layer: Adapters

| Surface                             | File                                             | ADR                  | Notes                                    |
| ----------------------------------- | ------------------------------------------------ | -------------------- | ---------------------------------------- |
| GitHub run store                    | `lib/sources/github-run-store.mjs`               | ADR005               | Exists                                   |
| GitHub CLI source adapter           | `lib/sources/github-cli.mjs`                     | ADR005               | Exists                                   |
| GitHub client                       | `lib/sources/github-client.mjs`                  | ADR005               | Exists                                   |
| Receipt store                       | `lib/sources/receipt-store.mjs`                  | ADR005               | Exists                                   |
| OTel adapter (proposed)             | `lib/observability/otel.mjs` (proposed)          | ADR012 (proposed D3) | **Not yet implemented.** S1 deliverable  |
| Local buffer (proposed)             | `lib/observability/local-buffer.mjs` (proposed)  | ADR012 (proposed D3) | **Not yet implemented.** S1 deliverable  |
| Pending audit journal (proposed)    | `lib/observability/audit-journal.mjs` (proposed) | ADR012 (proposed D3) | **Not yet implemented.** S1 deliverable  |
| Immutable-revision cache (proposed) | `lib/sources/immutable-cache.mjs` (proposed)     | ADR011 (proposed D2) | **Not yet implemented.** S4a deliverable |

---

## Layer: Providers

| Surface                      | File                                    | ADR                  | Notes                                   |
| ---------------------------- | --------------------------------------- | -------------------- | --------------------------------------- |
| Local CLI provider           | `lib/providers/local-cli.mjs`           | ADR005               | Exists                                  |
| Provider registry            | `lib/providers/registry.mjs`            | ADR005               | Exists                                  |
| Meshloop provider (proposed) | `lib/providers/meshloop.mjs` (proposed) | ADR012 (proposed D3) | **Not yet implemented.** S7 deliverable |

---

## Layer: Interface / Composition

| Surface                      | File                                    | ADR            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI composition              | `bin/cli.mjs`                           | ADR002, ADR003 | Exists                                                                                                                                                                                                                                                                                                                                                                                                                |
| Integration lifecycle script | `scripts/integration-lifecycle.mjs`     | ADR001, ADR004 | Exists. **S0 changes:** `DEFAULT_CONFIG` exported; `SAFE_KEYWORDS` allowlist added; `REFERENCE_ONLY_KEYWORDS` retained; `validateReferenceKeywords()` rewritten with empty-array, whitespace-trim, allowlist enforcement; `loadIntegrationLifecycleConfig()` throws (not silent fallback) for invalid explicit override; `parseIssueReferences()` adds word-boundary anchors and enforces validation at call boundary |
| Config authority validator   | `scripts/validate-config-authority.mjs` | ADR004         | Exists. Checks field-level ownership; keyword semantic correctness is enforced by `validateReferenceKeywords()` in integration-lifecycle.mjs                                                                                                                                                                                                                                                                          |

---

## Layer: Public Contracts / Guidance

| Surface                   | File                                                                             | ADR  | Notes                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| ADR 001–009               | `docs/adr/001–009-*.md`                                                          | Self | Accepted (ADR007 accepted with high-assurance/release acceptance pending per plan §Evidence) |
| **ADR 010** (proposed D1) | `docs/adr/010-delegation-origin-assurance-and-admitted-action-race-semantics.md` | Self | **Proposed.** Requires Codex evidence + Grok architecture review before acceptance           |
| **ADR 011** (proposed D2) | `docs/adr/011-versioned-persistence-and-portable-continuation.md`                | Self | **Proposed.** Requires Codex + Grok protocol review before acceptance                        |
| **ADR 012** (proposed D3) | `docs/adr/012-execution-provider-and-observability-boundaries.md`                | Self | **Proposed.** Requires Codex + Grok boundary review before acceptance                        |

---

## Duplicate authority check

No duplicate authority found. Each contract surface has exactly one owning module.
`validateConfigAuthority()` enforces field-level ownership between `sdlc.config.json` and
`agent-workflow.config.json`. Semantic keyword correctness within
`integrationLifecycle.referenceKeywords` is enforced exclusively by
`validateReferenceKeywords()` in `scripts/integration-lifecycle.mjs`.

---

## S0 deliverable summary

| Deliverable                                                                                 | File                                                 | Status          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------- |
| Config correction: `Refs` → `Closes`                                                        | `agent-workflow.config.json`                         | Done            |
| `SAFE_KEYWORDS` allowlist                                                                   | `scripts/integration-lifecycle.mjs`                  | Done            |
| `validateReferenceKeywords()` — allowlist, empty-array, whitespace-trim, throw-not-fallback | `scripts/integration-lifecycle.mjs`                  | Done            |
| `parseIssueReferences()` — word-boundary anchors, use-boundary validation                   | `scripts/integration-lifecycle.mjs`                  | Done            |
| Focused regression tests with real temp-dir config fixtures (29 total)                      | `scripts/__tests__/integration-lifecycle.test.mjs`   | Done            |
| Proposed ADR D1                                                                             | `docs/adr/010-*.md`                                  | Done (Proposed) |
| Proposed ADR D2                                                                             | `docs/adr/011-*.md`                                  | Done (Proposed) |
| Proposed ADR D3                                                                             | `docs/adr/012-*.md`                                  | Done (Proposed) |
| This ownership map                                                                          | `docs/process-autonomy/s0-contract-ownership-map.md` | Done            |

Historical runs unchanged. No commits, push, GitHub mutations, global installs, or Meshloop edits.
