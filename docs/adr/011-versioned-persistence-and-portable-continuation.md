# ADR 011 — Versioned persistence and portable continuation

**Status:** Proposed
**Date:** 2026-09-25
**Slice:** S0 (baseline map), full implementation in S4a/S4b/S5
**Process-autonomy plan ref:** docs/maintainers/process-autonomy-execution-plan.md §Architecture decisions (D2)

> [!NOTE]
> This ADR is **proposed**, not accepted. It becomes accepted only through the workstream's
> review policy (Codex SDLC evidence review, Grok protocol review for S4b, and any required
> human candidate review). Do not treat the proposal as an implementation approval.

## Context

The current authoritative ledger is the GitHub-isolated-ref event log, reduced by
`lib/core/run-state.mjs`. There is no explicit version field on the event format, no tested
segment boundary or compaction mechanism, and no portable continuation bundle that a fresh
instance can use without the originating chat session.

Key observations from the execution plan:

- A 10,000-event replay against a reference reducer must remain correct across versions and
  crash-recovery scenarios (S4b acceptance criterion).
- A fresh checkout without chat history or scratch must reconstruct the exact authority/state
  and refuse stale-writer or ambiguous-liveness resumption (S5 acceptance criterion).
- Local cache and projections are derived, not authoritative. GitHub issue/PR comments are
  human projections, updated only on substantive changes.
- Mtime/inode alone is not proof of unchanged policy or source bytes (S4a).

## Decision

1. **Explicit format version.** Every event written to the authoritative ledger carries a
   `schemaVersion` field. Readers that do not recognize a required version fail with a clear
   diagnostic rather than misinterpreting records silently.

2. **Immutable event segments.** After a declared segment boundary, events in that segment
   are frozen. New events open a new segment. Segment identifiers carry the parent segment
   digest for chain integrity. Source acknowledgment of a segment permits compaction of its
   events into a summary; elapsed time alone is not sufficient to compact unacknowledged
   evidence.

3. **Immutable-revision read cache.** A cached source read is valid only if the authoritative
   revision matches the revision at cache time. Mtime, inode, or content-hash alone is
   insufficient if the source can be rewritten. A cache miss forces a re-read; a cache hit
   must verify the authoritative revision before trusting it.

4. **Portable continuation bundle.** A continuation bundle records: current branch and commit,
   run/writer revision, grant and plan/policy refs, pending operations, open rework ledger,
   findings, and the next runnable slice. A fresh instance consuming the bundle must be able to
   reconstruct exact authority and state within the declared resume latency target without
   requiring the originating session or chat history.

5. **Writer generation fencing.** One accepted writer generation per run. A stale writer is
   blocked; an unknown-liveness writer is blocked. A new session must prove continuation
   authority (by re-resolving the grant and acquiring the current writer revision) before
   advancing any run state.

6. **v1 history readability.** Existing v1 events remain readable indefinitely. No migration
   silently discards or reinterprets v1 records. A v2 reader must prove it can replay v1
   history to the identical reduced state before any v2 format is written to the authoritative
   ledger. The preview command (`agentflow-sdlc release-plan`) verifies format compatibility
   without writing.

7. **Batch record limits and no silent truncation.** Per-batch event limits exist; exceeding
   them produces a diagnostic and a bounded checkpoint/suspend, never silent truncation or a
   claimed-complete-but-incomplete batch.

## Consequences

**Positive:** Portable continuation removes the dependency on a specific chat session or
machine state; version fencing prevents silent format drift; segment immutability preserves
audit evidence independently of telemetry spool eviction; v1 history remains readable without
data migration.

**Negative:** Segment boundaries and version fields add write overhead; continuation bundles
must be maintained and kept current; the immutable-revision cache adds one round-trip on
cache miss.

**Open at proposal stage:**

- Exact segment size and event-count thresholds (S4b deliverable).
- Bundle serialization format and integrity mechanism (S5 deliverable).
- Whether the segment summary produced at compaction is itself an authoritative or derived
  record (Grok protocol review required before S4b acceptance).
- Cross-machine liveness detection capability boundary (S5; requires a capable provider).
