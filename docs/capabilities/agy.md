# Agy capability adapter

This adapter describes how portable `multi-agent-sdlc` capabilities may be resolved when the selected execution target is `agy-cli` or `agy-session`.

## Capability matrix

| Capability               | `agy-cli` resolution                                                 | `agy-session` resolution                                             | Notes                                                       |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `plan-before-edit`       | `framework-emulated` by default                                      | `framework-emulated`                                                 | Record a plan artifact before edits.                        |
| `workflow-orchestration` | `framework-emulated` unless a project package adds a native workflow | `framework-emulated`                                                 | Route ownership does not change SDLC evidence requirements. |
| `bounded-loop`           | `framework-emulated`                                                 | `framework-emulated`                                                 | Use explicit iteration caps and stop conditions.            |
| `delegated-subagents`    | `optional-unavailable` by default                                    | `manual`/`package` if a separate session is deliberately coordinated | Record session and handover boundaries.                     |

## Evidence notes

- Agy is useful for documentation, multimodal, architecture, or broad discovery roles when project routing selects it.
- Do not treat an Agy-owned role as independent review unless the role attribution matrix supports that claim.
- If Agy is reached through a separate local session, record `transport: orchestrated-worktree` or the actual configured transport.
