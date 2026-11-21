# Contribution workflow

This guide is the human-readable contribution path. `AGENTS.md` and `docs/agent-workflow.md` remain the policy and workflow authorities.

## Required principles

- Start from a GitHub issue or explicit maintainer direction.
- Read `AGENTS.md`, the active adapter, `docs/agent-workflow.md`, `docs/issue-standards.md`, then the active issue or `SPEC.md`.
- Work on an allowed branch, not protected integration/trunk branches.
- Keep changes scoped to the issue.
- Record validation and review evidence.
- Create follow-up issues instead of hidden TODOs or scope drift.
- Do not include secrets, credentials, tokens, or private local-only data in issues, PRs, commits, workflow evidence, or handovers.

## Contributor path

1. **Choose or open an issue.** Confirm title, labels, acceptance criteria, and workflow classification.
2. **Plan the work.** Identify files, validation commands, branch expectations, risk, and review profile.
3. **Create a work branch.** Prefer `work/<theme>`, `feature/<theme>`, `fix/<theme>`, `hotfix/<theme>`, or `spike/<theme>` unless config says otherwise.
4. **Implement narrowly.** Keep commits issue-scoped and avoid unrelated governance changes.
5. **Validate.** Run the relevant commands and record exact outcomes.
6. **Open the PR.** Use `agents/templates/pr-manifest.md`; include issue references, workflow evidence, validation, review fields, merge owner, and follow-up status.
7. **Verify the PR.** Check target branch, final body, issue references, workflow-status/handover links, checks, and merge owner.

## Source checkout for contributors

Clone AgentFlow only when developing or validating the framework itself:

```bash
git clone https://github.com/smota/agentflow-sdlc.git
cd agentflow-sdlc
pnpm install
node bin/cli.mjs --help
```

Here, `node bin/cli.mjs` runs your local source changes. Adopting projects use the installed
`agentflow-sdlc` command described in [Get started](../get-started.md).

## Common commands

```bash
node scripts/validate-spec.mjs
node scripts/resolve-branch-strategy.mjs --json
node scripts/validate-pr-manifest.mjs --path <manifest.md>
pnpm test
pnpm test:workflow
pnpm format:check
```

## PR issue references

- Use `Implements #<issue>` for PRs targeting the configured integration branch.
- Use `Closes #<issue>` only for PRs targeting the default/trunk branch where GitHub native auto-close should apply.
- Use `Refs #<issue>` for related but non-closing references.

## Generated PR template

`agentflow-sdlc github setup --apply` and onboarding use the same
[default PR template](../../defaults/pull_request_template.md). Onboarding seeds
`.github/pull_request_template.md` only when that file is absent. GitHub setup reports a conflict
for a custom template and preserves it.

Replace every placeholder before validation. The default uses `Closes #<issue-number>`.
For an integration PR, change `Closes` to `Implements` as described above.

Keep the section headings and field labels unchanged. Write fields as `- Label: value` or
`**Label:** value`. The validator does not accept `- **Label:** value`.
Fill all ten fields under `## Agent review`. Use the registered runtime platform for
`Implemented by` and `Launcher`, and record the actual executor and transport separately.
See [execution targets](../execution-targets.md) for accepted values.

Start `Handover comments:` with a bare URL, or use `exception: <reason>` when no role transition
occurred. Set the CI-equivalent `Status` to `passed`, `not-run-with-reason`, or
`expected-fail-with-follow-up`. The last value requires a concrete follow-up issue reference.
List the actual validation commands under `Commands:`.

For `Mode: multi-agent`, also include the role attribution matrix from
`agents/templates/pr-manifest.md`. That extended template covers release and promotion evidence.
See [the PR manifest contract](../agent-workflow.md#pr-manifest) for those conditional requirements.

## Review model

- Bounded and standard work may use explicit, evidence-backed self-review.
- High-assurance work requires human security and acceptance review on the open PR before merge.
- Review roles are read-only unless work is explicitly returned to implementation.

## Quick checklist

- [ ] I have an issue or explicit maintainer direction.
- [ ] I read the required policy and workflow docs.
- [ ] I am on an allowed work branch.
- [ ] My change is scoped.
- [ ] I ran validation or documented why not.
- [ ] My PR body includes issue references, workflow evidence, validation evidence, agent review fields, merge owner, and follow-up status.
