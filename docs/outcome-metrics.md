# Derived outcome metrics

AgentFlow derives operational views from referenced lifecycle events; metrics are projections, not
workflow authority. The version-1 projection reports cycle time, first-pass validation, review
latency, PR-ready-to-release lead time, follow-up age, and incident-to-regression-eval time.

```text
node bin/cli.mjs sdlc derive-metrics --path lifecycle-events.json
```

Events are sorted and deduplicated by id. Missing endpoints produce `null`, never a fabricated zero.
Inputs contain identifiers, event types, timestamps, outcomes, and source references—not raw
transcripts, credentials, private payloads, or full telemetry.
