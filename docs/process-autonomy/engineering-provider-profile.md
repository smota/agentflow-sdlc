# Engineering provider profile — design for S6/S7

Status: proposed profile mapping for #268/#269; not a shipped or qualified interface. Uses ADR004/005 and the current version-1 ProviderBinding and ExecutionReceipt schemas. Source inspected at ec24635. The approved process-autonomy plan and later reviewed implementation determine acceptance.

## Ownership and extension point

AgentFlow owns approved intent, action admission, phase transitions, handover contracts, evidence evaluation and delivery acceptance. An engineering provider owns bounded technical execution, task decomposition, context selection, checks and repair. Provider lifecycle is technical start/inspect/cancel/reconcile/cleanup. It cannot issue SDLC acceptance or widen authority.

The optional adapter implements the existing provider descriptor methods: plan, execute, status, cancel, cleanup and receipt, with declared facets and intent support. It translates neutral engineering requests to Meshloop's public interface. Meshloop does not import AgentFlow contracts, read AgentFlow configuration or require its source store. AgentFlow core does not import Meshloop or read its private SQLite state. A neutral test client exercises the engineering side without AgentFlow; an alternate provider exercises AgentFlow without Meshloop.

Use the existing metadata extension point for profile-specific transport information. Do not invent extra top-level fields in strict v1 schemas. Proposed namespace: metadata.engineeringProfile with id, version, negotiatedCapabilities and bindingRevision. Version the profile separately from the enclosing port. Exact JSON schemas/examples are S6/S7 deliverables and must be validated against both existing schemas and the profile constraints.

## Mapping to current contracts

| Concern                   | Existing owner/surface                                                               | Profile obligation                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intent and scope          | CollaborationIntent and execution intents                                            | Translate only approved scope; technical DAG cannot enlarge it                                                                                                       |
| Provider choice           | ProviderBinding provider/platform/executionTarget/transport/facets/intentResolutions | Bind exact provider identity, proven facets and profile version before dispatch; self-declared support alone is insufficient for enforced controls                   |
| Work identity             | Existing requestDigest, planDigest and source operation identity                     | Bind stable operation ID, candidate/base and scope digests; foreign task/session IDs remain opaque correlation                                                       |
| Provenance                | ExecutionReceipt.actual and boundaries                                               | Preserve requested/effective/enforced/observed distinctions; model null if unverified, never infer from requested model                                              |
| Artifacts                 | inputRefs/outputRefs/validationRefs and digests                                      | Retrieve contained artifacts, verify SHA-256 of exact bytes, bind tested candidate, and retain retrievable references                                                |
| Unknown outcome           | Authoritative run operation journal and provider status                              | Keep pending/unknown state outside terminal v1 receipts; do not fabricate completedAt or a pass receipt when outcome is unknown                                      |
| Technical terminal result | ExecutionReceipt.status pass/failed/blocked/cancelled                                | Pass means technical receipt only; AgentFlow independently validates acceptance. Cancelled requires observed termination; cancellation request alone is not terminal |
| Authority and budgets     | AgentFlow grant/admission use cases                                                  | Provider consumes narrowed execution limits, reports enforcement fidelity, and cannot mint/extend a grant                                                            |
| Observability             | Optional trace context plus plain typed observations                                 | Link traces across attempts; no mandatory backend, high-cardinality metric IDs or raw prompts/source                                                                 |

The existing v1 receipt requires completion timestamps and has no unknown status. Do not force a pending operation into that receipt. Any future receipt-version change needs explicit migration and compatibility tests instead of silently broadening v1.

## Operation semantics

- Preflight validates required profile version, capability proof, executable identity and permitted workspace before effects. Unsupported required facets block; optional omissions are explicit.
- Submit binds a stable idempotency key and immutable request digest to the admitted operation. Repeated key plus same digest returns the original operation; a different digest conflicts. A provider without idempotency must support authoritative outcome reconciliation before retry is allowed.
- Inspect reports running, terminal or unknown technical state without manufacturing SDLC progress. Timeouts are unknown until verified failure or reconciliation.
- Cancel records intent, requests termination only through supported capability, then observes the actual outcome. Completion/cancellation races resolve against provider evidence and the same operation identity.
- Resume re-resolves authoritative run/grant/writer state and the provider operation. Bundle refs alone cannot transfer ownership or restart uncertain work.
- Receipt retrieval is bounded and separate from bulk artifact transfer. Validate schema, provenance, operation/candidate binding, path containment, byte integrity and output completeness before accepting technical evidence.
- Cleanup has an explicit scope and receipt; it cannot delete unacknowledged evidence, arbitrary worktrees or unrelated files.

## Compatibility and release independence

Required version/capability mismatch fails before dispatch. Optional additive fields follow the declared profile extension policy; they are not automatically fatal and cannot silently become authority. Pin tested binary identity and profile version, not just a human-readable product version. Upgrade either product independently within the supported matrix. Neither default install requires the other product or a collector. Adapter-module extraction into a separate package is optional and evidence-driven.

## Validation handoff

The S7 discovery report and approved plan define the full matrix: neutral client, alternate executor, standalone products, integrated happy path, incompatible versions, duplicates, lost acknowledgments, malformed receipts, digest/path attacks, cancel races, stale scope, fresh-instance continuation and telemetry-off parity. Each case records exact candidate/environment/transport and observed result. Mock conformance and live qualification are separate claims. No cases are marked passed by this design document.
