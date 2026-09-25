# Process telemetry — S1 implementation checkpoint

Status: partial implementation for issue #262. Telemetry is advisory; source run events remain the audit authority. This checkpoint does not close S1 or qualify the autonomous pilot.

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

Native harness context, tokens and cache activity are unknown unless a supported producer supplies them. Context/usage event schemas exist, but end-to-end producer wiring remains open. Role acceptance, waiting/CI attribution, cross-session trace links, richer decision-invariance tests and baseline performance qualification also remain open. The full matrix in the execution plan remains required.

## Analyze offline observations

```bash
node scripts/analyze-telemetry.mjs /absolute/path/to/spool
```

This read-only command validates owned record checksums and produces bounded JSON aggregates. It reports source calls/bytes per observed accepted delivery or checkpoint, physical read bytes, admitted/repeated context when observed, usage when observed, dispatch/rework counts and available durations. Missing measurements and zero denominators produce `null`; the export lists unresolved coverage. Expired/evicted history cannot be reconstructed from surviving records, so historical loss is unknown unless separately retained. Checksums detect accidental changes; they do not authenticate a producer or authorize SDLC acceptance.

Validation at this checkpoint uses a real local OTLP HTTP receiver, offline spool round-trip, privacy fixtures, queue failure/overflow tests, and existing run CLI journeys. Mocked provider execution does not establish live harness coverage. Do not interpret these tests as completion of the S1 baseline or S9 pilot.
