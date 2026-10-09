# Get started

One journey adds AgentFlow to your project, or brings an existing installation forward:
`agentflow-sdlc onboarding`. You look at the project, see every file the journey would write,
confirm that exact preview, and end with a readiness report. Nothing is written before you confirm.

A later small change to an adopted project, such as its posture, branches, a check, or CI
commands, uses the [refinement journey](assisted-configuration.md). It works the same way.

## Prerequisites

- Node.js 20 or newer
- Git
- GitHub CLI (`gh`) only when you want issue, PR, or release automation

Ask your connected runtime to inspect whether the AgentFlow CLI and required skills are already
available, propose any available update separately, provision only missing components using its
own installation mechanism, and verify discovery in the current session. The runtime chooses
installation locations and manages links. AgentFlow does not install anything on the host.
No AgentFlow repository clone is needed. Once the runtime confirms the CLI is available, run the
commands below from any directory; `--target` points to your own project. Replace
`/path/to/your-project` with its path.

## Where you start

Every starting point uses the same commands. The preview shows what differs.

| Your project                                                  | What the preview asks for                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| An empty Git repository                                       | Nothing. Add a check afterwards: the report says so.       |
| An existing project with a working test script                | Nothing. A starter check runs your own test script.        |
| An AgentFlow installation with your own settings or AGENTS.md | A choice for each file both sides changed, if any.         |
| A legacy installation, or a lock AgentFlow does not recognize | An explicit migration or recovery choice before any write. |

## Existing project with tests: first local evidence in 6 commands

This path assumes an initialized Git repository with a file of your own and a working
`package.json` test script. It records a frozen acceptance contract and an observed test result
in a local preview; that is not PR acceptance or durable GitHub delivery.

Before the commit command, review the project changes. The example stages the whole project and
is suitable only when every change belongs to this adoption. In a dirty project, replace that
staging operation with explicitly reviewed adoption paths and preserve unrelated staged work.
Keep local runtime requests, evidence and plans under ignored `.agent-runs/`, not among product files.

<!-- entry-path: 6 commands to a first governed change -->

```bash
agentflow-sdlc onboarding plan --target /path/to/your-project
agentflow-sdlc onboarding apply --target /path/to/your-project --confirm <digest>
agentflow-sdlc run start demo --goal "Adopt AgentFlow SDLC" --execute --target /path/to/your-project
agentflow-sdlc run freeze demo --execute --target /path/to/your-project
agentflow-sdlc run verify demo --check starter --execute --target /path/to/your-project
git -C /path/to/your-project add -A -- . ":(exclude).agent-runs" && git -C /path/to/your-project commit -m "Adopt AgentFlow SDLC"
```

**1. `onboarding plan`** looks at your project and prints the preview. It writes nothing. Its
`preview` field lists every file the apply would create or change, and its `digest` field holds
the digest — a short fingerprint of that exact preview, which changes if anything in it changes.
The preview reads your repository's current branch instead of assuming `main`, and it reads your
`package.json` for a `test` script instead of guessing one. When both a test command and at least
one file of your own are detected, the preview includes a starter check that runs that exact test
command, and a one-criterion acceptance file (`agentflow-acceptance.json`) wired to it. Both are
plainly marked as a starter, meant to be replaced with your project's real acceptance criteria.
The candidate (the exact files your evidence will be checked against) leaves out every file
AgentFlow installs, so upgrading the framework later never silently changes what your evidence
covers. When no test command or no file of your own is found, the preview seeds neither: inventing
either would be worse than leaving it to you, and the readiness report names adding a check as the
next step.

**2. `onboarding apply`** writes exactly what the preview listed, and only when `--confirm` is
the digest the preview printed. If the project changed after the preview, the digest no longer
matches and nothing is written. It ends with the readiness report and the command that undoes
this apply.

**3. `run start`** opens a run named `demo` and records who owns it: your OS user name by default.
It is allowed to change your files (`--execute`). Nothing is checked yet; this only establishes
who is doing the work.

**4. `run freeze`** reads `agentflow-acceptance.json` and locks it in as this run's acceptance
contract. Once frozen, evidence can only be judged against these exact criteria. Changing the
acceptance file afterward requires a fresh freeze, not a quiet edit.

