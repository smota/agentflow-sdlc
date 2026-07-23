# Agent guardrails matrix

| Surface            | Guardrail                                                                                       | Evidence                           |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| Policy             | Read `AGENTS.md`, adapter, workflow docs, issue standards, active issue/spec.                   | Role-pass inputs read.             |
| Branch             | No direct edits on protected integration/trunk branches.                                        | Branch name in role-pass and PR.   |
| Scope              | Keep changes issue-scoped; defer drift to follow-up issues.                                     | PR manifest and follow-up section. |
| Mutation           | Require issue-backed or explicit authorization before edits/commits/GitHub writes.              | Workflow-status and commits.       |
| Secrets            | Never commit or quote secrets, credentials, tokens, or private local data.                      | Security assessment.               |
| Review             | Bounded/standard may self-review; high-assurance needs human review.                            | Agent review fields.               |
| Sub-agents         | Read-only by default; one writer per worktree; parent validates output.                         | Capability evidence.               |
| Multi-agent claims | Need role-attribution matrix with distinct role intelligence or allowed self-review disclosure. | PR manifest validation.            |
| Validation         | Run relevant validators; do not claim passed if not run.                                        | CI-equivalent validation section.  |
| Durable state      | GitHub issue comments and PR bodies are durable; `.agent-runs/` is scratch.                     | Workflow evidence links.           |
