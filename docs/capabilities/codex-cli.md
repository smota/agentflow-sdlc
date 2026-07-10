# Codex CLI capability adapter

This adapter describes how portable `multi-agent-sdlc` capabilities may be resolved when the selected execution target is `codex-cli` or `provider-api`.

## Capability matrix

| Capability               | `codex-cli` resolution                                                          | `provider-api` resolution         | Notes                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `plan-before-edit`       | `framework-emulated`, optionally supported by Codex plan settings/hooks         | `framework-emulated`              | Treat plan behavior as evidence only when an artifact/gate is recorded.         |
| `workflow-orchestration` | `framework-emulated` or `package` through scripts/hooks/MCP tooling             | `framework-emulated`              | Framework phases remain authoritative.                                          |
| `bounded-loop`           | `framework-emulated`                                                            | `framework-emulated`              | Enforce max iterations and stop conditions in framework evidence.               |
| `delegated-subagents`    | `package` only when a project config launches separate Codex sessions/processes | `optional-unavailable` by default | A separate process is not an independent review unless boundaries are recorded. |

## Evidence notes

- Codex project config, sandbox, approvals, hooks, and MCP servers can strengthen enforcement, but they are adapter details.
- Do not claim native subagents unless the project explicitly configures separate-session delegation and records its boundary.
- Provider API calls should be reported as `provider-api`, not as local Codex CLI execution.
