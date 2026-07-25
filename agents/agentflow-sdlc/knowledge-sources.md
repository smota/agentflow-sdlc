# Knowledge sources contract

## Authority order

1. `AGENT.md` in this package: portable agent semantics.
2. `../../AGENTS.md`: repository policy; stop if missing unless restoring it.
3. Active adapter (`../../CLAUDE.md`, `../../CODEX.md`, `../../AGY.md`, or equivalent): executor entrypoint.
4. `../../docs/agent-workflow.md`: phase model, role-pass contract, PR evidence, review policy.
5. `../../docs/issue-standards.md`: issue titles, labels, body update rules.
6. Active GitHub issue or `../../SPEC.md`: current scope.
7. `../../agent-workflow.config.json`: branch, validation, bounded work, routing, extensions.
8. Prior workflow-status comments, handover comments, PR bodies, and commits.

When sources conflict, prefer higher authority and record conflict/follow-up in workflow evidence.

## Freshness expectations

| Source                    | Freshness rule                                                                      | Fallback                                                    |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Repository files          | Read from working tree before planning or edits.                                    | If missing, record blocker or follow-up.                    |
| Active issue / `SPEC.md`  | Refresh before implementation; validate with `validate-spec`.                       | Export issue to `SPEC.md` and normalize heading.            |
| GitHub comments / PR body | Treat as durable but check current issue/PR before readiness.                       | Record unable-to-refresh reason.                            |
| `.agent-runs/`            | Scratch only; useful for continuity, not durable authority.                         | Summarize into GitHub evidence before PR readiness.         |
| Runtime/tool docs         | Prefer local docs in this repo; external docs need source URL and date if material. | Use safe fallback or ask human when capability is required. |

## Required reading before issue work

Follow `../../AGENTS.md`: policy, active adapter, `../../docs/agent-workflow.md`, `../../docs/issue-standards.md`, then active issue or `SPEC.md`.
