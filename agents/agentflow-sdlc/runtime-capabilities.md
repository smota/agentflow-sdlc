# Runtime execution intents

Keep execution intents, tool permissions, provider facets, and controls distinct. Action authority
is orthogonal to workflow profile and delegation may only narrow it.

| Intent                   | Purpose                            | Required evidence                                |
| ------------------------ | ---------------------------------- | ------------------------------------------------ |
| `plan-before-edit`       | Capture approach before mutation   | Plan artifact and pre-edit gate                  |
| `workflow-orchestration` | Preserve phases and evidence       | Phase set, skips, and evidence mapping           |
| `bounded-loop`           | Repeat with a stop condition       | Maximum iterations, stop conditions, exit reason |
| `delegated-work`         | Delegate bounded work              | Context, permissions, result, parent synthesis   |
| `parallel-fanout`        | Run independent lanes concurrently | Concurrency limit and joined results             |
| `isolated-workspace`     | Isolate experimental writes        | Workspace identity, writer lease, cleanup        |
| `background-execution`   | Run bounded asynchronous work      | Timeout, status, cancellation and completion     |
| `structured-result`      | Produce a typed result             | Schema identity and validation result            |

Use the smallest sufficient mode from `../../docs/intelligent-collaboration.md`. The active provider
may implement an intent natively, through a plugin/adapter, by AgentFlow emulation, or manually.
Record the inspected implementation, fidelity, evidence level, and limits.

## Collaboration constraints

- Parent remains accountable for synthesis.
- Keep one writer per shared worktree.
- Review independence requires evidence, not a provider name.
- Every role handover includes an acceptance contract; complex work may require a council.
- Council members advise over one evidence digest; the role owner decides and dispositions objections.
