# Get started

AgentFlow SDLC is easiest to evaluate with an assistant. The recommended path is read-only first: inspect the project, preserve existing instructions, ask for choices, then propose setup commands before running anything.

## 1. Assisted onboarding

Copy this prompt into your agent:

```text
Use the AgentFlow SDLC assisted onboarding guide:
https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-onboarding.md

Apply it to this existing project. First inspect existing agent instructions and project docs. Validate the environment read-only. Ask me to choose agents, execution mode, branch strategy, validation commands, and GitHub automation. Propose install/setup commands but do not execute them without explicit approval. Preserve or merge existing instructions instead of overwriting them.
```

Or print the prompt locally:

```bash
node bin/cli.mjs onboarding-prompt --target /path/to/your-project
```

## 2. Install framework files

From a checkout of this repository:

```bash
git clone https://github.com/smota/agentflow-sdlc.git
cd agentflow-sdlc
pnpm install
node bin/cli.mjs init --target /path/to/your-project
```

`init` installs framework-owned files and seeds project-owned files once. Existing project-owned files are not overwritten silently.

## 3. Configure the project

Use [`project-setup.md`](project-setup.md) and [`project-config.md`](project-config.md) to set:

- validation commands;
- branch strategy;
- bounded-work rules;
- role routing;
- execution targets;
- extension packs.

## 4. Commit the lockfile

In the consuming project, review and commit the generated `agent-framework-lock.json` with the installed files. This lets `sync` distinguish framework-owned files from project-owned policy.

## 5. Sync or update later

For already adopted projects, start with the assisted update flow:

```bash
node bin/cli.mjs update-prompt --target /path/to/your-project
```

Then run sync only after review/approval:

```bash
node bin/cli.mjs sync --target /path/to/your-project
```

Use `mark-merged` for files that were hand-merged and should remain project-managed:

```bash
node bin/cli.mjs mark-merged CLAUDE.md --target /path/to/project
```

## 6. Verify this repository

From this repository:

```bash
pnpm test
pnpm test:workflow
pnpm format:check
node scripts/verify-hooks.mjs
```
