# Executable agent evals

Eval manifests make behavior checks repeatable across harnesses without storing raw transcripts in
durable evidence. A manifest names its subject and owner, points each case at an output, declares
deterministic assertions, and sets a pass threshold. Assertions include `contains`, `not-contains`,
`regex`, and `json-valid`.

```text
node bin/cli.mjs sdlc run-evals --manifest agents/evals/manifests/framework-contracts.json
```

For live harness output, keep files under ignored `.agent-runs/` and pass `--actual-dir`. Commit only
curated, non-sensitive fixtures. An eval finding proposes an owner-reviewed change and regression
case; it never mutates policy, prompts, permissions, or controls automatically.

The mandatory Claude → Agy acceptance uses
`agents/evals/prompts/claude-agy-handoff.md`, the `claude-agy-handoff.json` manifest, and:

```text
node bin/cli.mjs sdlc validate-multi-agent --actual-dir .agent-runs/<run>
```

This checks the semantic role chain, exact platform/executor provenance, action-boundary
non-escalation, applied Analyst play, and three guardrail refusals in addition to text assertions.