**5. `run verify`** runs the `starter` check against your real files, and records what happened
as an observation: the command that ran, its output, and whether the one placeholder assertion
held. The starter uses the test process exit code: zero records a pass; non-zero records a failure
and makes verification fail. Its assertion label is a placeholder, not text that must appear in
test output. Replace the starter criterion with real acceptance criteria and appropriate checks
before treating it as evidence for a product change. Check
`agentflow-sdlc run status demo --target /path/to/your-project --json` to see the recorded
observation either way.

**6. `git commit`** records the adoption itself, so that decision lives in your repository
instead of a chat transcript. It deliberately leaves out `.agent-runs/`: that directory is local
scratch. The transaction record under `.agentflow/transactions/` is ignored by Git as well.

The run from steps 3–5 is a local preview. Its record is real, a frozen contract and an
observation, but it is not durable until a source adapter anchors it; for GitHub that is the
append-only `agentflow-state` branch. From here, your next real change follows the same roles and
gates, ending in a pull request whose evidence anyone can check.

The sections below are the same journey for every other starting point, step by step.

## Inspect

```bash
agentflow-sdlc onboarding inspect --target /path/to/your-project --json
```

This reads the project and writes nothing. Its `classification` is `empty`, `partial`,
`complete`, `conflicting`, `legacy`, or `unknown`. It reports `AGENTS.md`, your configuration,
the lock (`agent-framework-lock.json`, AgentFlow's record of the files it installed), and any
unfinished apply.

## Preview

```bash
agentflow-sdlc onboarding plan --target /path/to/your-project
```

The preview is JSON on standard output. Read three fields:

- `preview` lists every file the apply would `create` or `change`. That includes the lock, the
  `/.agentflow/transactions/` line it adds to `.gitignore`, and the transaction record it keeps
  under `.agentflow/transactions/` so it can be undone. It also includes the four harness
  defaults under `.agentflow/` when they are missing. A file you wrote is listed for change only
  when you chose `replace` or a setting for it.
- `digest` is what you confirm.
- `report` is the readiness report as things stand now. Its `nextAction` is the one step to take.

You may save the preview with `> onboarding-plan.json` and apply that file later with
`--plan onboarding-plan.json`. The file must stay outside your project, or under ignored
`.agent-runs/`.

## Make the choices the preview asks for

When the preview needs a decision, `readyToApply` is `false`, the report lists each blocker, and
`missingChoices` names what to decide. Write the decisions in a choices file and preview again:

```bash
agentflow-sdlc onboarding plan --target /path/to/your-project --choices choices.json
```

Your choices stay visible in every report under `choices`. They are never folded into ready or not
ready.

### A file both AgentFlow and the project changed

For each path in `missingChoices` as `resolution:<path>`, keep your bytes or take AgentFlow's:

```json
{ "resolutions": { "docs/adopters/index.md": "preserve" } }
```

`preserve` leaves your file byte for byte. `replace` writes AgentFlow's version.

### A legacy lock

A lock from an older AgentFlow release is never adopted silently. To migrate it, choose:

```json
{ "migrateLegacy": true }
```

The preview then shows the new lock and every file the migration writes.

### An unknown or malformed lock

A lock AgentFlow cannot read stays unknown until you choose to recover it. Recovery also needs a
decision for every conflicting path:

```json
{ "recoverUnknown": true, "resolutions": { "AGENTS.md": "preserve" } }
```

### An invalid configuration file

When `agent-workflow.config.json` is not a JSON object, the journey stops before planning. Repair
the file yourself; the journey never rewrites it to make a preview pass. Then preview again.

### Defer a framework update

When an installation can be brought forward, the preview lists the updated files. To keep the
current version for now, choose:

```json
{ "deferUpdate": true }
```

Nothing is written. The report records the deferral and stays not ready until you take the update.

### Project settings

A first adoption may also set configuration, for example `{ "config": { "posture": "assisted" } }`.
For an adopted project, use the [refinement journey](assisted-configuration.md) instead.

## Confirm and apply

```bash
agentflow-sdlc onboarding apply --target /path/to/your-project --confirm <digest>
```

Pass the same `--choices`, `--runtime-request` and `--runtime-evidence` flags you previewed with,
or `--plan onboarding-plan.json` for a saved preview. Apply previews again and writes only when
`--confirm` matches. Leaving out `--confirm` declines: nothing is written, and the report says the
preview was not confirmed. A preview that no longer matches the project is refused as stale.

Apply journals every file before it changes it, writes the lock last, and on any ordinary failure
restores the prior bytes. It ends with the readiness report and an `undo` command.

## Read the readiness report

Every step prints a `report`, including a step that stopped. It states three separate facts:

- `project`: `installed` means AgentFlow's files and lock are current, and `ready` also needs a test
  command or check the project can run.
- `runtime`: `status` is `ready`, `not-ready`, or `not-checked`. Without runtime evidence it is
  `not-checked`, never `ready`. An unknown observation is never reported as ready.
- `governedChange`: `ready` is always `false` here. Adopting or refining a project is not a
  product change. A governed change needs an issue contract and verification evidence from a run.

`outcome` is `completed` or `stopped`, with the reason under `stop`. `blockers` lists everything
that blocks. `nextAction` is one recommended step, with a link to its section on this page or the
refinement page. `undo` and `recover` give exact commands when they apply.

To read the report again at any time:

```bash
agentflow-sdlc onboarding verify --target /path/to/your-project --json
```

## Check the runtime

The runtime, not AgentFlow, installs and discovers tools. To include it in the report, save a
request, have the runtime write matching observations, and pass both to plan, apply and verify:

```bash
agentflow-sdlc onboarding runtime-request --runtime current > runtime-request.json
agentflow-sdlc onboarding plan --target /path/to/your-project --runtime-request runtime-request.json --runtime-evidence runtime-evidence.json
```

Observations follow [the runtime schema](../schemas/onboarding-runtime.schema.json). Unknown
observations stay unknown; do not fill them with successful examples. Updating shared tools is a
separate decision from adopting a project, and other runtimes are included only on request.

## Recover an interrupted apply

If an apply was interrupted, every later step reports it first, with the exact command:

```bash
agentflow-sdlc onboarding recover --target /path/to/your-project --confirm <recovery-token>
```

Recovery finishes or reverses the interrupted writes, refuses if a file drifted since, and prints
the readiness report. Preview again afterwards.

## Undo

The apply's report gives the exact command, for example:

```bash
agentflow-sdlc onboarding undo --target /path/to/your-project --receipt .agentflow/transactions/<id>/receipt.json --confirm <receipt-token>
```

The receipt (the record of what the apply changed) holds the prior bytes of every file. Undo
restores them exactly and removes files the apply created. It refuses when a file changed after
the apply. The transaction record stays under the ignored `.agentflow/transactions/` directory.

## Start the first governed change

Once the report's `nextAction` is this step, the project can carry a governed change: open a run,
freeze its acceptance contract, and verify it, as in the six commands above. Define real checks
and acceptance criteria with [run operations](run-operations.md#inspect-and-configure).

## Hand the journey to an agent

An agent can run this journey with you. Print the handoff prompt with
`agentflow-sdlc onboarding-prompt --target /path/to/your-project`, or copy it from
[assisted onboarding](assisted-onboarding.md). The agent follows these same steps and asks you
before it confirms.

## Low-level commands

These remain for scripts and maintainers. None of them is a way in.

- `init` applies the same plan as `onboarding plan` without a separate confirmation. It writes no
  file that preview would not show, and its output includes the undo receipt.
- `adopt` is AgentFlow's file transaction on its own, without detection or the readiness report.
- `config sync` changes other agents' harnesses. It runs only when you ask for it.
- `harness scaffold` writes the four harness defaults outside a transaction.

## What to configure next

Once initial files are committed, bootstrap local governance templates if using GitHub:

```bash
# Bootstrap GitHub issue forms, label taxonomies, and PR checklists
agentflow-sdlc github setup --target /path/to/your-project --apply
```

To change posture, branches, checks or CI commands later, use the
[refinement journey](assisted-configuration.md).

## Go deeper

This page is the fast path. For everything else:

| You want…                                                          | Read                                                |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| The problem, model, and evidence flow before you install           | [AgentFlow in 5 minutes](agentflow-in-5-minutes.md) |
| A route by audience or job (maintainer, provider author, operator) | [Start here](start-here.md)                         |
| A later change to an adopted project                               | [Refine your setup](assisted-configuration.md)      |
| Every field the journey can write                                  | [Project configuration](project-config.md)          |
| The complete map of every document                                 | [Documentation index](index.md)                     |
| What a finished phase of work looks like, saved as a file          | [Agent workflow](agent-workflow.md)                 |

## Contribute to AgentFlow

To work on AgentFlow itself, follow the [contribution workflow](guides/contribution-workflow.md)
for source checkout and framework validation instructions.
