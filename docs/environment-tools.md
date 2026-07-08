# Environment tools

Use this guide to understand the local tools that make `multi-agent-sdlc` work well. Start with read-only validation and then choose what to install yourself. The framework must propose installation options, not execute them automatically.

## Validate first

Run environment validation from this repository or from an installed copy:

```bash
node bin/cli.mjs doctor-env --target /path/to/project
node bin/cli.mjs doctor-env --target /path/to/project --json
```

`doctor-env` is read-only. It reports `mutated: false`, lists found and missing tools, explains why each tool matters, and prints installation options. It does **not** install packages, edit shell profiles, authenticate GitHub, or change project files.

## Required core tools

| Tool    | Why it matters                                                                   | Validation       |
| ------- | -------------------------------------------------------------------------------- | ---------------- |
| `git`   | Branches, commits, PR workflow, release tags, and framework sync all assume Git. | `git --version`  |
| Node.js | Runs the CLI, validators, hooks, tests, and framework scripts.                   | `node --version` |

Use a current LTS version of Node.js. This repository declares its runtime expectation in `package.json` and uses Node-based scripts for cross-platform compatibility.

## Recommended workflow tools

| Tool            | Why it matters                                                                                                                                     | Validation       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `gh`            | Optimized GitHub issue/PR/release workflow: create issues, post comments, open PRs, inspect checks, close integrated issues, and publish releases. | `gh --version`   |
| Package manager | Runs project validation. This repo uses `pnpm`; adopting projects may use npm, pnpm, yarn, bun, or another configured tool.                        | Project-specific |

`gh` is not always required for reading files or editing code, but the optimized workflow assumes it for durable GitHub evidence and lifecycle automation.

## Agent clients and runtimes

Supported direct routing clients are project-configurable:

- `claude`
- `codex`
- `agy`
- `pi`

Optional meta-harness/runtime:

- `omnigent` — use when the project wants Omnigent to supervise agents, policies, sandboxes, or collaboration.

`agent-workflow.config.json` can define `routing.agents.<slug>.availabilityCommand`. `doctor-env` reads those commands and reports whether the configured optional agent/runtime is available. Missing optional tools do not block the default single-agent workflow unless your project has chosen to require them.

## Optional QA and integration tools

- `qa-expert` is an optional exploratory QA sidecar role. Its required tools depend on the adopting project and should be documented in project conventions.
- GitHub integration lifecycle automation uses GitHub Actions plus `gh` for local investigation. The workflow itself runs in GitHub with `contents: read`, `pull-requests: read`, and `issues: write` permissions.

## Installation options

These are examples for humans/operators to choose from. Agents should present them for approval, not run them automatically.

### macOS / Linux

```bash
# Git
brew install git

# GitHub CLI
brew install gh

# pnpm via Corepack
corepack enable pnpm
```

For Linux, prefer your distro package manager or each tool's official docs.

### Windows PowerShell

```powershell
# Git
winget install --id Git.Git

# GitHub CLI
winget install --id GitHub.cli
```

Install Node.js from the official Node.js site or your preferred version manager.

### Official docs

- Git: https://git-scm.com/downloads
- Node.js: https://nodejs.org/
- pnpm: https://pnpm.io/installation
- GitHub CLI: https://cli.github.com/
- Omnigent: https://github.com/omnigent-ai/omnigent

## Compatibility with `doctor-env`

When this document changes, keep `lib/environment.mjs` and `doctor-env` aligned. The docs should explain the same required/recommended/optional split that the command reports.
