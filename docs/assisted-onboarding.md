# Assisted onboarding

Use this guide when adding `multi-agent-sdlc` to an existing project. It is designed for a human and an agent to follow together: inspect first, validate read-only, ask explicit choices, propose changes, and preserve existing project instructions.

## Core rule: clarity over automation

The onboarding assistant may inspect files, summarize conflicts, and propose commands. It must not install tools, authenticate services, overwrite instructions, or modify project policy without explicit approval.

## Copy-paste agent handoff

```text
Use the multi-agent-sdlc assisted onboarding guide:
https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-onboarding.md

Apply it to this existing project. First inspect existing agent instructions and project docs. Validate the environment read-only. Ask me to choose agents, execution mode, branch strategy, validation commands, and GitHub automation. Propose install/setup commands but do not execute them without explicit approval. Preserve or merge existing instructions instead of overwriting them.
```

## OS-specific launch examples

These examples start an agent-assisted onboarding conversation. They do not install missing tools automatically.

### macOS / Linux shell

```bash
pi "Use the multi-agent-sdlc assisted onboarding guide: https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-onboarding.md. Apply it to this project. Validate environment read-only, ask choices, and propose commands without executing installs."
```

### Windows PowerShell

```powershell
pi "Use the multi-agent-sdlc assisted onboarding guide: https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-onboarding.md. Apply it to this project. Validate environment read-only, ask choices, and propose commands without executing installs."
```

### Windows Git Bash

```bash
pi "Use the multi-agent-sdlc assisted onboarding guide: https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-onboarding.md. Apply it to this project. Validate environment read-only, ask choices, and propose commands without executing installs."
```

If you use Claude, Codex, Agy, Omnigent, or another harness, use the same prompt with that client.

## Onboarding checklist

1. **Read existing instructions**
   - `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `AGY.md`, `.github/`, README, docs, hooks, and project conventions.
   - Identify conflicts before proposing changes.

2. **Validate the environment read-only**

   ```bash
   node /path/to/multi-agent-sdlc/bin/cli.mjs doctor-env --target /path/to/project
   ```

   Use [`environment-tools.md`](environment-tools.md) to explain missing tools and install options.

3. **Install or sync framework files only with approval**

   ```bash
   node /path/to/multi-agent-sdlc/bin/cli.mjs init --target /path/to/project
   node /path/to/multi-agent-sdlc/bin/cli.mjs sync --target /path/to/project
   ```

   Existing instructions must be preserved or merged. Do not overwrite project-owned content without a reviewed plan.

4. **Choose project defaults**
   - enabled agents/runtimes;
   - single-agent default or optional routing;
   - branch strategy;
   - CI-equivalent validation commands;
   - bounded-work paths and sensitive paths;
   - GitHub integration lifecycle automation;
   - release versioning strategy (`main.minor.fix` by default), tag format, package version source, and release approval expectations;
   - optional `qa-expert` exploratory QA and its browser/API/accessibility/evidence tooling;
   - optional Omnigent policies/sandboxing.

5. **Review skills and provenance**
   - install workflow skills only with approval;
   - document local skill locations and upstream sources;
   - record project-specific overrides.

6. **Summarize outcome**
   - files changed;
   - choices made;
   - commands proposed but not run;
   - unresolved conflicts;
   - next issue/PR steps.

## Optional CLI prompt helper

From this repository you can print the onboarding prompt without changing any project files:

```bash
node bin/cli.mjs onboarding-prompt
node bin/cli.mjs onboarding-prompt --target /path/to/project
```

The helper prints instructions only. It does not run setup commands.
