# Evals

Executable manifests use `schemas/eval-manifest.schema.json` and
`scripts/run-agent-evals.mjs`; see `docs/agent-evals.md`. Store live harness outputs only under
ignored `.agent-runs/`. Findings require owner review and a regression case before policy changes;
the improvement loop never self-mutates prompts, permissions, or controls.

AgentFlow SDLC evals detect behavioral drift in agent instructions, workflow evidence, routing, and package completeness. They complement code tests and PR review.

| Suite                       | Fixture/source                                         | Assertion type   | Pass condition                                                                                                          |
| --------------------------- | ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Onboarding                  | assisted onboarding prompt and sample project context  | checklist        | Agent preserves existing instructions, validates read-only, asks for required choices, and waits before setup commands. |
| Issue/PR evidence           | sample issue, role-pass, workflow-status, PR manifest  | structural       | Required fields and issue references are present.                                                                       |
| Role routing                | `agent-workflow.config.json` examples                  | deterministic    | Owner/fallback and execution target resolve or require clarification.                                                   |
| Capability evidence         | role-pass snippets using PLAN/WORKFLOW/LOOP/SUB-AGENTS | schema/checklist | Required mode, adapter, artifact, guardrails, and status are recorded.                                                  |
| Package completeness        | `agents/agentflow-sdlc/` tree                          | file/path        | Required package files exist and link to authority docs.                                                                |
| No false multi-agent claims | PR manifest examples                                   | validator        | Multi-agent mode has at least two role intelligences or fails.                                                          |

## Benchmark direction

Benchmarks use static fixtures, prompts, and manifests under `../../agents/evals/`. No hosted infrastructure is required. Results write to `.agent-runs/evals/` and stay uncommitted.

## Current maturity

Executable manifests cover framework contracts and a Claude/Agy handoff scenario, and the release gate runs them through `pnpm test:evals`. This remains a focused regression set rather than a claim of exhaustive behavioral coverage; add a fixture and manifest assertion whenever a reviewed finding should become durable.
