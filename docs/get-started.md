# Get started

You can evaluate AgentFlow without changing your project. The recommended path is read-only inspection, an explicit setup proposal, then an approved installation.

## Prerequisites

- Node.js 20 or newer
- Git
- pnpm for working from this source repository
- GitHub CLI only when you want issue, PR, or release automation

The current documented distribution path is a source checkout. The package is not yet published on npm.

## 1. Check the environment read-only

```bash
git clone https://github.com/smota/agentflow-sdlc.git
cd agentflow-sdlc
pnpm install
node bin/cli.mjs doctor-env --target /path/to/your/project
```

`doctor-env` reports required and optional tools. It does not install software or change the target. Tool probes depend on the local executables returning normally; if a package manager hangs, stop the command and verify that tool directly before continuing.

## 2. Generate the onboarding prompt

```bash
node bin/cli.mjs onboarding-prompt --target /path/to/your-project
```

Give the output to your assistant. It asks the assistant to:

- inspect existing instructions and project docs;
- preserve local conventions;
- ask for branch, validation, routing, and automation choices;
- propose exact setup commands;
- wait for approval before writing.

You can also copy the maintained prompt directly from [assisted onboarding](assisted-onboarding.md).

## 3. Review the proposed setup

Before approving writes, confirm:

| Decision              | Typical safe default                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Execution             | One agent moving through explicit roles                                                     |
| Durable evidence      | GitHub issues, comments, commits, and PR bodies                                             |
| Local scratch         | `.agent-runs/`, never committed                                                             |
| Branching             | Work branch into the configured integration branch                                          |
| Review                | Evidence-backed self-review for bounded/standard work; human review for high-assurance work |
| Existing instructions | Merge or preserve; never overwrite silently                                                 |

Use [project setup](project-setup.md) for the decision checklist and [project config](project-config.md) for every field.

## 4. Initialize after approval

From the AgentFlow checkout:

```bash
node bin/cli.mjs init --target /path/to/your-project
```

`init` installs framework-owned files and seeds project-owned files once. Review the diff before committing. Existing project-owned policy is not silently overwritten.

In the target repository, commit the generated `agent-framework-lock.json` with the approved files. The lock lets future syncs distinguish safe framework updates from project-owned content.

## 5. Verify the installation

```bash
node /path/to/agentflow-sdlc/bin/cli.mjs doctor --target /path/to/your-project
node /path/to/agentflow-sdlc/bin/cli.mjs sdlc validate --target /path/to/your-project
```

Then run the target repository's configured validation commands.

## Existing installations

Plan updates before syncing:

```bash
node bin/cli.mjs update-prompt --target /path/to/your-project
node bin/cli.mjs doctor --target /path/to/your-project
```

After reviewing and approving the plan:

```bash
node bin/cli.mjs sync --target /path/to/your-project
```

If a framework file was intentionally hand-merged and should remain project-managed:

```bash
node bin/cli.mjs mark-merged CLAUDE.md --target /path/to/your-project
```

See [assisted update](assisted-update.md) for conflict classifications and the approval boundary.

## Verify this framework checkout

Contributors and maintainers run:

```bash
pnpm test
pnpm test:workflow
pnpm test:evals
pnpm format:check
node scripts/verify-hooks.mjs
node scripts/validate-npm-package.mjs
```

Next: choose a route in [Start here](start-here.md), or browse the complete [documentation index](index.md).
