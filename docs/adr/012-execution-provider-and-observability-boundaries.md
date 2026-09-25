# ADR 012 — Execution-provider and observability boundaries

**Status:** Proposed
**Date:** 2026-09-25
**Slice:** S0 (baseline map), full implementation in S1/S2/S6/S7
**Process-autonomy plan ref:** docs/maintainers/process-autonomy-execution-plan.md §Architecture decisions (D3)

> [!NOTE]
> This ADR is **proposed**, not accepted. It becomes accepted only through the workstream's
> review policy (Codex integration review, Grok boundary/failure-semantics review, and any
> required human candidate review). Do not treat the proposal as an implementation approval.

## Context

ADR 004 establishes that AgentFlow owns the portable SDLC domain and delegates execution to
harnesses through versioned, capability-based ports. ADR 005 defines `CollaborationIntent`,
`ProviderBinding`, `ExecutionReceipt`, and `SourceAdapter` contracts.

The execution plan (D3) adds three missing pieces to those contracts:

1. **Telemetry**: There is currently no structured observability layer. Run/session/source HTTP
   requests, context bytes, and acceptance events are not correlated under a common identity.
   The absence of telemetry must not affect workflow decisions.

2. **Budget enforcement**: There is no explicit per-attempt budget tracked against the
   authority grant. An exhausted work budget or external-effect budget should deny new business
   effects while still permitting a bounded safety checkpoint.

3. **Provider capability negotiation**: `ProviderBinding` currently selects a provider by
   declared capabilities, but hard budget ceilings cannot be claimed without a named provider
   that can independently enforce them at issuance. Unknown or incapable providers may use
   advisory limits only.

## Decision

### Observability

1. **Typed observation domain.** AgentFlow emits typed plain observations (`RunObservation`,
   `SourceObservation`, `DispatchObservation`) from domain logic. The OTel SDK and OTLP
   exporter live only in the `lib/observability/` adapter layer; domain code never imports
   SDK types.

2. **OTel adapter.** `lib/observability/otel.mjs` wraps the SDK and implements the
   observation port. A local buffer (`lib/observability/local-buffer.mjs`) stores observations
   for disconnected sessions within the declared bounds (32 MiB spool, 7-day local retention).

3. **Correlation.** Every observation carries `run_id`, `session_id`, `attempt_id`, and
   `operation_id`. Long runs use per-session/attempt traces linked by durable run identity.
   Candidate/plan/policy/grant digests are linked attributes, not unbounded metric labels.

4. **Attribute allowlist.** Source code, prompts, transcripts, credentials, absolute private
   paths, and full commands are excluded by default. Token counts are numeric allowlisted usage
   fields, distinct from secret access tokens.

5. **Exporter off by default.** No OTLP collector is required. The exporter is disabled until
   configured; its absence has no effect on workflow decisions, acceptance, or authority.

6. **Telemetry vs audit separation.** Telemetry spool eviction never touches audit records.
   Mandatory audit records occupy the authoritative source and a separate bounded pending-audit
   journal (8 MiB + 64 KiB stop-record reserve). If audit capacity is insufficient, new
   business effects are refused; only the reserved safety checkpoint slot remains usable.

### Budget enforcement

7. **Budget fields in the grant.** A `DelegationGrant` (see ADR 010) includes: max work
   attempts per task, max external-effect count, bounded escalation allowance, and a reserved
   safety-checkpoint budget that cannot be consumed by candidate work.

8. **Exhaustion semantics.** When the work or external-effect budget is exhausted, every new
   business effect is denied. The reserved checkpoint/reconciliation budget remains available
   for safety operations only and cannot be expanded or consumed by the candidate.

9. **Hard vs advisory ceilings.** A hard budget ceiling requires a named, proven provider that
   can enforce it at issuance and revalidate at admission. Without such a provider, the budget
   is advisory (tracked and reported, but not guaranteed in-flight). Advisory-only fidelity
   must be disclosed explicitly in the grant and the approval summary.

### Provider capability negotiation

10. **Capability preflight.** Before dispatching any harness execution, the provider adapter
    runs a functional capability preflight: explicit target/model declaration, timeout/permission
    scope, and usage limit probe. Missing or unsupported capabilities produce a diagnostic before
    dispatch, not a silent failure mid-execution.

11. **Fallback must satisfy the same envelope.** If a provider falls back to an alternative
    within an allowed family/tier, the fallback must satisfy the same capability envelope
    declared in the grant. A fallback that cannot satisfy the envelope checkpoints rather than
    proceeding silently.

12. **Meshloop as an optional execution adapter.** Meshloop may supply `execution` and
    `lifecycle` capabilities through a versioned neutral contract profile (see S7). AgentFlow's
    core does not import Meshloop, require its service, or read its internal state. The adapter
    knows both sides; the core knows neither. Absent Meshloop: direct execution with a capable
    provider.

13. **Provider receipt does not imply process acceptance.** An execution provider returning a
    technical success (`ExecutionReceipt`) does not advance any SDLC gate. Gate advancement
    requires AgentFlow's own evidence evaluation. The receipt is an input to that evaluation,
    not its conclusion.

## Consequences

**Positive:** Domain code remains observable without coupling to the OTel SDK; telemetry
absence is safe by construction; budget exhaustion is a first-class denial, not an unchecked
overflow; provider capability gaps surface before dispatch; Meshloop remains substitutable.

**Negative:** The adapter layer adds indirection; local telemetry buffer adds memory and disk
overhead; advisory-only budget fidelity must be disclosed prominently; capability preflight
adds latency to each dispatch.

**Open at proposal stage:**

- Exact OTel semantic convention version pins for GenAI attributes (S1 deliverable; use
  stable attributes, pin developmental ones explicitly).
- Telemetry overhead measurement (target ≤5% p95 vs disabled; S1 acceptance criterion).
- Specific provider capability matrix for Meshloop integration (S7 deliverable; Grok boundary
  review required before S7 acceptance).
- Whether `local-cooperative` assurance is sufficient to claim advisory budget enforcement
  (expected yes) or hard ceiling enforcement (expected no; see ADR 010).
