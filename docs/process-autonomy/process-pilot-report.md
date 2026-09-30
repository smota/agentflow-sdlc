# Autonomous process pilot and retrospective dataset — S9

Run `node scripts/process-pilot.mjs --fixture` to exercise production run-service
calls with a single-process memory source and an in-memory effect adapter. The JSON
report is the measurement for that invocation. Its `passed` field covers only the
listed fixture checks; it is not acceptance of the complete S0–S9 execution plan.

## Exercised scenario

The pilot issues a local cooperative grant through the service, admits and dispatches
an operation, reconciles it, and records a pause. A new service instance reconstructs
an exact-byte-verified continuation and calls the recovery/resume service to acquire
the next writer generation. It then checks replay, stale-writer refusal, a second
execution, and revocation refusal. Journal compaction verifies the original event ID
and digest against a fresh source read.

The report derives event, dispatch, duplicate and pending-journal counts from those
observations. It records Node, OS and fixture-adapter provenance. No model CLI is
invoked. Timings describe this local fixture only.

## Qualification boundary

The memory source is non-durable. Reconstructing a service object is not a process
crash, a new machine or independent OS liveness verification. The fixture cannot
establish GitHub durability, cross-process races, CLI/provider cancellation, event
loss under a machine failure, or production performance targets.

Issue #295 replaces the synthetic grant, hardcoded counters and unsupported harness
attribution in the original #271 report. Earlier reported values must not be reused
as qualification evidence. Live source/harness execution, the 10,000-event workload,
context/source efficiency comparisons and telemetry overhead measurements remain
requirements of the [execution plan](../maintainers/process-autonomy-execution-plan.md).

A nonzero exit or a false required check fails this fixture. Inspect `unqualified`
before using a passing report in a delivery or adoption decision.
