# Process autonomy: full acceptance reconciliation

Audit date: 2026-09-28. Subject: AgentFlow development
`b0b01cb20afd716a4c1692807a9a90237b57b7b0` (PR #298).
Tracking: [#299](https://github.com/smota/agentflow-sdlc/issues/299).
Original contract: [execution plan](process-autonomy-execution-plan.md), A1-A9,
S0-S9 including S4a/S4b, five adoption journeys and Meshloop M1-M6.

## Decision and scope

**The original plan is not delivered.** All nine aggregate acceptance criteria remain
partial or unqualified. Existing regression success is valuable, but the largest gap
is production integration, not merely missing live measurements. Several exposed or
isolated recovery/verification paths also have correctness defects.

This reconciliation preserves the original requirements. It changes the remaining
execution order: correct authority/recovery and receipt integrity, connect the public
governed journey, then qualify performance and adoption. Optimizing append alone
cannot complete the project.

Reviewed: public CLI composition, run/delegation/publication/recovery use cases,
source adapters and migration, telemetry/export/analysis, harness and Meshloop
adapters, relevant tests and documentation, policy consistency, package/CI evidence.
Three bounded read-only Codex helpers collected evidence; the parent inspected
callers and reproduced harness/privacy findings. This is same-platform review,
not a new Agy/Grok council or certification. No product changes, live source writes,
model execution, installed skill edits or Meshloop modifications occurred in this audit.

The current source was fetched and pinned. The primary checkout's older branch and
pre-existing untracked runtime folders were preserved. Meshloop observations remain
historical unless explicitly identified below; its complete codebase was not audited.
This is exhaustive coverage of the named acceptance requirements, not proof that every
function is defect-free or that a missing evidence record can never exist elsewhere.

## Evidence levels

- **Reachable:** public product composition invokes the behavior.
- **Library:** implementation exists without a supported production caller.
- **Fixture:** tested scenario uses controlled source/provider/liveness substitutes.
- **Qualified:** the exact declared real environment/path has recorded behavioral proof.

A green test or a digest alone does not establish actor identity, complete workflow
coverage, actual installation, remote durability or independent human acceptance.

## A1-A9 acceptance matrix

| Criterion                                          | Current evidence                                                                                                                                                 | Status and missing acceptance                                                                                                                                                                                                | Remaining work                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A1 Coherent authoritative run                      | Run service persists admission, planned/submitted and reconciled events; existing CLI runs freeze/verify/advance/publish through its older composition.          | Partial. Delegated actions are not connected to the public run; a sequence of GitHub comments/commits cannot substitute for its event chain.                                                                                 | #301, #300; actual adapter effects, exact-candidate evidence and role advancement in one run.                                  |
| A2 Scoped delegated authority                      | Typed issuer decisions, narrowing, expiry, candidate checks, budget and non-force source admission have meaningful library/race tests.                           | Partial library/fixture. CLI uses Boolean authorization and has no grant UX. Trusted-host and hard currency/token ceilings explicitly remain unsupported.                                                                    | #301; supported host binding, issue/resolve/revoke UI, action accounting and real assurance proof. Preserve unsupported modes. |
| A3 Fresh-instance continuity                       | Run recovery has authoritative generation checks; continuation verifies exact artifact bytes and packet bound. Separate top-level handoff/resume commands exist. | Partial with P1 defects. Portable summaries can omit pending work; top-level resume fabricates a packet and calculates a local lease, rather than reconstructing source state. No complete clean-root materialization proof. | #300, #297, #301; one source-backed recovery path and real separate-process/root qualification.                                |
| A4 Measured source/context savings                 | v1 warm cache rechecks ref; publication coalesces unchanged remote projections. Repeated-read fixture reduces four calls to one.                                 | Not accepted. No integrated 10k workload HTTP/context comparison, p50/p95 or accepted-delivery denominators. Segmented append repeatedly processes full history.                                                             | #297, #303; retain baseline and prove both 50% targets or explicitly disposition them.                                         |
| A5 OTel decision parity                            | Optional OTel reaches CLI; actual localhost trace/metric export, offline storage and bounded queue tests; fixture decision parity across enable/disable/offline. | Partial. Privacy allowlist has a latent raw-string leak; production context/usage/attempt coverage and analytics are incomplete. Integrated parity and 5% p95 overhead unqualified.                                          | #303 and #301; privacy regressions, real producers/links, complete workload parity and overhead report.                        |
| A6 Replaceable engineering / Meshloop independence | Optional registry inclusion, strict Meshloop envelopes, bounded subprocesses, byte retrieval and separate technical gate. Historical neutral fixture exists.     | Partial. Generic dispatcher has no product caller and incompatible result handling; shared direct/alternate/Meshloop suite and current live capability matrix absent.                                                        | #302; neutral schemas/translations and M1-M6 completion, separate Meshloop change scope.                                       |
| A7 Interrupted pilot safety                        | S9 fixture genuinely exercises grant/admission, two effects, replay/revoke/stale writer denial and source ACK.                                                   | Fixture-only. Journal is populated after source success; no write-ahead outage/crash window, real provider or live source safety proof.                                                                                      | #301, #300, #304; supported kill/lost-ACK/revocation/exhaustion matrix with no new effects or invented outcomes.               |
| A8 Consistent shipping                             | PR #298: 1,061 tests and six OS/Node CI jobs passed; package parity and packed delivery/recovery smoke passed.                                                   | Partial. Package inclusion does not make new library journeys callable. Policy and adoption guidance contradict source/each other; engineering profile remains proposed.                                                     | #304 plus corrected public composition/schema/docs; final exact-candidate package journey and CI. Release is excluded.         |
| A9 Cold adoption and continuation                  | Runtime-neutral onboarding CLI plan/apply/verify/repeat tests, ownership refusal and project/runtime/governed readiness distinctions exist.                      | Partial. No complete published-entrypoint cold-reader adoption -> approve -> execute -> interrupt -> resume record; S8 matrix contains unsupported/unsafe instructions.                                                      | #304 after #300-303/#297; five journeys with actual commands, interventions, timing and recovery evidence.                     |

## Slice reconciliation

| Slice                           | What remains useful                                                                                   | What prevents original acceptance                                                                                                                                                                                                                                         | Disposition                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| S0 Lifecycle/baseline/ownership | Safe close-keyword validation and Refs exclusion are reachable and tested.                            | Implements/Closes defaults match the plan; ADR010-012 remain Proposed and the ADR index stops at006. Standard self-review policy conflicts with guiding principles' dual-control mandate. Historical run and ADR map need explicit disposition, not reconstructed events. | Retain lifecycle code; reconcile ADR status and review policy in #304. No blanket S0 completion claim. |
| S1 Telemetry                    | Pinned SDK, real local OTLP export, bounded queue/spool, fixture parity.                              | HTTP vs gh-call measurement, context/attempt coverage, privacy fields, retry/analysis dimensions and comparative baseline.                                                                                                                                                | #303.                                                                                                  |
| S2 Authority                    | Typed cooperative issuer, source-conditional admission, narrowing and reserve tests.                  | Public approval binding, real issuance qualification and supported destination UX; stronger assurance/hard limits remain unsupported.                                                                                                                                     | #301; qualify supported cooperative mode without claiming trusted host.                                |
| S3 Governed actions             | Admission-before-dispatch and exact outcome library APIs; publication has no-blind-retry protections. | Actual adapters/phase progression, durable pending journal and source-down safety composition; through-merge acceptance unqualified.                                                                                                                                      | #301, #300.                                                                                            |
| S4a Cache/projection            | Fresh-ref bounded immutable cache and unchanged projection coalescing.                                | Comparative request/context target per accepted checkpoint/delivery.                                                                                                                                                                                                      | Retain protections; #303 measurements.                                                                 |
| S4b Segmented state             | Seeded 10k exact replay, segment integrity, bounded append/CAS/migration fixtures.                    | Missing tail/snapshot acceptance, uncertain migration ACK, repeated history work, no production selection/migration entrypoint.                                                                                                                                           | #297, correctness before performance/integration.                                                      |
| S5 Portable continuation        | 32 KiB sealed packet, raw-byte hashes, source revision/liveness checks.                               | Authoritative summary mismatch, actual Git/artifact materialization, public interface and fresh-process/root test; parallel handoff path.                                                                                                                                 | #300 with #301/#297.                                                                                   |
| S6 Harness contract             | Context bound, some negative fixtures, existing local provider.                                       | Empty/running false success; wrong artifact hash; receipt incompatibility; declaration-only capability/model handling; no governed caller.                                                                                                                                | #302.                                                                                                  |
| S7 Optional engineering         | Meshloop-specific corrections and independent public CLI boundary.                                    | Current neutral profile/schema, shared conformance, complete live/fault/version/host matrix and M1-M6 index.                                                                                                                                                              | #302; Meshloop implementation remains separately scoped.                                               |
| S8 Approve-once/adoption        | Improved onboarding and documented cooperative limitations.                                           | Fake-grant journey assertions, missing source-skill test silently skipped, pseudo CLI actions and unsafe recovery guidance.                                                                                                                                               | #304 plus #301.                                                                                        |
| S9 Pilot/retrospective          | Honest 14-event, two-dispatch memory fixture and exact-candidate regression CI.                       | Real interruption/source/provider, docs-led journey, quantitative comparison and final required architecture/acceptance evidence.                                                                                                                                         | #304 after prerequisites; fixture pass is not delivery.                                                |

## Findings and source anchors

Anchors below refer to the pinned audit revision. Line numbers are navigation aids;
future implementation must revalidate the relevant revision and callsites.

### P1: exposed recovery is not authoritative and can delete a live lock

`bin/cli.mjs:937-985` prints a generated handoff, but top-level resume constructs
`mockPacket` and prints success. It does not retrieve a remote packet/run or restore
Git state. `lib/runtime/lease-fencing.mjs:56-67` computes a token without shared CAS;
`lib/runtime/handover-protocol.mjs:129-145` accepts missing current lease. This is
separate from the stronger `run resume` protocol and must not inherit its assurance.

`lib/runtime/context-sanitizer.mjs:81-92` removes an index lock based on age >=5 seconds,
before authority validation, with no owner/liveness check and no linked-worktree
gitdir resolution. No lock was deleted in this audit. Its compression path at
`:121-143` truncates diffs/serialized JSON instead of preserving complete external
artifacts. Receiving work: #300.

### P1: delegated safety is library-only and pending admission is volatile

`scripts/run-delivery.mjs:176-233` selects v1 GitHub storage, Boolean authorization,
projection-only outcome lookup, and no delegation policy/issuer/journal/continuation.
Calls to `createLocalCooperativeIssuer`, portable continuation, journal and delegated
execution occur in tests/pilot, not this public composition.

`lib/application/run-service.mjs:142,188-203` retains pending admission in memory and
on an exception. `safetyCheckpoint` uses the same unavailable source at `:533-535`.
`scripts/process-pilot.mjs:167-168` journals an already-successful event; it cannot
prove pre-effect capture or outage recovery. Existing publication protections
(`lib/application/publication-service.mjs:71-167`) must be retained while defining
which external effects consume the delegated grant. Receiving work: #301.

### P1: a verified continuation can omit authoritative pending work

`lib/application/continuation-service.mjs:121-156` validates selected identity fields,
but `:185-199` returns bundle pending operations/rework/nextSlice. Policy/store digest,
actual Git revision and selected grant revision are not fully re-resolved.

Bounded helper reproduction: a sealed packet with correct run revision/writer but
empty pending list and `nextSlice: skip-to-merge` returned `verified:true` while the
source held an unknown push operation. This is false reconstruction evidence, not
proof of a gate bypass. Derive source-owned state from source and treat navigation
hints separately. Receiving work: #300.

### P1: generic receipt verification accepts false success and hashes wrong data

`lib/providers/harness-dispatch.mjs:125-188` returns pass for `{}`, `{ok:false}` and
`{status:running}`. A parent-run pure reproduction confirmed all three. At `:155`,
`recordDigest(string)` differs from SHA-256 of original bytes: supplying the actual
hash for `hello` raises `ARTIFACT_DIGEST_MISMATCH`.

The helper has no production callers. At `:257` it expects stdout artifacts, whereas
canonical provider receipts retain digest/metadata and Meshloop returns its own
translated envelope/verified metadata. `providers/local-cli.mjs:128` builds argv from
request args; assigning a model property alone does not prove actual CLI selection.
Receiving work: #302; add regressions through the eventual public caller.

### P1: segmented reader can silently return an older history

`lib/sources/segmented-run-store.mjs:138-146` tolerates a missing tail and does not
enforce tail count. `:168-175` does not fetch/verify the snapshot blob/digest and skips
its check if declared count exceeds loaded events. Helper reproduction with three
events and segmentSize=2 removed tail/snapshot entries: read accepted two events.

This currently affects an isolated library, not the v1 production CLI. It blocks
integration: a missing tail could contain an acknowledged revocation. Migration at
`:630-643` reports verified after PATCH without fresh confirmation/reconciliation.
Receiving work: #297; correctness precedes caching and performance claims.

### P2: telemetry privacy and measurement boundaries are incomplete

`lib/observability/events.mjs:95-100` accepts raw branchRef/worktreePath strings for
`meshloop_commit_ingested`; normalization preserves them and OTel exports normalized
primitives (`otel.mjs:103-115`). Parent reproduction preserved synthetic private-path
and secret sentinels. No current producer of that event kind was found: this is a
latent exported-boundary defect, not evidence of live data disclosure.

`lib/sources/github-api-cli.mjs:24-59` measures subprocess calls/stdio; the delivery CLI
uses it, whereas direct HTTP observations live in `github-client.mjs:26-73`.
`context_admitted`/usage have no observed production producers; attempt/remote trace
propagation and analytics (`observability/analysis.mjs:63-78`) remain incomplete.
Receiving work: #303. Unknown usage stays unknown; telemetry never substitutes for audit.

### P1/P2: adoption evidence and policy contradict implemented boundaries

`docs/process-autonomy/adoption-matrix.md:9-18` recommends `git clean -df`, incomplete
apply commands, pseudo APIs, unspecified integration config, fallback and hard ceilings.
The stronger `docs/assisted-onboarding.md:24-50,134-166` distinguishes actual runtime,
project and governed-change readiness and must guide the correction.

`scripts/__tests__/delegation-journey.test.mjs:88-99,106-163` injects grant state then
uses a fake provider without grant admission/budget. Its source-skill assertion
`:240-245` is conditional on a nonexistent coordinator file and silently skips.

`AGENTS.md:57` and `docs/agent-workflow.md:509-510` allow standard self-review;
`docs/guiding-principles.md:43` requires dual control unless waived. Resolve one
canonical policy with matching validators, preserving the user's experimental
workstream delegation separately from generic product policy. Receiving work: #304.

ADR ownership/status also needs a durable disposition: ADR004/005 are accepted;
ADR007 explicitly retains high-assurance/release acceptance pending; ADR010/011/012
are still Proposed at line 3 and require the named protocol/architecture reviews.
`docs/adr/index.md:14-19` stops at ADR006, omitting later decisions. Treat old Context
sections as historical statements, not current absence of implemented telemetry or
storage. #304 must update the index/status references without inventing acceptance;
#300/#297/#302/#303 own the corresponding implementation evidence.

## Quantitative acceptance ledger

| Original target                                            | Actual evidence                                                                       | Remaining proof                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 10,000 events, exact state                                 | Seeded cold source replay and full reducer equality; bounded 50-append rollover test. | Sequential/integrated workload, corruption and crash matrix; seed timing is not append throughput.        |
| >=50% fewer HTTP requests per accepted delivery/checkpoint | 75% fewer fake calls for unchanged reads; small fake-source append baseline in #297.  | Comparable actual transport requests/bytes and accepted-work denominators, cold/warm p50/p95.             |
| >=50% fewer common context bytes                           | No production context-admission comparison.                                           | Exact original bytes, repeated/common content measurement and equivalent outcomes/barriers.               |
| <=5% p95 local OTel overhead                               | Local export/parity fixtures; no percentile comparison.                               | Repeatable enabled/disabled workload, export latency reported separately.                                 |
| Resume <=60s excluding install/outage                      | One in-memory service reconstruction timing.                                          | Separate-process/root materialization and recovery on declared supported hosts.                           |
| Control <=32 KiB; policy index <=8 KiB                     | Sealed continuation and generic context cap tests cover 32 KiB.                       | Reachable complete context loader and policy-prefix budget without truncation; 8 KiB target unqualified.  |
| Telemetry 8 MiB / spool 32 MiB / 7 days / 2s flush         | Queue/spool/retention/deadline tests cover serialized buffers.                        | Integrated coverage/drop/retry report; serialized limits are not total process RSS guarantees.            |
| Audit 8 MiB plus 64 KiB stop reserve                       | Separate journal component and tests.                                                 | Admission-space reservation, write-ahead integration, crash replay and outage-safe stop.                  |
| Zero loss/duplicate effects; no new admission after revoke | Mock races and small process-pilot fixture.                                           | Declared real source/provider fault matrix; unknown outcomes reconciled, no universal exactly-once claim. |
| 8h / 2 attempts + 1 escalation / effect allowance          | Proposed operating budget, not a demonstrated enforced session limit.                 | Actual displayed binding and provider fidelity; hard token/currency limits remain unsupported.            |
| Node20/24 x Windows/Linux/macOS                            | #298 six product CI jobs green.                                                       | Same matrix on final integrated candidate; current green CI does not qualify absent features.             |

## Meshloop M1-M6 and separation of concerns

| Checkpoint            | Current status                                                                                                     | Next evidence                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Inventory          | Historical source/binary/neutral-fixture discovery exists.                                                         | Refresh exact source, binary, host and dirty-tree relationship before execution.                                                                                |
| M2 Neutral contract   | Responsibility map and council exist; engineering-provider-profile remains proposed, schemas/examples outstanding. | Versioned transport-neutral request/capability/lifecycle/result schemas, compatibility negotiation and adjudicated architecture review.                         |
| M3 Split backlog      | Narrative findings existed; #302 now owns AgentFlow remediation and explicit external handoff.                     | Per-repository issue/owner/public-surface/compatibility dispositions; Meshloop edits require its own scoped issue.                                              |
| M4 Substitution       | Neutral fixture and absent-provider resolution offer bounded proof.                                                | Shared direct/alternate/Meshloop process suite using canonical receipt translation; neutral-client Meshloop conformance without AgentFlow installed/configured. |
| M5 Real qualification | Current adapter truthfully reports liveBinaryQualified:false.                                                      | Standalone and integrated runs, actual artifacts, duplicate/timeout/crash/cancel/reconcile matrix.                                                              |
| M6 Adoption           | No complete current version/host/facet and cold-user matrix.                                                       | Install independently, connect optionally, mismatch refusal, disconnect and recover from documented entrypoints.                                                |

AgentFlow owns intent, authority, phases, handovers, evidence acceptance and delivery.
Meshloop owns technical graph decomposition, code/test execution and repair. AgentFlow
must retain a minimal direct executor for users without Meshloop. Only the optional
adapter translates the neutral contract; neither core imports the other's packages,
reads its private database or depends on its installation. New work connects these
boundaries rather than moving an engineering planner/repair engine into the SDLC core.

## Adoption coverage

| Journey                  | Current proof                                                                           | Remaining #304 acceptance                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Empty machine/project    | Disposable CLI onboarding plan/apply/verify/repeat; governedChangeReady remains false.  | Runtime provisioning plus first verified governed outcome from published entrypoints.                                    |
| Partial installation     | Inventory/reuse/ownership tests; improved readiness docs.                               | Fresh reader executes only missing setup, including managed links and runtime-discovered locations.                      |
| Old/unknown installation | Ambiguous ownership refused; selective mechanisms and upgrade/recovery package fixture. | Available update always proposed, shared decision separate, compatible deferral and selective recovery demonstrated.     |
| Autonomous/handover      | Library grants and honest small pilot.                                                  | Actual single approval reaches chosen supported destination; material drift stops; another process resumes without chat. |
| Optional/troubleshooting | Optional adapter and telemetry; direct path remains available.                          | Both standalone products, supported optional integration, offline telemetry, version mismatch, disconnect and recovery.  |

Each record needs candidate, environment, prerequisites, exact action, observable
result, next step, safe recovery, interventions, time to first verified outcome and
navigation/context baseline. Required maintainer hints are documentation defects.
Package installation/global deployment are not implicitly authorized by this analysis.

## Remaining execution order and ownership

1. **Correct exposed recovery and evidence semantics:** #300 (source-backed recovery,
   live-lock preservation); #302 (terminal receipt schema/raw-byte verification);
   #297 (tail/snapshot/migration integrity). These corrections may proceed in parallel
   with separate ownership. Fix misleading docs/policy in #304 early.
2. **Deliver supported composition:** #301 typed issuer/approval, acknowledged action
   adapters, write-ahead journal, safety reserve and exact outcome reconciliation;
   #300 portable materialization; #297 explicit version selection/migration.
   Integrate corrected contracts only after their safety regressions pass.
3. **Establish the neutral engineering interface:** #302 schemas/translations and
   shared direct/alternate fixtures; refresh M1-M3 and separately scope Meshloop fixes.
4. **Instrument and measure actual journeys:** #303 privacy/producers/correlation,
   integrated decision parity and comparative targets; #297 bounded source efficiency.
   Measurement construction may start early, final results require integrated paths.
5. **Qualify and close adoption:** #304 documentation-led cold journeys, real fault
   pilot, independent reviews, package parity and final exact-candidate CI. Include
   #302 M5-M6 only for explicitly supported optional facets; name unsupported facets.

Receiving issues: [#300](https://github.com/smota/agentflow-sdlc/issues/300),
[#301](https://github.com/smota/agentflow-sdlc/issues/301),
[#302](https://github.com/smota/agentflow-sdlc/issues/302),
[#303](https://github.com/smota/agentflow-sdlc/issues/303),
[#304](https://github.com/smota/agentflow-sdlc/issues/304), and existing
[#297](https://github.com/smota/agentflow-sdlc/issues/297).
Implementation ownership follows project routing (Agy where configured); Codex owns
SDLC/evidence review and Grok the original protocol/architecture review gates. Actual
executor/transport/fallback must be recorded at execution, never copied from this plan.
No additional generic approval loop is introduced for already delegated work.

## Validation and completion boundary

This audit reran 102 targeted tests across lifecycle, harness, continuation, migration,
telemetry boundary and delegation journey: all passed. Docs (103 files), roles,
workflow, hooks and reachability validators also passed before report edits. The
negative reproductions above still succeeded, demonstrating gaps in test assertions
and production composition despite those validators.

Prior exact-subject evidence: PR #298 full suite 1,061 tests/123 files and six product
CI jobs passed; package parity included a packed delivery and upgrade/recovery journey.
Those are regression/packaging facts, not A1-A9 acceptance. Bulk logs stay outside
control context; source anchors and issues above are the portable audit index.

Completion of #299 means this reconciliation and remaining plan are reviewable and
preserved. It does not close #297/#300-304, certify generic regulatory compliance,
retroactively invent role events, or authorize release/global installation.
