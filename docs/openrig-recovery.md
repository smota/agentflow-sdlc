# Classified OpenRig recovery

`adapters/openrig/recovery.mjs` exports a host integration boundary. It does not install a
watchdog, start a daemon, read credentials, or independently dispatch an OpenRig seat. Compact
OpenRig observations cannot provide its required actual execution and custody evidence.
Missing trusted host readers produce a hold.

`classifyExecutionFailure` accepts structured error code/status and optional response headers.
It distinguishes temporary rate limits, exhausted quota, authentication, unavailable models,
restore integrity, local permissions, local paths, provider availability, and unknown failures.
It never searches usage metadata or narrative text. `Retry-After` seconds or HTTP dates supply
evidenced timing; otherwise provider reset remains unknown. Policy backoff is explicitly
identified as policy timing, not a provider reset prediction.

`recoverExecution` uses the existing run service: `record('checkpoint')` for attempt accounting,
`recoveryPlan`/`resume` for safe writer transfer, and `executeDelegatedOperation` plus
`reconcileDelegatedOperation` for effects. There is no additional ledger or runtime controller.

The operation requires an explicitly granted `rig:mutate` external effect. Its
`arguments.recoveryIncident` is stable and `arguments.recoveryPolicyDigest` equals
`recordDigest(policy)`. Policy contains `maxAttempts` (1–20), numeric absolute `deadlineAt`,
positive `backoffMs`, `portTimeoutMs` (at most 60 seconds), and existing selector inputs under
`fallback`. Source checkpoints bind the policy and count transient backoff attempts too.
Changing models or restarting the caller cannot reset this budget. Typed grants independently
limit dispatched attempts and effects.

The caller supplies explicit current-writer `recovery.checkpointAuthority` and
`recovery.reconciliationAuthority`, transfer `recovery.authority`, and future
`operationOptions.authority` naming the replacement owner and next generation on the first
transfer. A source-bound continuation instead supplies the explicit current owner/generation
and current source revision. Only the source revision is refreshed within the first transfer. The adapter never invents authority or rewrites
the selected principal, grant, policy, route, or operation through caller aliases.

The injected trusted `inspectRecoveryContext` port receives source state, both contracts,
operation, incident and policy digest. Its receipt must bind run ID/revision/generation,
incident, policy and operation digests, both contract digests and fresh numeric `observedAt`.
It verifies authorization, health, checkpoint, custody, reviewer independence, capability
floors, cost policy, quota independence, and named artifact digests. These are trusted host
assertions, not authentication of caller-supplied JSON. No CLI flags manufacture a receipt.
Another model on the same exhausted provider route is ineligible. The existing two-level
selector executes only after source verification of a safe continuation boundary, with
explicit healthy platforms; unknown health never becomes success.

The source service verifies the old writer stopped, workspace integrity, pending operations,
source revision and generation transfer. Dispatch return is not confirmation. Exact persisted
operations are reconciled; unknown outcomes remain held without blind redispatch. Confirmed
replay is held for explicit readback instead of reusing an old execution receipt as proof.

Final trusted `readback` binds current run revision/generation, incident, operation ID, fresh
time, actual runtime/provider/model/effort/profile and preserved artifact digests. Only this
full path returns `recovered`. Results report acknowledged source effects without raw errors,
credentials, transcripts or provider payloads.

Port waits are bounded. Timeout does not prove an external process stopped or its effect
failed: the host owns process-tree cancellation, and source reconciliation must resolve
ambiguity before another attempt. Held results retain an owner and deadline. Recovery does
not clear publication holds, reset workflow counters or satisfy human review.

Tests exercise the actual run service, conditional memory source, local cooperative typed
issuer, fencing and reconciliation with fake host ports. They prove wiring and source
safeguards, not deployed failover or a production hard security boundary. Live integration
and upstream actual-model observation remain separate adoption requirements.

## Custody after transfer and crash continuation

A source writer transfer advances native generation and invalidates active oracle custody.
Recovery now recomputes the native source projection and checks actual active custody before
transfer and again afterward. Each active receipt must match its original typed
`oracle-custody-recorded` request/event and pass the existing core receipt verifier for the
current run, candidate, oracle digest, generation, and revocation epoch. Counter zero is
valid. Historical author records remain in the source history; they do not become active
custody in a new generation automatically.

The optional trusted `renewOracleCustody({state, authority, incident, operation})` host port
can call the existing `service.recordOracleCustody` through a lawful source resolver. The
callback's return value has no authority. Recovery rereads and verifies canonical source
records; `custodyVerified: true`, a returned receipt, or a missing renewer cannot substitute
for a new source event. Renewal must preserve writer identity, counters, candidate, oracle,
boundary, phase and status. Missing initial custody holds before transfer unless that
explicit governed renewal actually resolves it. Missing post-transfer custody holds
without admission or dispatch. A trusted host reinspection after renewal/transfer must bind
the new current revision and preserve the original named artifact digests.

