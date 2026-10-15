# Native source handoff host boundary

`adapters/openrig/native-handoff.mjs` exports `executeNativeHandoff` for an existing
native run. The host first advances the phase through `createRunService().advance`
with the real acceptance, oracle-assurance and human gates. The bridge consumes that
exact acknowledged `advanced` event; it never initializes a run, advances a phase,
issues a grant, transfers its writer, or maps generation zero to a legacy epoch.
The existing source writer owns the outstanding delivery obligation when a queue
or successor check holds. The synchronous product handoff remains legacy-only.

The caller supplies `service`, immutable `operation`, `body`, current `authority`,
existing `grantId`, finite `nowMs`, current `clock` (default `Date.now`), optional bounded `portTimeoutMs` (1–30000, default
1000), and trusted host callbacks. These are application code dependencies, not
JSON attestation or CLI approval flags:

- `resolveTask({snapshot,operation})` resolves a current source task with
  `verified`, `sourceRef`, `sourceRevision`, and `task`. The native `run-v1` task
  binds `goal`, `runId`, `runRevision`, `sourceRevision`, `owner`, `generation`,
  `revocationEpoch`, `destination` and bounded `touchSurface`. Protected scope also
  requires the independently assigned oracle writer and the existing synchronous
  `resolveOracleAuthority` callback used by oracle admission (the bridge bounds and
  snapshots its result before evaluating admission). The returned
  `assignment` carries that assignment. No declaration alone supplies authority.
- `resolveOperationalPreflightInput` supplies `{sourceRef,binding,input}`, with raw
  `input` passed to the existing operational preflight evaluator. `binding` must
  exactly match `runId`, `runRevision`, `sourceRevision`, `generation`,
  `revocationEpoch` and `operationDigest` from the supplied current source snapshot. It must name exactly the destination seat/rig and source
  owner and verify the actual occupant, execution tuple, readiness and task scope.
  Hook occupant generations and native run generations remain separate identities.
- `dispatchQueue({operation,admission,body})` performs the already-admitted queue
  creation with the exact operation ID and body. It returns matching `qitemId`
  and `destinationSession`;
  mismatched acknowledgements, thrown errors and timeouts remain uncertain. The
  host provides an exact source-bound provider lookup to the run service's existing
  `reconcileOperation` callback. A verified failure does not prove queue absence
  unless its exact provider outcome also contains `queueAbsent: true`; otherwise
  the handoff remains uncertain. A queue acknowledgement never proves acceptance.
- `verifySuccessorAcceptance` independently checks operation/destination/native
  counters/oracle digest and source-recorded typed custody receipt digests. Its
  fresh receipt must bind those exact fields, `qitemId`, `operationDigest`, and
  the same native source `binding` as runtime evidence. This callback
  establishes successor task custody; it does not transfer the native run writer.

The canonical `queue:create` action is an external effect requiring the
`external-action` boundary and an explicit typed issuer policy/grant. It is separate
from `rig:mutate`; no default issuer or business boundary gains permission. The
operation uses the existing delegation shape. Its paths must equal the resolved
source task touch surface. Its `arguments` have protocol
`native-handoff-v1`, `runId`, `goalRef`, `generation`, `revocationEpoch`,
`transitionId`, `transitionDigest`, `fromPhase`, `toPhase`, `destination`,
`bodyDigest` (`recordDigest({body})`), `oracleDigest` (nullable), and sorted
`custodyDigests` from current typed native oracle custody records.

An intent checkpoint containing the immutable operation digest and grant ID is
appended to the existing source chain before admission. Existing source admissions
and the operation journal own replay and provider reconciliation. A crash before
admission may continue from the same checkpoint; an acknowledged or uncertain
admission is reconciled rather than dispatched again. A separate acceptance
checkpoint records independently verified successor custody after provider
confirmation. There is no parallel outbox, lease, ledger, controller or local queue.

This is an injectable host integration boundary, not a deployed OpenRig reader.
The bundled compact runtime collector cannot attest actual execution and therefore
cannot provide positive admission. Missing source/runtime/authority/provider ports
hold honestly. Tests use isolated in-memory source stores and fake host ports:
one fixture performs real governed `service.advance`; separate explicitly seeded
pre-existing phase records exercise phase-3 oracle pin and custody. Those fixtures
are not evidence of a live Dendro run, deployed provider, or accepted upstream fix.
