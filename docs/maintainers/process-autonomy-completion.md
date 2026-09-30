# Process autonomy completion evidence

> Current scope for #303 was amended with maintainer approval on 2026-09-30:
> [process observability scope](process-autonomy-execution-plan.md#approved-scope-amendment-process-observability-303).
> Historical efficiency targets and results below are retained as evidence, not
> current #303 acceptance gates.

This implementation follows the [reconciliation](process-autonomy-reconciliation.md) of
#297 and #300–304, based on development `67bb34f`. It preserves the original A1–A9
acceptance criteria. Implementation, fixture qualification, live qualification and
production readiness are separate claims. Release and global installation are excluded.

For the subsequent #301 phase-zero consent, ready-PR/named-merge journey and
layered live fault qualification, see
[public delivery qualification](../process-autonomy/live-delivery-qualification.md).
The remaining-qualification statements below describe the earlier PR #306 snapshot.

## Implemented boundaries

| Scope           | Delivered behavior                                                                                                                                                                              | Evidence boundary                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| #297 / A4       | Missing tails, inconsistent counts and corrupt snapshots fail closed; bounded immutable caching; explicit v1/segmented-v2 selection; preview-confirmed migration with fresh source verification | Exact 10,000-event cold reducer equality and sequential fake-source benchmark; not 10,000 live appends                                |
| #300 / A3       | Public handoff/resume uses durable packets and fresh source, workspace and artifact checks; unknown Git locks survive; complete oversized content requires externalization                      | Separate OS process and fresh Git root fixture; supported race and negative tests; no universal host qualification                    |
| #301 / A1/A2/A7 | Typed cooperative grants, write-ahead journal, reserved audit capacity, admission-only crash reconciliation, PR action preflight and exact outcome resolution                                   | Live GitHub issuance/revocation plus source/process fault fixtures; no authenticated human identity or hard provider spending ceiling |
| #302 / A6       | Versioned neutral schemas, terminal status and raw-byte integrity checks, explicit model/target binding and optional Codex/Meshloop adapters                                                    | Provider-specific live facets below; no mandatory engineering framework                                                               |
| #303 / A4/A5    | Observed GitHub response status, bounded context reuse, attempt/stage telemetry, private-field hashing and explicit analytics coverage                                                          | Fixed workload measurements below; telemetry remains outside mandatory audit and acceptance                                           |
| #304 / A8/A9    | Executable adoption guidance, safe recovery, aligned review policy and ADR index; installed skills remain distinct from product source                                                          | Package parity and cold entry-path tests; remaining integrated qualifications stay on the receiving issues                            |

The repository's candidate configuration enumerates files explicitly. Directory input
expansion is not supported by the fingerprint contract. Refresh the explicit list before
a different workstream; do not interpret it as a fingerprint of every repository file.
The repository's grant policy permits draft PR creation/update only. Operator-authorized
merge is separate from a product grant and never represents a human review attestation.

## Measured efficiency and explicit dispositions

Measurements used Windows x64 / Node v26.10.0. Product support remains subject to the
declared Node 20/24 cross-platform CI matrix. Benchmark scripts retain denominators and
can be rerun; timings are local observations, not portable guarantees.

| Target                                  | Observation                                                                                                                                                                                    | Disposition                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact cold replay of 10,000 events      | Complete reducer equality; bounded seeded replay, approximately 330 ms in the measured fixture                                                                                                 | Correctness qualified; seeded replay is not append throughput                                                                                     |
| At least 50% fewer source HTTP calls    | 200 sequential fake-source appends: cache off 4,117 calls / approximately 611 ms; cache on 2,822 calls / approximately 166 ms. Returned bytes approximately 18.2 MB to 1.94 MB                 | Call reduction 31.5%, below target, and fake calls are not observed live HTTP. Keep target open; do not weaken freshness checks                   |
| At least 50% fewer common context bytes | Fixed 20-checkpoint context fixture: 102,540 to 15,995 serialized bytes, 84.4% reduction; public opt-in compact loader binds common content by digest                                          | Fixture target passed; live transport reduction remains unmeasured                                                                                |
| At most 5% p95 local OTel overhead      | 12 paired public start/freeze/verify samples per mode, two warmups each, actual Node test process. Disabled p50/p95 406.578/452.763 ms; enabled 427.728/475.915 ms; offline 441.605/462.717 ms | Paired enabled p95 overhead 105.609 ms (33.78% ratio); target not met. Keep opt-in and investigate separately; no waits added to inflate baseline |
| Decision parity                         | All enabled, disabled and offline samples recorded the same candidate/definition digests, assertion and passing collector observation                                                          | Passed on this workload only                                                                                                                      |
| Export cost separate                    | Full journey including shutdown: enabled p50/p95 446.512/492.053 ms; offline 484.077/503.214 ms. Enabled measured-mode exports: 72 requests / 354,388 bytes                                    | Export and application time remain separate; exporter behavior is not a process decision                                                          |
| Control/policy budgets                  | 32 KiB control envelope and 8 KiB policy index, exact digest validation, no truncation                                                                                                         | Enforced by context builder/materializer tests                                                                                                    |

Reproduce with `node scripts/benchmark-segmented-run-store.mjs`,
`node scripts/benchmark-process-telemetry.mjs`, and
`node scripts/benchmark-run-telemetry.mjs`. The microbenchmark's near-zero disabled
baseline is not evidence for a relative application overhead claim. Analytics leave
unobserved wait/CI/recovery dimensions unknown; unavailable model usage is never zero.

## Live provider and source facets

GitHub public run commands first issued and revoked a cooperative grant without a
business effect. The subsequent `completion-pr-1790583601119` journey froze criteria,
collected the full regression suite and documentation checks, issued a one-effect
grant, created PR #306, and independently confirmed the exact operation. Repeating
the operation returned exit 6 without redispatch; explicit reconciliation confirmed
the existing PR. The grant was then revoked.

A handoff packet for target commit `7079df7` was recovered through the locally packed
CLI in a fresh Git clone and separate OS processes. Recovery reached generation 1
in 25.4 seconds, excluding clone/package preparation. The runtime included the
post-revocation packet correction in `8321b42`; the preserved target was unchanged.
An initial refusal exposed that new packets incorrectly referenced revoked grants;
the correction selects active grants only and retains rejection of stale packets.

Materialization required restoring 13 LF/CRLF variants to the packet's exact SHA-256
bytes and refreshing the disposable clone's Git index without a tree change. This
was an agent intervention, not a zero-intervention cold-reader pass. The implementation
does not automatically repair line endings or accept a mismatched artifact digest.
This live journey qualifies the exercised PR/replay/revocation/recovery path, not
the complete fault matrix or every phase of an autonomous engineering run.

Native Codex CLI 0.154.0 accepted explicit `gpt-5.6-luna` and returned the requested
structured, identity-bound result in a disposable read-only probe. This host rejected
`gpt-6-luna` for its ChatGPT account. A separate benign write probe requested
`workspace-write` but the runtime reported read-only and created no file. Therefore
live file editing, cancellation and autonomous engineering are not qualified on this
host. Model invocation binding is not independent evidence of the server's resolved model.

Installed Meshloop 0.1.0 lacks the lifecycle flags expected by the adapter. It remains
unsupported for the integrated live path. See the exact inventory and per-repository
dispositions in [Meshloop review](../process-autonomy/meshloop-review.md). AgentFlow
does not modify Meshloop or depend on its private state. A separately scoped Meshloop
implementation and compatible runtime are required for those qualification facets.

## Review provenance and residual limits

Local validation passed 1,144 tests across 133 files before the final narrow privacy
and metadata-mutation regressions; those additional checks receive focused validation
and the final candidate receives CI. Documentation (105 files), role, workflow, hooks,
configuration authority, reachability and whole-tree formatting passed. Package parity
exercised a packed governed delivery and interrupted upgrade recovery, including exact
rollback and preservation of authored application content. These checks do not qualify
unavailable provider capabilities.

The first cross-platform CI candidate passed Linux and Windows on Node 20/24. macOS
identified noncanonical temporary fixture roots (`/var` resolves through a system
symlink); tests now use the real temporary path, preserving the product's symlink
refusal. The local Cockpit smoke encountered Windows `EACCES` on its fixed port;
that local check is not claimed successful. Final CI results belong to the PR's
exact candidate rather than being inferred from earlier green jobs.

Codex Sol handled storage, recovery and engineering; Codex Luna handled bounded docs,
telemetry measurements and a separate read-only privacy review. The parent integrated
changes and performed evidence-backed self-review. These are same-platform helpers,
not human or cross-platform approval. Agy was unavailable and the user explicitly
redirected work to cheaper Codex models.

Grok CLI performed a bounded architecture discussion. Round one exhausted its turn
budget without a final verdict; rounds two and three returned advisory findings. The
third round relied on stated dispositions rather than re-inspecting the final tree.
Its verdict was conditional architectural acceptance for local-cooperative execution,
not production qualification or human acceptance. Concerns drove admission-only crash,
source-history continuity and known-noncommit retirement regressions.

The audit reservation is per journal, not a shared-disk quota. Provider writes remain
cooperative, with scope checks rather than a per-file OS sandbox. GitHub merge's head
precondition does not provide an atomic base-branch precondition. Unknown outcomes
block further effects until reconciled. The full live fault matrix and optional
Meshloop integration remain on #301/#302/#304; performance targets remain on #303.
No issue closes merely because documentation or a mock reproduces a desired outcome.
