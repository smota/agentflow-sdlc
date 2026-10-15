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
`operationOptions.authority` naming the replacement owner and next generation. Only its
source revision is refreshed after transfer. The adapter never invents authority or rewrites
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
