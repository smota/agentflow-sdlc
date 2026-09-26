# Local pending audit journal

`createPendingAuditJournal` in `lib/sources/pending-audit-journal.mjs` is a bounded
local adapter for evidence awaiting authoritative source acknowledgment. It is
separate from telemetry storage and the run source. A successful local write never
means that GitHub admitted an operation or that an external effect succeeded.

## API and wiring order

```js
const journal = createPendingAuditJournal({
  directory: hostSelectedPrivateDirectory,
  verifyAcknowledgment: async ({ event, sourceReceipt }) => {
    // Re-read the authoritative source and verify exact event identity here.
    return {
      acknowledged: true,
      eventId: event.id,
      eventDigest: event.digest,
      sourceRevision: independentlyObservedRevision,
    }
  },
})
await journal.put(admissionEvent, { state: 'pending', reservedBytes: 8192 })
// Only now may the host attempt source admission. It must still await source ACK
// before dispatch; the journal receipt is explicitly non-authoritative.
await journal.put(outcomeEvent, { state: 'unknown', reservationId: admissionEvent.id })
await journal.ack(admissionEvent.id, admissionEvent.digest, sourceReceipt, {
  runId: admissionEvent.runId,
})
const pending = await journal.list()
```

`put(event, options)` requires a sealed version-1 `run-event`; IDs are validated and
never used as paths. It copies input before awaiting anything. Options are:

- `state`: `pending` (default) or `unknown`; an existing business record may advance
  to unknown, never silently return to pending.
- `kind`: `business` (default) or `safety`.
- `reservedBytes`: additional allowance for later required records, committed with
  the initial record. Admission must reserve enough intent/outcome evidence before
  business work begins.
- `reservationId`: consumes a reservation from the same run. It can refer to an
  original pending record or its acknowledged tombstone. An inadequate reservation
  is a denial, not an unbounded allocation.

A repeated event/run ID with the same digest is idempotent. A changed digest fails.
`ack(id, digest, receipt, { runId? })` requires an injected authoritative verifier;
a supplied boolean or receipt alone cannot compact evidence. The verifier must bind
`acknowledged`, `eventId`, `eventDigest`, and nonempty `sourceRevision`. It runs while
the journal writer lock is held. Business ACK replaces the full event with a compact
local tombstone, preserving identity and remaining reservation. Original evidence
must remain in the authoritative source under project retention policy. Unused
reservations and tombstones are conservatively retained for this journal lifecycle;
there is no automatic TTL, eviction or reclamation. Repeated ACK is idempotent.

`list()` includes exact entries, acknowledgment tombstones, used/capacity values,
physical staging diagnostics and durability capability. Safety entries that have
been source-reconciled retain their bytes and are marked `acknowledged`; do not
reinterpret that local mark as a current authoritative source read.

## Capacity and stopping

Business data, envelope/tombstone overhead and outstanding reservations share an
**8 MiB** ceiling. Every write checks that total before promotion. The initial use
also writes and fsyncs a separate **64 KiB** safety reserve: sixteen 4096-byte slots.
A slot includes 73 framing bytes, leaving at most 4023 bytes for the full serialized
stop entry. Only checkpoint, delegated-safety, pause and block events may use those
slots; they cannot carry business admissions or additional reservations.

A business-full error prevents new effects. The host can still persist a bounded
safety event in the existing reserve without creating a new file. Safety records
are immutable: use a distinct stop event for changed status. Source ACK marks a
safety slot reconciled but never erases/reuses it; after sixteen stop records the
reserve fails closed. Create a new journal lifecycle only after reconciling and
retaining the old lifecycle according to project policy. This conservative bound
avoids silent audit eviction.

The reserve is a prewritten local file, not a guarantee against disk failure,
filesystem copy-on-write allocation, storage compression, quota changes or disaster.
Telemetry eviction cannot release, consume or delete journal entries.

## Durability and interruption

Business updates write a uniquely named stage, fsync the file, atomically rename it
over the snapshot, then attempt directory fsync. The previous snapshot remains in
place until promotion. Orphaned stages are retained and listed as recovery-required;
new business writes stop until explicit inspection/reconciliation. Safety writes
remain available when an ordinary business stage is unpromoted.
Atomic replacement temporarily needs space for both snapshots: up to another 8 MiB
in addition to the logical business ceiling. Only one unpromoted stage is allowed;
further snapshot writes (including ACK compaction) stop rather than accumulate more
stages. Physical disk exhaustion can still prevent writes and must deny effects.

Safety slots write the full checksum-framed payload with an uncommitted marker,
fsync, write the one-byte commit marker, then fsync again. A partial/uncommitted or
checksum-invalid slot fails closed and retains its bytes for investigation. The
adapter never guesses that such a frame was acknowledged. A complete committed
frame is readable after process interruption. Safety ACK changes only its state
marker after authoritative verification.

`durability.fileFsync` reports completed Node file fsync. Directory fsync is attempted;
on this Windows host Node can reject directory open/fsync, reported explicitly as
`unsupported-on-this-host`. File fsync plus rename does **not** establish crash-proof
power-loss durability on every Windows/filesystem/storage combination. Tests cover
process termination at concrete write boundaries, not power cuts or controller
failure. This local journal is not a disaster backup or source-admission transaction.

## Locking and containment

An exclusive `writer.lock` serializes put/list/ack across processes. Contention
returns `JOURNAL_LOCKED`; it does not spin, silently steal a lock or treat an old
mtime as proof of death. `recoverLock(expectedOwner)` acquires a separate recovery
lock and checks exact token/PID, same host and an OS `ESRCH` liveness result before
removing the stale writer lock. Live/reused PIDs, `EPERM`, malformed ownership,
foreign hosts and unknown liveness refuse recovery. A crashed recovery lock itself
needs explicit operator investigation; there is no recursive automatic lock theft.
The host should re-resolve run/writer authority before continuing after local lock
recovery. Local recovery never acquires a new authoritative writer generation.

The host selects a dedicated private directory. The adapter checks existing ancestors
and managed entries for symlinks/junctions, checks real-path equality, and uses only
fixed internally generated filenames. It refuses unsupported versions, nonregular
entries, malformed identities and oversized data. The cooperative threat model does
not claim protection against a malicious same-account process replacing filesystem
objects between checks. Host ACLs and execution adapters remain responsible for
that stronger boundary.

## Observed tests

`lib/__tests__/pending-audit-journal.test.mjs` exercises exact fresh-instance recovery,
actual 8 MiB capacity, reserved outcomes, stop writes after business-full, idempotent
ACK/put and conflict denial, source verification, lock contention, malformed/live
lock recovery refusal, junction containment, checksum corruption and orphan stages.
Four child processes terminate after business fsync/rename and safety payload/commit
fsync; the parent verifies retained evidence and explicitly recovers only a proven
dead writer. No test dispatches business work based solely on local journal success.
Service/CLI wiring and source-outage end-to-end behavior belong to the parent S3
integration, not this standalone adapter's test claim.
