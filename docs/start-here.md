# Start here

This page routes humans and agents to the right AgentFlow SDLC document without making the README carry every detail.

## If you are evaluating AgentFlow

1. Read [`agentflow-in-5-minutes.md`](agentflow-in-5-minutes.md).
2. Use [`get-started.md`](get-started.md) for the onboarding path.
3. Review examples in [`examples/`](examples/).

## If you are installing AgentFlow in a project

1. Start with [`assisted-onboarding.md`](assisted-onboarding.md).
2. Check environment expectations in [`environment-tools.md`](environment-tools.md).
3. Use [`project-setup.md`](project-setup.md) and [`project-config.md`](project-config.md) to choose branch, validation, and routing defaults.
4. Use [`assisted-update.md`](assisted-update.md) for existing installations.

## If you are doing issue work

1. Read [`../AGENTS.md`](../AGENTS.md).
2. Read the active adapter file for your executor.
3. Read [`agent-workflow.md`](agent-workflow.md).
4. Read [`issue-standards.md`](issue-standards.md).
5. Read the active issue or `SPEC.md`.
6. Use [`guides/contribution-workflow.md`](guides/contribution-workflow.md).

## If you are learning the model

| Concept                   | Doc                                                            |
| ------------------------- | -------------------------------------------------------------- |
| Product overview          | [`agentflow-in-5-minutes.md`](agentflow-in-5-minutes.md)       |
| Workflow phases           | [`agent-workflow.md`](agent-workflow.md)                       |
| Intelligent collaboration | [`intelligent-collaboration.md`](intelligent-collaboration.md) |
| Execution targets         | [`execution-targets.md`](execution-targets.md)                 |
| Portable capabilities     | [`capabilities.md`](capabilities.md)                           |
| Project config            | [`project-config.md`](project-config.md)                       |
| Release versioning        | [`release-versioning.md`](release-versioning.md)               |

## If you are an agent

Use this deterministic entry sequence:

1. `AGENTS.md`
2. active adapter (`CLAUDE.md`, `CODEX.md`, `AGY.md`, or equivalent)
3. `docs/agent-workflow.md`
4. `docs/issue-standards.md`
5. active issue or `SPEC.md`

Then use role packages under `agents/roles/` and workflow skills under `agents/workflows/` as needed.
