# Portable continuation and bounded context — S5

`createContinuationBundle` and `reconstructContinuation` in
`lib/application/continuation-service.mjs` enable fresh-instance continuation of
governed runs without relying on past conversation transcripts or scratch files.

## Architecture & Guarantees

1. **Derived index, never authority**:
   The continuation bundle (`continuation-packet-v1`) records git metadata, writer
   identities, grant digests, pending operations, rework items, and artifact references.
   It acts as a lightweight pointer; the authoritative ledger remains the single source
   of truth.

2. **Bounded context**:
   The control packet size is strictly bounded at `<= 32 KiB`. Heavy payloads
   (source files, test logs, coverage datasets) are referenced as content-addressed
   artifacts with SHA-256 digests and retrieved separately via resolvers.

3. **Fresh checkout reconstruction**:
   When a fresh agent resumes in a clean checkout:
   - Validates the packet envelope and schema version.
   - Re-reads the authoritative run store and verifies `store.revision === bundle.runRevision`.
   - Verifies that the previous writer's liveness is definitively `stopped: true`.
     If liveness is unknown or active, resumption is refused to prevent split-brain.
   - Verifies the referenced grant on the authoritative ledger (unexpired, unrevoked,
     matching envelope digest).
   - Re-resolves all referenced artifacts and cryptographically verifies digests.
     Any missing or tampered artifact refuses resumption.
   - Returns verified reconstruction state with next generation writer authority.

4. **Generation fencing**:
   The newly acquired writer session advances `generation = priorGeneration + 1`.
   Any subsequent append attempt by an obsolete/stale writer is rejected by generation
   fencing.
