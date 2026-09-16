# Get started

This is the fastest path from a clean checkout to a first governed change in your own project: a
change made under AgentFlow's roles and checked by its gates, with the decision recorded as evidence
rather than left in private chat memory.

## Prerequisites

- Node.js 20 or newer
- Git
- GitHub CLI (`gh`) only when you want issue, PR, or release automation

Distribution for this release is a pinned git tag, not an npm package. Clone the tag you want to run:

```bash
git clone --branch v1.0.0 https://github.com/smota/agentflow-sdlc.git
cd agentflow-sdlc
```

## Reach your first governed change in 6 commands

A governed change is more than files on disk: it is a run whose acceptance contract is frozen and
whose evidence was actually collected, not asserted. That takes six commands, not three — freezing a
contract and collecting evidence are each their own step, and skipping them would leave you with an
installed project instead of a governed one. Here is the honest path, and every command in it does
something the next one depends on.

<!-- entry-path: 6 commands to a first governed change -->

```bash
node bin/cli.mjs init --target /path/to/your-project
node bin/cli.mjs sdlc validate --target /path/to/your-project
node bin/cli.mjs run start demo --goal "Adopt AgentFlow SDLC" --execute --target /path/to/your-project
node bin/cli.mjs run freeze demo --execute --target /path/to/your-project
node bin/cli.mjs run verify demo --check starter --execute --target /path/to/your-project
git -C /path/to/your-project add -A -- . ":(exclude).agent-runs" && git -C /path/to/your-project commit -m "Adopt AgentFlow SDLC"
```

**1. `init`** looks at your project before it writes anything. It reads your repository's current
branch instead of assuming `main`, and it reads your `package.json` for a `test` script instead of
guessing one. When both a test command and at least one file of your own are detected, `init` also
seeds a starter check that runs that exact test command, and a one-criterion acceptance file
(`agentflow-acceptance.json`) wired to it — plainly marked as a starter, meant to be replaced with
your project's real acceptance criteria. Every file `agent-framework-lock.json` records as
AgentFlow's own is excluded from that check's candidate (candidate — the exact files your evidence
will be checked against), so upgrading the framework later never silently changes what your evidence
covers. When `init` cannot detect a test command, or finds no
file of your own to check, it seeds neither the check nor the acceptance file — inventing either
would be worse than leaving it to you — and it prints the one step to add yourself: a `test` script
in `package.json`, or `delivery.checks` and `delivery.contracts` written by hand in
`agent-workflow.config.json`. Either way, `init` never overwrites your project's settings file on a
second run unless you pass `--force`.

**2. `sdlc validate`** checks that the settings `init` wrote are internally consistent — not just
that the files are present, but that the roles, branches, and checks they describe actually hold
together. This is what a gate looks like in AgentFlow: a deterministic pass/fail on a specific piece
of work, not a person's opinion.

**3. `run start`** opens a run named `demo` and records who owns it — your OS user name by default;
override it with `--writer` if you want a different name recorded — and that it is allowed to change
your files (`--execute`). Nothing is checked yet; this only establishes who is doing the work.

**4. `run freeze`** reads `agentflow-acceptance.json` and locks it in as this run's acceptance
contract. Once frozen, evidence can only be judged against these exact criteria — changing the
acceptance file afterward requires a fresh freeze, not a quiet edit.

**5. `run verify`** runs the `starter` check `init` seeded, against your real files, and records
what happened as an observation: the command that ran, its output, and whether the one placeholder
assertion held. Replace that placeholder with an assertion your own test output actually produces
once you are ready to trust the result; until then, this step honestly records what your test command
did, pass or fail — including exiting non-zero when it fails. That is the command working correctly,
not breaking: it collected real evidence instead of asserting success it could not back up. Check
`node bin/cli.mjs run status demo --target /path/to/your-project --json` to see the recorded
observation either way.

**6. `git commit`** records the adoption itself — `agent-framework-lock.json`, `AGENTS.md`,
`agent-workflow.config.json` and the role templates `init` installed — so that decision lives in your
repository instead of a chat transcript. It deliberately leaves out `.agent-runs/`: that directory is
local scratch, and the `AGENTS.md` you just installed says it must not be committed.

The run from steps 3–5 is a local preview. Its record is real — a frozen contract and an observation
with a digest (a short fingerprint that changes if the recorded content changes) — but it is not
durable until a source adapter anchors it; for GitHub that is the
append-only `agentflow-state` branch. From here, your next real change — a bug fix, a feature —
follows the same roles and gates, ending in a pull request whose evidence anyone can check.

If `init` reports an assumption you disagree with, edit `agent-workflow.config.json` directly; it is
your project's file from that point on.

## Look before you leap (optional, read-only)

You can inspect everything `init` would do without changing your project:

```bash
node bin/cli.mjs doctor-env --target /path/to/your-project
node bin/cli.mjs adopt plan --profile standard --target /path/to/your-project --json
```

`doctor-env` reports which required and optional tools are available; it installs nothing. `adopt
plan` previews the same install `init` performs, file by file, so you can review every action before
anything is written. Use [project setup](project-setup.md) for the full decision checklist and
[project config](project-config.md) for every available field.

## Existing installations

To update files after a new release, preview first:

```bash
node bin/cli.mjs adopt plan --profile standard --target /path/to/your-project --json
```

Review the plan, then apply it with `adopt apply` as shown in [run operations](run-operations.md).
AgentFlow never overwrites project-owned changes silently; resolve conflicts in the target before
generating a new plan.

## Go deeper

This page is the fast path. For everything else:

| You want…                                                          | Read                                                |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| The problem, model, and evidence flow before you install           | [AgentFlow in 5 minutes](agentflow-in-5-minutes.md) |
| A route by audience or job (maintainer, provider author, operator) | [Start here](start-here.md)                         |
| An assistant to run this onboarding for you, conversationally      | [Assisted onboarding](assisted-onboarding.md)       |
| Every field `init` and `adopt` can write                           | [Project configuration](project-config.md)          |
| The complete map of every document                                 | [Documentation index](index.md)                     |
| What a finished phase of work looks like, saved as a file          | [Agent workflow](agent-workflow.md)                 |

## Verify this framework checkout

Contributors and maintainers working on AgentFlow itself (not on an adopting project) run:

```bash
pnpm test
pnpm test:workflow
pnpm test:evals
pnpm format:check
node scripts/verify-hooks.mjs
node scripts/validate-npm-package.mjs
```
