# Agy routing workflow

Use this guide when route resolution selects `agy` as the role owner or fallback.

## Execution targets

`agy` has two distinct execution targets — never treat them as interchangeable:

- `agy-cli` — local Agy CLI/runtime execution, when available. This is the default execution target
  for Agy resolving its own bare name. Cross-agent routing resolves a bare `with agy` only when
  project config declares `defaultExecutionTarget: agy-cli`; otherwise the launcher must request
  `agy-cli` explicitly or ask for clarification.
- `agy-session` — an Agy-owned session/worktree, or an external agent session reached through the
  documented handoff mechanism. Distinct from any provider-backed model call or generic handoff:
  record which mechanism (worktree vs. reached session) was actually used.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent agy --requested "with agy" --current-agent claude --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
agy --version
```

If this command fails, treat `agy` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `agy`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `agy` is selected as a fallback.
3. Invoke Agy with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact, plus the resolved execution target (`agy-cli` or `agy-session`).
4. Require Agy to sign role-pass with `Executed by: agy` and record `Executor: agy-cli` (or `agy-session`) with the matching `Transport` and `Delegation boundary`.

## Return contract

Agy must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.

For noninteractive acceptance, pass one bounded prompt containing the canonical role, profile,
action boundary, input `ArtifactRef`, expected transition envelope, and output path under ignored
`.agent-runs/`. Reject missing/invalid JSON, legacy output slugs, incorrect provenance (must be
`agy`, never the distinct `antigravity` identity), or any action outside the boundary. Run the
evidence/lifecycle validators and declared eval manifest. Unavailable or invalid Agy output fails
the acceptance; it is not a skipped pass.

Windows acceptance invocation (run from the same isolated consumer after validating Claude):

```powershell
$claude = Get-Content .agent-runs/<run>/claude-analyst.txt -Raw
$prompt = (Get-Content agents/evals/prompts/claude-agy-handoff.md -Raw) + "`nValidated Claude input:`n" + $claude
$schema = Get-Content schemas/transition-envelope.cli.schema.json -Raw
agy --sandbox -p $prompt --output-format json `
  --json-schema $schema
```

Require exit `0` and `status: SUCCESS`, extract only `structured_output` to
`.agent-runs/<run>/agy-architect.txt`, then run the manifest and semantic multi-agent validator.
Do not persist the wrapper, diagnostics, credentials, or transcript. Never use
`--dangerously-skip-permissions` for this fixture. The self-contained CLI projection supplies JSON
content without external schema references; the canonical transition validator remains
authoritative.
