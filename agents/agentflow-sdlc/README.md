# AgentFlow SDLC agent package

This package is the portable agent definition for **AgentFlow SDLC**, an open-source process layer for reviewable AI-assisted software delivery.

The 1.0 development baseline defines a stable candidate package shape for teams that want AI speed without losing clarity, review, or control. It is not evidence that version 1.0.0 has been published.

Use it when another project needs a copyable agent contract for issue-driven SDLC work, intelligent collaboration, capability mapping, validation, and continuous improvement.

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

## 1.0 development collaboration stance

AgentFlow can use focused helper intelligence when it improves a decision, but it does not make multi-agent activity the goal. The default remains a simple, reviewable SDLC path with one accountable owner and compact durable evidence.

## Canonical sources

This package references, rather than replaces, repository authorities: `../../AGENTS.md`, `../../docs/agent-workflow.md`, `../../docs/issue-standards.md`, `../../docs/capabilities.md`, and `../../docs/execution-targets.md`.
