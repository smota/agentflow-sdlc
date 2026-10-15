# AgentFlow product squad

Generic product base for one project. `agentflow-sdlc adapters install openrig` copies it to the OpenRig spec library. `agentflow-sdlc adapters squads provision openrig --kind product` makes the per-project copy.

Seats:

| Seat         | Role            | Phase |
| ------------ | --------------- | ----- |
| `pm.manager` | Product manager | 0     |
| `pm.analyst` | Analyst         | 1     |

The method play for the product manager is JTBD: job, circumstances, and desired progress, with no prescribed solution. The analyst writes the acceptance the delivery squad receives. Roles live in `roles/product-manager/ROLE.md` and `roles/analyst/ROLE.md`. This bundle does not replace those files.

Presets use the same names as the delivery bundle and a different seat map. `balanced-grok-lead` is the recommended preset.

## Handoff custody and recovery

`handoff step` records an operation in the existing handoff outbox before appending its phase.
Retries reuse the original phase key and the queue's supported `--id` retry identity. A queue
exit code of zero means **submitted**; it does not prove successor custody. Submitted and
uncertain records remain in the outbox, with the existing run/store, epoch, fence and oracle
owner preserved. A submitted replay checks custody without sending another queue create.

A host using `executeHandoffStep` MUST supply `resolveWorkflowBinding(options)`. This is a trusted
source adapter, not a caller-provided approval flag. It MUST read the existing authoritative run
and return verified `goal`, `runId`, `storeRef`, `epoch`, `minimumEpoch`, `fencingToken`,
`oracleOwner` and `oracleDigest`. Epochs and fencing tokens MUST be positive safe integers.
Missing or changed source bindings hold execution; recovery MUST NOT create a replacement ledger.
The host MUST also provide `appendPhase(options)` and enforce the supplied `options.workflowBinding`
atomically against its authoritative store before appending. A caller declaration is not enforcement.
The existing CLI does not yet provide that source adapter and consequently holds `handoff step`
with a source-gap explanation. `handoff deliver`, busy holds and read-only listing are unchanged.

An optional trusted `verifySuccessorCustody(record)` adapter may mark completion only with verified,
accepted evidence matching queue identity, destination, run, epoch, fence and oracle custody.
The bridge retains that receipt rather than deleting the recovery evidence. A queue wake/claim
receipt by itself is not acceptance. No unsupported OpenRig readback API is assumed.

Distinct operations use their original `--key`; when several operations share a goal and phase,
recovery requires that key. Existing unaccepted obligations are never overwritten.

Operations use a cooperative exclusive lock with owner PID, host and start time. A crashed owner's lock MUST NOT be removed because
of age; establish that the owner stopped before recovery. Pre-upgrade outbox records are preserved
and require explicit source/custody reconciliation; the bridge does not silently migrate their
missing identity or fabricate epoch one.

`loadConfiguredRunSource({ root, runId, client })` in
`lib/application/configured-run-source.mjs` provides read-only source observation for integration.
It shares canonical configuration and existing store selection with `run` commands, requires an
injected GitHub client, and never initializes a missing run. It returns native generation and
revocation counters unchanged, plus explicit gaps for unbound bridge authority and oracle custody.
These observations do not themselves authorize dispatch or provide a fenced phase append adapter.
