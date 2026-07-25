# Evals

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

Initial benchmarks should use static fixtures in `../../agents/evals/datasets/` and assertions in `../../agents/evals/suites/`. No hosted infrastructure is required. Results should write to `.agent-runs/evals/` and stay uncommitted.

## Current maturity

Eval contracts exist here, but executable suites remain future work. Level 5 maturity is partial until those suites run in CI or documented release validation.