An existing checkpoint records `recoveryContinuation` version 1 before transfer. It binds
incident/classification/policy, operation ID and digest, original grant, target owner and
writer digest, original/target generation, source candidate/oracle/revocation epoch,
boundary, both execution contracts, and named artifact digests. This checkpoint is an
extension of the existing source ledger, not a separate controller or grant. Source history
must also contain the matching native transfer before current-generation continuation is
accepted.

If a crash occurs after that checkpoint but before transfer, the same charged operation
can finish its one transfer. If the transfer already occurred but admission did not, a
retry matching the source owner, full writer identity and generation skips `resume` and
attempt charging. The caller must supply current-generation authority and a fresh source
revision. Asking for another future generation, another writer, operation, grant, route,
classification, policy, or artifact scope holds. Missing source history also holds. A
persisted operation admission always goes through existing source reconciliation and never
blind redispatch. Final readback is followed by another source revision/custody check, so a
concurrent ownership change cannot be reported as current recovery success.

The anchor deliberately binds one immutable operation per incident. Replacing it after a
failure requires explicit governed replanning with a new incident/policy and applicable
authority; this adapter offers no automatic reset or authority workaround. An unchanged
operation can continue at its already-charged maximum attempt count until its original
absolute deadline. It cannot renew that deadline or rewrite its policy.

The original two #528 RED rehearsals remain unchanged and now pass. Additional fixtures
exercise actual typed source custody renewal, boolean-only renewal rejection, post-transfer
artifact drift, forged projections, missing initial custody, exact pre-admission crash and
current-generation continuation, changed identity/grant, bounded attempt continuity and
concurrent final-readback ownership changes. Their memory store and assignment resolver
are cooperative test fixtures, not deployed provider or independent acceptance evidence.

The quota attempt and its continuation anchor are recorded atomically in one existing
checkpoint, after initial context verification. Losing that write's acknowledgment cannot
strand a maximum-attempt incident between two checkpoints or charge it twice on reentry.
Transient backoff attempts keep their existing independent accounting. Model-route recovery
preserves the exact existing action boundary; changing it requires separate governance.

Run the focused checks with:

```sh
pnpm exec vitest run adapters/openrig/__tests__/recovery.test.mjs adapters/openrig/__tests__/recovery-rehearsal.test.mjs adapters/openrig/__tests__/recovery-continuation.test.mjs adapters/openrig/__tests__/recovery-continuation-adversarial.test.mjs adapters/openrig/__tests__/recovery-continuation-final.test.mjs adapters/openrig/__tests__/recovery-atomic-anchor.test.mjs
```

An independent static advisory pass used actual `claude-haiku-5-5`, requested low effort,
with tools and MCP disabled. It requested changes: the separate attempt/anchor crash gap
and safe-boundary ordering were reproduced as RED tests and corrected; the failed-operation
reason now explicitly requires governed replanning. Core-owned candidate nulls and old-generation
`resumed` event semantics were checked against source. This advisory is not human review or
production acceptance. The implementation author's additional QA is explicitly self-review.

The follow-up static Haiku advisory approved the corrected recovery path; it did not run
tests and did not approve deployment or human acceptance. Its two nonblocking suggestions
were incorporated: checkpoint payloads clone the local anchor, and both failed-operation
paths explicitly require governed replanning. Actual model was `claude-haiku-5-5`, low
effort requested, tools/MCP disabled; combined advisory cost was $0.01699490.

## Optional quota checkpoints and fallback (`lib/config/quota-policy.mjs`)

Proactive quota monitoring (`quotaControl`) is disabled by default (`enabled: false`) and
evaluated via `evaluateSeatQuotaControl` (re-exported by `adapters/openrig/platform-fallback.mjs`)
or `agentflow-sdlc distribution quota`. When enabled, it evaluates `weekly` and `five-hour`
subscription windows (`thresholdRemainingPct: 25` example precedent) under a `most-restrictive`
precedence rule, classifies observations as `supported`, `approximate`, `stale`, or `unavailable`,
and rejects context-window token counts or transcript text as quota evidence.

Crossing a quota threshold mid-phase requires reaching a safe checkpoint first
(`QUOTA_THRESHOLD_REACH_CHECKPOINT`). At a safe checkpoint, fallback selection marks the shared
subscription pool unavailable, preserves `excludedFamilies` for reviewer independence, and retains
`owner`, `taskId`, `worktree`, `oracleCustodyDigest`, and `artifactDigests`. If no eligible
fallback exists or concurrent-writer, cooldown, or switch-count guards trigger, the seat parks
cleanly (`park-and-checkpoint`) without mutating saved policy or granting publication authority.
