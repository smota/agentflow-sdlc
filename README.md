# AgentFlow SDLC

Manage AI-assisted software delivery with consistency and durable evidence.

AgentFlow SDLC is an open-source process layer for AI-assisted software delivery. It gives people and agents a shared path from idea to pull request with clear roles, durable evidence, practical review gates, and intelligent collaboration when it helps.

AgentFlow SDLC 1.0 is the first mature release of this framework: stable enough for teams that want AI speed without losing clarity, review, or control.

## What this is

AgentFlow installs an opinionated SDLC around an existing project. It does not generate an app or replace your stack. It helps teams keep the surrounding delivery system clear:

- what was requested;
- why decisions were made;
- what changed;
- what was validated;
- who reviewed it;
- what should happen next.

## Why teams use it

- **Manageable AI-assisted work:** PRs and issue comments carry scope, validation, review mode, docs decisions, and follow-up status.
- **Resumable delivery:** another person or agent can continue without reconstructing a chat session.
- **Less process memory:** hooks, templates, and validators catch workflow drift.
- **Intelligent collaboration:** focused helper intelligence is available when uncertainty is high, while one accountable owner keeps evidence compact.
- **Human authority where it matters:** high-assurance decisions keep explicit human review.

## How it works

1. Clarify the request into acceptance criteria.
2. Choose the simplest safe path for the work.
3. Plan architecture, tests, docs, branch, and PR evidence before edits.
4. Implement within scope and branch rules.
5. Run validation and record results.
6. Open a PR with durable workflow evidence and follow-up status.

## Intelligent collaboration

The default remains one executor carrying context end to end. AgentFlow uses more AI intelligence only when it improves the decision: focused advisors for uncertainty, bounded discovery for broad context, isolated experiments for unclear strategy, and human gates for consequential choices.

> Increase intelligence per decision, not agents per task.

See [`docs/intelligent-collaboration.md`](docs/intelligent-collaboration.md).

## Try it

Start with the LLM-assisted onboarding guide. It inspects your project read-only, preserves existing instructions, asks for workflow choices, and proposes setup commands before anything changes.

```text
Use the AgentFlow SDLC assisted onboarding guide:
https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-onboarding.md

Apply it to this existing project. First inspect existing agent instructions and project docs. Validate the environment read-only. Ask me to choose agents, execution mode, branch strategy, validation commands, and GitHub automation. Propose install/setup commands but do not execute them without explicit approval. Preserve or merge existing instructions instead of overwriting them.
```

Prefer command output?

```bash
node bin/cli.mjs onboarding-prompt --target /path/to/your-project
```

Already adopted AgentFlow? Use [`docs/assisted-update.md`](docs/assisted-update.md) or:

```bash
node bin/cli.mjs update-prompt --target /path/to/your-project
```

## Opinionated SDLC baseline

AgentFlow SDLC encodes a baseline way to manage AI-assisted delivery. It is opinionated where consistency and safety matter, and extensible where teams need local fit.

Core principles:

- Durable evidence over private chat memory.
- Manageable role flow with explicit ownership and handoffs.
- Single-agent execution by default; more agents only when they improve a decision.
- Human authority for high-assurance work.
- Follow-up issues instead of hidden TODOs.
- Harness adapters are generated surfaces, not product source.

Baseline workflow:

1. Product/JTBD framing.
2. Analysis and acceptance criteria.
3. Architecture and path selection.
4. Developer planning.
5. Implementation.
6. Testing and validation evidence.
7. Review.
8. Documentation/release notes.
9. PR readiness and follow-up closeout.

Adopters can extend roles, workflow paths, labels, gates, validators, release policies, skills, and harness adapters while preserving provenance, readiness rules, high-assurance approval, and no-secret durable evidence.

## Cockpit Goal Command Center

Cockpit is the optional, first-class Goal Command Center for AgentFlow SDLC. CLI/GitHub workflow remains authoritative and fully usable without starting Cockpit; Cockpit reads durable SDLC records and presents goals, readiness, role flow, releases, approvals, replay, follow-ups, and safe workflow actions.

Start it when you want visual operations:

```bash
AGENTFLOW_REPOSITORIES=owner/repo agentflow-sdlc cockpit
agentflow-sdlc cockpit doctor --json
```

Read more: [`docs/cockpit.md`](docs/cockpit.md) and [`docs/cockpit-concepts-and-rules.md`](docs/cockpit-concepts-and-rules.md).

## Documentation map

| Need                                   | Go here                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Understand the product in five minutes | [`docs/agentflow-in-5-minutes.md`](docs/agentflow-in-5-minutes.md)             |
| Pick the right doc                     | [`docs/start-here.md`](docs/start-here.md)                                     |
| Install or evaluate                    | [`docs/get-started.md`](docs/get-started.md)                                   |
| Run issue work or contribute           | [`docs/guides/contribution-workflow.md`](docs/guides/contribution-workflow.md) |
| Learn intelligent collaboration        | [`docs/intelligent-collaboration.md`](docs/intelligent-collaboration.md)       |
| Use optional Goal Command Center       | [`docs/cockpit.md`](docs/cockpit.md)                                           |
| Follow the workflow contract           | [`docs/agent-workflow.md`](docs/agent-workflow.md)                             |
| Follow issue rules                     | [`docs/issue-standards.md`](docs/issue-standards.md)                           |
| Configure a project                    | [`docs/project-config.md`](docs/project-config.md)                             |
| See examples                           | [`docs/examples/`](docs/examples/)                                             |
| Review 1.0 release notes               | [`docs/releases/v1.0.0.md`](docs/releases/v1.0.0.md)                           |

## What is included

- Repository policy: `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `AGY.md`.
- Workflow docs and templates under `docs/` and `agents/templates/`.
- Agent package: `agents/agentflow-sdlc/`.
- Role-agent packages: `agents/roles/`.
- Workflow skills: `agents/workflows/orchestrate/`, `scan/`, and `intelligent-collaboration/`.
- Validators and helpers under `scripts/` and `lib/`.
- Optional Cockpit Goal Command Center: `agentflow-sdlc cockpit`.
- Examples and eval scaffolding under `docs/examples/` and `agents/evals/`.

## Contributing

Start from a GitHub issue or explicit maintainer direction. Read `AGENTS.md` first, then use [`docs/guides/contribution-workflow.md`](docs/guides/contribution-workflow.md).

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
