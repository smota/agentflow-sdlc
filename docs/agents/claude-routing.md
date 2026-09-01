# Claude routing workflow

Use this guide when route resolution selects `claude` as the role owner or fallback.

## Execution targets

`claude` has two distinct execution targets — never treat them as interchangeable:

- `claude-cli` — local Claude Code/CLI execution. Does not require an Anthropic API subscription.
  This is the built-in target for Claude resolving its own bare name. Cross-agent routing resolves a
  bare `with claude` only when project config declares `defaultExecutionTarget: claude-cli`; otherwise
  the launcher must request `claude-cli` explicitly or ask for clarification.
- `anthropic-api` — Anthropic Messages API execution (`model: anthropic/claude-*`, or a raw model id
  such as `claude-sonnet-4-20250514`). Requires configured API credentials and access to the
  requested model. Naming a Claude model does **not** launch the local Claude CLI.

Resolve which one an ambiguous request means before launching work:

```bash
node scripts/resolve-execution-target.mjs --agent claude --requested "with claude" --current-agent codex --json
node scripts/resolve-execution-target.mjs --agent claude --requested "anthropic/claude-sonnet-4" --json
```

See `docs/execution-targets.md` for the full concept reference.

## Availability check

Default setup check:

```bash
claude --version
```

If this command fails, treat `claude` as unavailable and try the next configured fallback.

## Call workflow

1. Resolve the role route and confirm `selectedAgent` is `claude`.
2. Post a ticket handover comment using `agents/templates/handover-comment.md` when control changes from another agent or when `claude` is selected as a fallback.
3. Invoke Claude with the issue number, role, branch, previous role-pass summary, acceptance criteria, and expected return artifact, plus the resolved execution target (`claude-cli` or `anthropic-api`).
4. Require Claude to sign role-pass with `Executed by: claude` and record `Executor: claude-cli` (or `anthropic-api`) with the matching `Transport` and `Delegation boundary`.

## Return contract

Claude must return:

- role-pass status: `pass`, `blocked`, `returned`, or `skipped`;
- inputs read;
- decisions/findings;
- open questions or `none`;
- next-phase contract;
- validation evidence when the role requires it.

The initiating executor must validate the returned role-pass before incorporating it into workflow-status or PR evidence.

For noninteractive acceptance, pass one bounded prompt containing the canonical role, profile,
action boundary, input `ArtifactRef`, expected transition envelope, and output path under ignored
`.agent-runs/`. Reject missing/invalid JSON, legacy output slugs, incorrect provenance, or any action
outside the boundary. Run `validate-evidence-contract.mjs`, `validate-lifecycle-contract.mjs`, and
the declared eval manifest. Unavailable or invalid Claude output fails the acceptance; it is not a
skipped pass.

Windows acceptance invocation (run from an isolated initialized consumer, not the source worktree):

```powershell
claude auth status
$prompt = Get-Content agents/evals/prompts/claude-agy-handoff.md -Raw
$schema = Get-Content schemas/transition-envelope.cli.schema.json -Raw
claude --restricted --tools Read -p $prompt --output-format json `
  --json-schema $schema
```

Require exit `0`, extract only `structured_output` to
`.agent-runs/<run>/claude-analyst.txt`, and validate it. Do not persist the CLI wrapper, diagnostics,
or transcript as durable evidence. `--restricted` and the isolated consumer enforce the `observe`
boundary; never use a permission-bypass flag for this fixture. The self-contained CLI projection is
needed because Claude Code expects JSON content for `--json-schema` and does not resolve the
canonical Draft 2020-12 schema's external references. The canonical transition validator remains
authoritative.
