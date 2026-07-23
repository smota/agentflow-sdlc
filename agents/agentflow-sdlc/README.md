# AgentFlow SDLC agent package

This package is the portable agent definition for **AgentFlow SDLC**, an open-source process layer for reviewable AI-assisted software delivery.

Use it when another project needs a copyable agent contract for issue-driven SDLC work, harness capability mapping, sub-agent handoffs, validation, and continuous improvement.

## Files

| File                               | Purpose                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| `AGENT.md`                         | Canonical portable agent definition.                                |
| `knowledge-sources.md`             | Authority order, freshness, and conflict handling.                  |
| `tools-actions.md`                 | Tool/action permissions, fallbacks, audit, and safe mutation rules. |
| `runtime-capabilities.md`          | PLAN/WORKFLOW/LOOP/SUB-AGENTS capability matrix.                    |
| `capability-maturity-scorecard.md` | Current Level 0-5 maturity evidence and gaps.                       |
| `handoff-contract.md`              | Role and sub-agent handoff evidence contract.                       |
| `execution-model.md`               | Single-agent default, optional routing, and no-false-claims model.  |
| `agent-guardrails-matrix.md`       | Safety, review, branch, evidence, and secret guardrails.            |
| `agent-validation-checklist.md`    | Validation commands and package readiness checks.                   |
| `evals.md`                         | Evaluation suite plan and pass conditions.                          |
| `continuous-improvement-plan.md`   | Feedback, regression, changelog, and maturity loop.                 |
| `CHANGELOG.md`                     | Package-level change log.                                           |

## Canonical sources

This package references, rather than replaces, repository authorities: `../../AGENTS.md`, `../../docs/agent-workflow.md`, `../../docs/issue-standards.md`, `../../docs/capabilities.md`, and `../../docs/execution-targets.md`.
