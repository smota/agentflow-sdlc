# Maintainer path

Maintainers own product boundaries, compatibility, release claims, and validator quality.

1. Read the [modular architecture](../modular-architecture.md) and [ADRs](../adr/index.md).
2. Preserve the current payload and profile contracts in `manifests/`.
3. Add contracts before provider- or source-specific behavior.
4. Keep profile dependencies closed and add reusable files to the smallest applicable profile.
5. Run unit, workflow, eval, sandbox, Cockpit, package, extension, and format gates.
6. Compute `node scripts/review-digest.mjs --json` only after the candidate stops changing.
7. Require digest-bound independent reviews and the high-assurance human PR gate.

Do not claim npm publication, provider support, hosted CI success, or external harness capability
from local configuration alone. Pin exact upstream revisions and validate the invoked public contract.

## Active maintainer & autonomy specifications

| Document                                                                            | Scope                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Breaking changes](breaking-changes.md)                                             | Compatibility policy and major-version migration rules           |
| [Process source baseline](process-source-baseline.md)                               | Canonical source-adapter baseline for process autonomy           |
| [Delegation](../process-autonomy/delegation.md)                                     | Delegation boundaries, child-subagent rules, and trust envelopes |
| [Harness dispatch](../process-autonomy/harness-dispatch.md)                         | Cross-CLI and subagent dispatch mechanics                        |
| [Engineering provider profile](../process-autonomy/engineering-provider-profile.md) | Capability facets and provider conformance                       |
| [Observability](../process-autonomy/observability.md)                               | Telemetry, run health, and evidence projection                   |
| [Portable continuation](../process-autonomy/portable-continuation.md)               | Cross-session and cross-harness continuation envelopes           |
| [Pending audit journal](../process-autonomy/pending-audit-journal.md)               | Transactional journal and rollback receipts                      |
| [Host intent consent](../process-autonomy/host-intent-consent.md)                   | Explicit human confirmation before host mutations                |
| [Segmented storage](../process-autonomy/segmented-storage.md)                       | Scratch vs. durable artifact storage boundaries                  |
| [Source efficiency](../process-autonomy/source-efficiency.md)                       | Pointer envelopes and compact GitHub/filesystem writes           |
| [GitHub merge](../process-autonomy/github-merge.md)                                 | Merge gate and integration lifecycle rules                       |

## Historical qualification, audit & spike records (Archive)

These point-in-time records capture completed sprint qualifications, audits, and design spikes. They are retained for provenance and are not active onboarding or runtime specifications:

- [Adoption documentation audit](adoption-documentation-audit.md)
- [Incremental onboarding plan](incremental-onboarding-plan.md)
- [Onboarding experiment retrospective](onboarding-experiment-retrospective.md)
- [Process autonomy execution plan](process-autonomy-execution-plan.md)
- [Process autonomy reconciliation](process-autonomy-reconciliation.md)
- [Process autonomy completion](process-autonomy-completion.md)
- [Process observability #303 plan](process-observability-303-plan.md) & [qualification](process-observability-303-qualification.md)
- [Adoption matrix](../process-autonomy/adoption-matrix.md) & [adoption qualification](../process-autonomy/adoption-qualification.md)
- [Live delivery qualification](../process-autonomy/live-delivery-qualification.md)
- [Process pilot report](../process-autonomy/process-pilot-report.md)
- [Issuer spike](../process-autonomy/issuer-spike.md)
- [S0 contract ownership map](../process-autonomy/s0-contract-ownership-map.md)
