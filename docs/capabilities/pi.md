# Pi capability adapter

This adapter describes how portable `multi-agent-sdlc` capabilities may be resolved when the selected execution target is `pi-parent`, `pi-subagent`, `pi-session`, or `pi-subagent-model`.

## Capability matrix

| Capability               | Pi resolution                                                                               | Notes                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `plan-before-edit`       | `package` through planner/context-builder workflows or `framework-emulated` role-pass gates | Pi core is minimal; packages and skills provide higher-level behavior. |
| `workflow-orchestration` | `package` when a workflow/subagent package is installed; otherwise `framework-emulated`     | Keep `docs/agent-workflow.md` as the source of truth.                  |
| `bounded-loop`           | `package` for review-loop style orchestration or `framework-emulated`                       | Parent session owns stop decisions.                                    |
| `delegated-subagents`    | `package` for `pi-subagents`; `manual`/`optional-unavailable` otherwise                     | Record child context and writer boundaries.                            |

## Evidence notes

- Pi packages can provide chains, parallel fanout, async runs, and review loops, but package output must be summarized into GitHub issue/PR evidence.
- Do not let multiple writer subagents edit the same worktree.
- Ordinary child subagents should not launch further subagents unless an explicit fanout child is configured and bounded.
