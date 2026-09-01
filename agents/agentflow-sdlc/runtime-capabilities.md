# Runtime capabilities

Keep three namespaces distinct: workflow capabilities are requested behaviors, tool permissions
are allowed operations, and controls are independently enforced/evidenced boundaries. Action
authority is orthogonal to workflow profile and delegation may only narrow it.

AgentFlow SDLC uses portable capability names from `../../docs/capabilities.md` so harnesses can map intent to native, package, framework-emulated, manual, optional-unavailable, or required-unavailable implementations.

| Capability               | Intent                                                      | Default mode                                                   | Required evidence                                                             |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `plan-before-edit`       | Capture approach before mutation.                           | framework-emulated via architect/developer-planning role-pass. | Plan artifact/summary, gate status, whether edits waited.                     |
| `workflow-orchestration` | Run SDLC phases while preserving evidence.                  | framework-emulated via `../../docs/agent-workflow.md`.         | Phase set, skipped phases, issue/PR evidence mapping.                         |
| `bounded-loop`           | Repeat test/fix or review/fix with stop condition.          | framework-emulated unless harness provides loop primitive.     | Max iterations, stop condition, exit reason, remaining findings.              |
| `delegated-subagents`    | Delegate discovery/review/research/handoff with boundaries. | optional; read-only by default.                                | Task, executor, transport, boundaries, permissions, result, parent synthesis. |

## Harness capability mapping

- Native harness features may satisfy a capability only if evidence maps back to role-pass and PR contracts.
- Package-backed features are acceptable when trusted and documented.
- Framework-emulated behavior is the safe default.
- Manual behavior is acceptable for human gates.
- Optional unavailable capabilities may be skipped with evidence.
- Required unavailable capabilities block work.

## Intelligent collaboration modes

Use `../../docs/intelligent-collaboration.md` to choose the smallest sufficient collaboration mode:

- `single-agent` for clear low-risk work;
- `advisory` for focused read-only second opinions;
- `council` for high-uncertainty role-local strategy decisions;
- `parallel-discovery` for broad read-only repo discovery;
- `spike` for isolated worktree experiments;
- `human-gated` for high-assurance authority decisions.

## Sub-agent constraints

- Use sub-agents for broad discovery, read-only review, isolated research, or controlled handoff.
- Parent remains accountable for synthesis and final evidence.
- Keep one writer per shared worktree.
- Do not claim independent review unless reviewer role intelligence differs or self-review is disclosed where allowed.
