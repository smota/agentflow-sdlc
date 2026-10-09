# Assisted onboarding

An agent can run the [adoption journey](get-started.md) with you. It follows the same steps,
explains each preview in plain language, and asks before it confirms. Nothing here differs from
the journey itself: the commands, the choices, the readiness report and undo are all on
[Get started](get-started.md).

## Core rule: clarity over automation

The assistant inspects the project, presents the preview and its trade-offs, and asks for explicit
confirmation of the exact preview before anything is written. It does not authenticate services,
overwrite project instructions, install runtimes, or change another agent's harness.

## Copy-paste agent handoff

Paste this prompt into any coding agent or harness (Antigravity, Claude Code, Codex, Cursor, Pi,
Omnigent, etc.) running in your project repository, or print it with
`agentflow-sdlc onboarding-prompt --target /path/to/project`:

```text
You are acting as an AgentFlow SDLC assisted onboarding assistant. Follow the adoption journey:
https://github.com/smota/agentflow-sdlc/blob/main/docs/get-started.md

Run it with me on this repository: /path/to/project

Principles:
- The runtime discovers and provisions tool paths using its own mechanisms; AgentFlow does not execute host installation.
- The current runtime is the default scope; extra runtimes require an explicit request.
- Always assess updates, but updating shared tools is a separate decision from adopting a project.
- Unknown outcomes must be reconciled before repeating operations.
- Nothing is written before I confirm the exact preview.

1. Runtime:
   - If the CLI is missing, the runtime first provisions it through its own installation mechanism and verifies discovery; these CLI commands start after bootstrap.
   - Save a runtime request: `agentflow-sdlc onboarding runtime-request > .agent-runs/runtime-request.json`
   - The runtime writes fresh observations to .agent-runs/runtime-evidence.json matching that request ID and runtime ID. Use schemas/onboarding-runtime.schema.json; unknown observations remain unknown. Without them, runtime readiness is reported as not checked.

2. Inspect: `agentflow-sdlc onboarding inspect --target "/path/to/project" --json`. Review existing instructions (AGENTS.md, README, docs, .github/) and report any conflicts.

3. Preview: `agentflow-sdlc onboarding plan --target "/path/to/project" --runtime-request .agent-runs/runtime-request.json --runtime-evidence .agent-runs/runtime-evidence.json`
   - Summarize every file in its preview in plain English, and its readiness report.
   - If it asks for choices (conflicts, a legacy or unknown lock, a deferred update), ask me, write them to .agent-runs/choices.json, and preview again with --choices.

4. Confirm: Show me the digest and ask for explicit confirmation. If I decline, stop and report the readiness report.

5. Apply: `agentflow-sdlc onboarding apply --target "/path/to/project" --confirm <digest>` with the same flags as the preview.
   - Report the readiness report: project, runtime, and governed-change readiness separately, every blocker, the one next action, and the undo command. Governed-change readiness stays false: adoption is not a product change.
```

## After adoption

For later changes to posture, branches, checks or CI commands, use
[Refine your setup](assisted-configuration.md).
