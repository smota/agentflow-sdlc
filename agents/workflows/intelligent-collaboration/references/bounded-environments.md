# Bounded environments

| Environment       | Permission default | Notes                                     |
| ----------------- | ------------------ | ----------------------------------------- |
| current-session   | parent writer      | Normal single-agent path.                 |
| forked-context    | read-only helper   | Use for advisory/council/discovery.       |
| fresh-session     | read-only helper   | Use for independent local session review. |
| provider-api-call | read-only helper   | No filesystem mutation.                   |
| worktree          | isolated writer    | Spike only; parent ports or rejects.      |
| human-handoff     | human gate         | Authority decision.                       |

Every helper records permissions, timeout/file limits when applicable, artifact path, and cleanup rule. One writer per shared worktree.
