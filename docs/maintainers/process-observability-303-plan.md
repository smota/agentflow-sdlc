# Process observability: coverage and implementation map

Date: 2026-09-30. Issue: [#303](https://github.com/smota/agentflow-sdlc/issues/303).
Inspected product source: development 2f13fca; scope amendment b965299.
This map records the pre-implementation source inspection. Subsequent implementation and qualification are recorded in [the qualification report](process-observability-303-qualification.md). The approved scope in
[the execution plan](process-autonomy-execution-plan.md#approved-scope-amendment-process-observability-303)
governs this work.

## Existing boundaries and gaps

| Concern                     | Existing producer or consumer                                                                                 | Remaining work                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable process transitions | application/run-service.mjs emits run_event_attempted/appended/failed with eventKind, runId and eventId       | Append observations describe event kinds but omit phase/role context. Define bounded process metadata so handovers and validation transitions can be interpreted without exporting payloads. Preserve attempted versus acknowledged semantics. |
| Sessions                    | scripts/run-delivery.mjs supplies runId/sessionId; observability/otel.mjs parents events under a session span | Prove stable run correlation across fresh processes and distinct session identity. Each session currently starts at ROOT_CONTEXT; do not claim remote parent propagation.                                                                      |
| Execution attempts          | run-delivery verification has attemptId; delegated act events carry operationId                               | Distinguish invocation attempts from durable operations and close observational attempts on exceptions without falsely claiming provider cancellation or known outcome.                                                                        |
| Verification and recovery   | run-delivery emits outcome/duration; lifecycle events represent observations and resumed state                | Test failure, pause and fresh-session continuation together. Recovery temperature is not consistently produced; report unknown rather than expand into a cold/warm optimization campaign.                                                      |
| Source and context          | github-api-cli emits client/CLI observations; run-delivery emits context_admitted                             | Document exact measured boundaries. CLI invocation and observed client response are not two independent HTTP calls; packet bytes are not provider token usage. No savings qualification required.                                              |
| Optional collection         | observability/observer.mjs, otel.mjs, bounded-trace-processor.mjs and local spool                             | Reuse architecture and bounds. Qualify disabled/enabled/offline/export-failure equivalence for the representative process.                                                                                                                     |
| Privacy                     | events.mjs rejects unknown fields and hashes identifiers                                                      | Extend planted-value tests for any new phase/role/attempt metadata and export paths. Hashing identifiers is not a universal anonymity guarantee.                                                                                               |
| Consumption                 | analysis.mjs and scripts/analyze-telemetry.mjs aggregate surviving records                                    | Provide process-oriented coverage and usable correlation evidence. Do not infer complete history or absent failures from missing records; historical losses remain unknown without a retained report.                                          |
| Adoption                    | docs/process-autonomy/observability.md describes setup and analysis                                           | Refresh stale producer claims and historical full-matrix requirement. Demonstrate enablement, verification and consumption without this conversation or mandatory Meshloop.                                                                    |
| Instrumentation overhead    | scripts/benchmark-run-telemetry.mjs compares local-preview modes                                              | Equalize timing boundaries: disabled currently uses caller duration while enabled/offline use emitted internal session duration. Report cost, not savings; no inherited numeric release gate.                                                  |

Paths in the table are under lib/ unless explicitly prefixed scripts/ or docs/.
Existing tests include telemetry, telemetry-producers, telemetry-privacy,
telemetry-boundary-review, telemetry-queue, telemetry-spool, telemetry-analysis
and process-analysis-dimensions suites in lib/**tests**/. Their presence is not
a claim that the updated acceptance passes.

## Ordered implementation slices

1. **Process event meaning and coverage.** Define additive, finite phase/role
   metadata only where the source can establish it. Preserve event IDs and
   acknowledged transition semantics. Validate normalization and production
   emitters; do not copy raw event payloads or introduce OTel types into core.
2. **Attempt and continuation correlation.** Give each observed delegated attempt
   a distinct identity, preserve operation identity, and report interrupted or
   unknown outcomes honestly. Prove a fresh process joins the same run while
   retaining a distinct session. Cross-session run correlation is required;
   remote trace-parent support is a separate capability, not inferred from IDs.
3. **Representative process qualification.** Exercise validation, handover, pause,
   failure and resume with collector off/on/offline/unavailable. Compare durable
   decisions and privacy-safe observations. Reuse bounded queue/spool tests,
   adding only missing assertions. No need to repeat live GitHub optimization
   workloads; select real boundaries necessary to demonstrate telemetry.
4. **Consumption, overhead and adoption.** Publish supported/unsupported coverage,
   a representative capture/analysis recipe and equal-boundary overhead results.
   Keep loss reporting distinct from an audit guarantee. Refresh documentation
   against executed commands and record environment and limitations.

Each slice must produce evidence for its changed boundary before proceeding.
Bounded fixtures and documentation may use lower-cost Codex models; no additional
agent or provider has been launched for this mapping. This plan does not prescribe
a new model roster or technical execution framework.

## Acceptance and exclusions

Acceptance is correlated, consumable process evidence; workflow invariance;
privacy; bounded collection with visible losses; and reproducible adoption.
Unavailable provider internals, financial cost, savings targets, new dashboards,
collector deployment and Meshloop implementation remain outside this work.

No product code was changed or runtime tests executed for this mapping. Source
review confirms locations and gaps; implementation and integrated qualification
remain pending.
