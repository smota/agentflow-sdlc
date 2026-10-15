# Verified OpenRig mutations

A configuration preview is not a runtime change. `adapters/openrig/mutation.mjs` offers a bounded host integration for applying an exact plan through the existing source-backed run service. It does not install readers, alter daemon state, grant permissions, or start agents by itself.

`planRigMutation` resolves desired contracts through `planRigExecution` and returns an immutable, sealed plan: affected seats, field deltas, required restarts and permissions, source/config fingerprints, native workflow preservation, and compensating rollback obligations. `effects: []` means preview only. Unknown workflow or executable observation produces explicit `admissionHolds`; it never fabricates generations or custody. An offline lifecycle caller can show this preview without an operational host.

A host integration follows these steps:

1. Resolve the actual source workflow and installed configuration. Native `run-v1` binds run ID, owner, source revisions, generation and revocation epoch; zero is valid. Oracle digest and custody must be explicit. A pin's `pinnedBefore` role is not its author or custodian. Unknown custody for a pinned oracle holds mutation.
2. Use `fingerprintRigMutationHost` with explicit candidate input paths and executable to reuse the existing workspace and process identity readers. Preserve checkpoint/custody evidence and publication holds. No reader may obtain authority from a caller's boolean or a configured model pin.
3. Resolve a current typed grant explicitly permitting `rig:mutate` at `external-action`. Existing `edit` grants do not gain that capability. `createRigMutationOperation` binds the exact plan, destination, expected and desired config digests, affected seats, restart list, preservation and candidate checks/review.
4. Call `applyRigMutation` with the source-backed run service, current authority, grant, trusted `inspectContext`, and bounded `dispatch` adapter. The inspector must authenticate source records, resolve current workspace/config/executable fingerprints, verify the checkpoint and stopped prior writers, and preserve native authority/custody. It runs before admission and again after asynchronous authorization, immediately before dispatch. No default production inspector or dispatcher is supplied.
5. Treat command success as `submitted`. Plug `createRigMutationReconciler` into the run service's existing `reconcileOperation` port and invoke `reconcileRigMutation`. Only a fresh, source-bound readback for the exact operation ID and payload digest can confirm actual config, canonical model/route/effort/profile, usable replacement occupant and preserved workflow state. A terminal operation records historical confirmation; it is not an ongoing health guarantee.

Ambiguous dispatch stays unknown. Repeating the admitted operation ID returns reconciliation-required and never restarts seats again. All durable admission, operation and reconciliation records remain on the existing run source; this adapter creates no second operation ledger.

Rollback is a new, separately approved compensating operation produced by `planRigRollback`, using current source state and installed effects. It restores the previous configuration while preserving current workflow history, native counters, oracle custody and publication holds. It does not roll back the workflow ledger. A matching observed replacement yields `rollback-verified`; authoritative failure yields `rollback-failed`; missing readback remains `rollback-unknown`. Partial effects are referenced by source, count and digest rather than copying arbitrary logs into bounded safety records.

The implementation is exercised with the real run service and GitHub source adapter over an injected fake transport and explicit cooperative fixture issuer. Those tests are not production authorization, human review, or proof that an installed OpenRig/Pi integration supports actual model readback. Until supported host readers and explicit authority are available, installed mutation remains held. High-assurance human security and acceptance review on the open PR remains required before merge.

The mutation host must report supported atomic guards from a versioned source capability record: `source-revision-cas`, `occupant-cas` and `executor-digest`. The admitted operation carries the expected installed revision, incumbent identities and executable fingerprint. A production dispatcher must enforce those preconditions atomically with its effect; the run source's CAS alone cannot serialize an unrelated manual runtime writer. Missing supported guards holds application rather than treating a pre-dispatch check as atomic enforcement. No such runtime guard implementation is installed by this change.

Current incumbents must still match preview identities before dispatch. Successful readback must contain the complete planned roster with no extra occupant. Compensating application requires the exact original source operation to be terminal and the target to match its recorded preimage. Native custody is compared with the canonical `state.oracleCustody` projection, whose source reducer validates the original request and receipt. Publication holds are source-resolved effective policy facts; they are not fabricated native run fields.

## Public installed-spec preview

Use the public lifecycle command to compare an existing installed spec with the desired source
execution contracts without contacting OpenRig or changing files:

```bash
agentflow-sdlc adapters squads mutation-plan openrig --kind delivery --rig existing-rig-id PROJECT /path/to/project --json
agentflow-sdlc adapters squads mutation-plan openrig --kind all PROJECT /path/to/project --json
```

A single kind accepts an explicit `--rig` to preserve an existing ID; without it the ordinary
project squad naming convention applies. `--kind all` uses the existing delivery, product and
steering project IDs and rejects `--rig`. All selected installed `rig.yaml` files must exist.
A missing or malformed spec is reported rather than provisioned or silently reconstructed.

The before text and source revision come from the actual installed YAML bytes. Before contracts
contain literal installed fields; recognized Pi transport prefixes are normalized without guessing
a gateway from a model namespace. Absent fields remain null, and a generated contracts sidecar is
not treated as an observation. The desired side uses the shared canonical execution resolver.

Every result is explicitly **held**, with `effects: []`, `workflowAnchor: null` and
`executorIdentity: null`. This preview cannot attest live occupants, current run custody, executor
identity or runtime compare-and-swap support. It writes no spec, bridge, home or service state and
launches no child process. There is no public apply command: a future apply host must satisfy the
existing source-authorized mutation contract, including fresh CAS checks and human gates.
