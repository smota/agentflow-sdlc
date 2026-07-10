# Claude Code capability adapter

This adapter describes how portable `multi-agent-sdlc` capabilities may be resolved when the selected execution target is `claude-cli` or `anthropic-api`.

## Capability matrix

| Capability               | `claude-cli` resolution                                                                                     | `anthropic-api` resolution        | Notes                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `plan-before-edit`       | `native` when Plan Mode is available; otherwise `framework-emulated`                                        | `framework-emulated`              | Record the plan artifact and approval gate.                          |
| `workflow-orchestration` | `native`/`package` through commands, skills, hooks, or local workflow setup; otherwise `framework-emulated` | `framework-emulated`              | The SDLC phase model remains authoritative.                          |
| `bounded-loop`           | `framework-emulated` unless a project hook/package enforces it                                              | `framework-emulated`              | Always record max iterations and stop conditions.                    |
| `delegated-subagents`    | `native` when Claude Code subagents are configured                                                          | `optional-unavailable` by default | Record subagent name, tools, context boundary, and parent synthesis. |

## Evidence notes

- Record `executionTarget` separately from model id. A model id like `anthropic/claude-sonnet-4` is a provider-backed call unless the transport explicitly launches the local CLI.
- Claude subagents are useful for read-only exploration, review, and specialist tasks, but they do not replace GitHub issue/PR evidence.
- Hooks may enforce deterministic gates, but the PR manifest still needs human-readable evidence.
