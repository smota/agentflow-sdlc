# Process telemetry

Scope: optional process observability for #303. Telemetry is advisory; source run events remain the audit authority. This feature does not promise cost reduction or instrument private runtime internals.

## Enable collection

The run CLI reads an optional `observability` object from the target project's `agent-workflow.config.json`. Omit it to disable collection. An enabled collector also needs either `offline: true` or an explicit `otlpEndpoint`; no collector address is selected implicitly.

```json
{
  "observability": {
    "enabled": true,
    "offline": true,
    "spoolDir": ".agent-runs/telemetry"
  }
}
```

`spoolDir` currently resolves relative to the process working directory. Use an absolute path when invoking the CLI from outside the target project. For OTLP HTTP, set `offline: false` and `otlpEndpoint` to the collector base URL. The exporter adds `/v1/traces` and `/v1/metrics`. No credential configuration is provided by this checkpoint.

Completed commands print a compact telemetry loss/coverage report to stderr when enabled; stdout keeps the run result. The report distinguishes rejected observations, dropped spans, serialized bytes queued, expired records and spool eviction. It is not proof of complete collection. CLI/API counts are separate: a `gh` invocation does not reveal all HTTP retries or network bytes.

## Current coverage and limits

Instrumented boundaries include GitHub client/CLI payload bytes, acknowledged run events, candidate file reads, run command sessions, verification/recovery command duration and optional local CLI execution observations. One telemetry instance creates a session trace with child observation spans. Hashed run/session/operation IDs correlate observations without becoming metric labels. File paths, prompts, response bodies and arbitrary errors are excluded by the typed event schema.

The trace queue admits at most 2,048 spans and 8 MiB of serialized span payload, including in-flight batches. This is not a process RSS measurement. Shutdown attempts a bounded final batch, counts discarded spans and uses a two-second outer deadline. The spool admits at most 32 MiB of owned records with seven-day retention; unknown files are preserved. A writer lock prevents cooperating exporters from modifying the spool concurrently. A stale lock causes advisory loss until an operator verifies the writer is absent and removes that lock; it does not block run authority or justify automatic deletion.

Context packet bytes are observed at the AgentFlow boundary; they are not provider token counts. Native harness context, tokens and cache activity remain unknown unless a supported producer supplies them. Process transitions include finite phase/role metadata. Hashed run identity correlates separate sessions; no remote trace-parent propagation is claimed. Waiting/CI attribution covers only supported producers, not arbitrary external waits. Financial cost, complete HTTP retry counts and duplicate-effect detection cannot be inferred from this telemetry.

## Analyze offline observations

```bash
node scripts/analyze-telemetry.mjs /absolute/path/to/spool
```

This read-only command validates owned record checksums and produces bounded JSON aggregates. It reports source calls/bytes per observed accepted delivery or checkpoint, physical read bytes, admitted/repeated context when observed, usage when observed, dispatch/rework counts and available durations. Missing measurements and zero denominators produce `null`; the export lists unresolved coverage. Expired/evicted history cannot be reconstructed from surviving records, so historical loss is unknown unless separately retained. Checksums detect accidental changes; they do not authenticate a producer or authorize SDLC acceptance.

Validation at this checkpoint uses a real local OTLP HTTP receiver, offline spool round-trip, privacy fixtures, queue failure/overflow tests, and existing run CLI journeys. Fresh-process tests additionally exercise verification attempts, collector failure, pause and resume across sessions. These establish the declared local process boundary, not live coverage of arbitrary harnesses.

## Process transition metadata (#303)

Run event observations carry optional finite fromPhase/fromRole and toPhase/toRole
fields derived from the validated reducer states. Start has no previous state
(null source phase/role). Completion retains the last phase; it does not invent
another role. Same-phase events retain the same source and target.

For run_event_attempted and run_event_failed, the target describes a validated
proposal, not a committed transition. Only run_event_appended reports an
acknowledged append. Correlated event IDs join the proposal and result. These
fields do not export payloads, grant content or acceptance evidence and do not add
metric dimensions. Existing records without them remain readable.

The [approved #303 scope](../maintainers/process-autonomy-execution-plan.md#approved-scope-amendment-process-observability-303)
supersedes historical savings and full-matrix requirements above. Cross-session correlation uses run identity and distinct session IDs; separate traces remain separate.

## Verify adoption and interpret coverage

1. In the target project config, enable the offline example above with a writable
   spool directory. Invoke commands from the project root, or use an absolute
   spool path.
2. Run the normal supported workflow. Each CLI invocation is a separate session.
   Capture the stderr telemetry report separately from stdout workflow results;
   it reports current losses, not historical completeness.
3. Run the analysis command above on that spool. Inspect process.observedRuns,
   process.observedSessions, process.observedAttempts and
   process.acknowledgedEventCounts. These count observed records only.
4. For detailed correlation, inspect trace records in owned spool JSON files.
   Hashed runId stays stable across sessions; sessionId identifies each invocation;
   attemptId joins a started attempt to its outcome; operationId identifies a
   durable operation that may span attempts. Hashes do not grant authority.
5. To use OTLP instead, configure the explicit endpoint of an existing receiver.
   Offline files are a local capture format, not an automatic replay queue.
   Remove observability or set enabled to false to disable collection.

An interrupted invocation reports an unknown attempt outcome when the outer error
handler can run. A killed process may leave a start without an ending observation.
Neither case proves provider cancellation, failure or success. Missing events can
also reflect bounded collection losses.

From the framework checkout, run the telemetry-continuity.test.mjs and
telemetry.test.mjs suites with pnpm exec vitest run (both under lib/**tests**/).
Run node scripts/benchmark-run-telemetry.mjs to reproduce the overhead measurement.

The continuity test creates a temporary configured project and invokes eight fresh
Node processes for start, freeze, verification, failure, pause and confirmed resume.
It requires neither GitHub writes nor an installed collector. The receiver
test checks actual local OTLP requests and unavailable-exporter decision parity.
The benchmark writes ignored local results and is a warm in-process local-preview
measurement, not complete-delivery or cold-start qualification. Application and
shutdown time use equivalent boundaries for all modes. Shutdown includes flush and
export work; receiver handling is separately reported and is not network latency.
There is no numeric savings or overhead release gate in the approved #303 scope.
