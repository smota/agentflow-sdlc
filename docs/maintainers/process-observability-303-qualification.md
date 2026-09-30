# Process observability qualification (#303)

Date: 2026-09-30. Scope: the maintainer-approved observability amendment,
not the historical efficiency targets. Reproduce using
[the adoption guide](../process-autonomy/observability.md).

## Delivered boundaries

- Validated finite source/target phases and roles on attempted, acknowledged and
  failed run-event observations. Only acknowledged observations imply persistence.
- Per-attempt identity for delegated actions, independent of durable operation
  identity. Unhandled invocation errors close a known observational attempt as
  unknown; this does not assert provider failure or cancellation.
- Eight fresh Node processes exercise start, freeze, two successful verification
  attempts, a failing collection attempt, pause, recovery planning and confirmed
  resume. Offline traces retain one run ID, eight session IDs and three attempt
  IDs; analysis consumes the retained capture.
- Plain observer ports remain independent of the OTel SDK. Actual OTLP receiver,
  disabled/offline modes and unavailable exporter checks preserve process decisions.
- Existing bounded queue/spool tests and expanded privacy tests cover collection.
  New role metadata is tested through actual OTLP export.
- Analysis reports observed run/session/attempt counts and acknowledged event
  counts. These do not imply complete collection or authoritative acceptance.

The run-service suite independently exercises a real bilateral phase advancement
with source/target role assertions. The continuation test uses actual subprocesses
and local file persistence. Neither test claims live external engineering-provider
qualification, remote trace-parent propagation or a complete delivery pilot.

## Equal-boundary overhead observation

Windows, Node v26.10.0; warm in-process local-preview start/freeze/verify workload,
12 paired samples per mode after two warmups, rotating mode order. Application
timing uses the same invocation-start to pre-shutdown boundary in every mode.
Shutdown includes flush/export and reporting, not just network latency.

| Mode                | Application p50 ms | Application p95 ms | Shutdown p50 ms | Shutdown p95 ms |
| ------------------- | -----------------: | -----------------: | --------------: | --------------: |
| Disabled            |            404.375 |            510.047 |           0.212 |           0.297 |
| OTLP local receiver |            407.430 |            456.323 |          14.401 |          20.154 |
| Offline capture     |            414.547 |            435.409 |          36.775 |          42.015 |

Paired mean application delta 95% intervals were [-25.441, 20.919] ms for
OTLP and [-19.947, 27.353] ms for offline. Both cross zero: no stable direction
is established. Paired per-sample overhead p95 was 15.140% and 9.755% respectively;
these are not a confidence bound on p95, and twelve-sample nearest-rank p95 is
the maximum sample. All modes accepted identical verification observations.

Assessment: this run does not establish a stable local application regression or
an improvement. Export/shutdown adds visible bounded latency and collection remains
opt-in. Report that cost to adopters; do not claim the retired 5% target passed or
start an optimization campaign. This small local workload does not certify remote
export latency, cold process startup or other hosts.

## Coverage limits and acceptance

Human-wait/CI durations and usage cover available producers only. Unknown values
remain unknown; there is no financial-cost estimate, full hidden HTTP-retry count,
or private harness instrumentation. A killed process can omit its terminal span.
Surviving spool records cannot reconstruct evicted history; loss reports must be
retained separately when needed. Telemetry is never the audit authority.

Acceptance is bounded process observability with documented consumption and
cross-session correlation. Missing provider internals and historical savings
targets are explicit scope exclusions, not unfinished #303 optimization work.
No collector installation, dashboard, Meshloop change or global installation is
part of this delivery. Rollback is disabling observability; mandatory audit and
workflow state are unchanged.
