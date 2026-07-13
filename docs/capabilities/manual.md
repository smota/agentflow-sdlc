# Human/manual capability adapter

This adapter describes how portable `agentflow-sdlc` capabilities may be resolved when the selected execution target is `human` or when a required capability needs human approval.

## Capability matrix

| Capability               | Manual resolution | Notes                                                            |
| ------------------------ | ----------------- | ---------------------------------------------------------------- |
| `plan-before-edit`       | `manual`          | Human approves or supplies the plan before edits.                |
| `workflow-orchestration` | `manual`          | Human follows the same phase and evidence contract.              |
| `bounded-loop`           | `manual`          | Human controls iteration count and exit decision.                |
| `delegated-subagents`    | `manual`          | Human performs or coordinates delegation and records boundaries. |

## Evidence notes

- Manual resolution is valid only when the issue/PR records what the human decided or performed.
- High-assurance security and acceptance gates remain human-reviewed even when implementation used AI capabilities.
- Manual fallback should not be used to hide missing required automation; if a project requires automation, record a blocker instead.
