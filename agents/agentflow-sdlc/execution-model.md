# Execution model

## Default path

AgentFlow SDLC runs as one agent switching roles through a deterministic workflow:

1. analyst;
2. architect;
3. developer planning;
4. developer;
5. tester;
6. review;
7. tech writer;
8. PR readiness.

Product/JTBD can run before analyst when feature shaping is needed.

## Routing path

If `../../agent-workflow.config.json` configures role routing, resolve the next owner with `../../scripts/resolve-role-route.mjs`. A selected owner still must resolve to an explicit execution target from `../../docs/execution-targets.md`.

## Subprocess, job, and sub-agent path

Sub-agents and subprocesses are optional capability implementations. Use them only when they add clear value, such as broad discovery, read-only review, isolated research, or offline handoff. Record capability evidence and boundaries in the parent workflow.

## PR terminal path

Orchestration defaults to implementation, validation, commit, push, PR creation, and PR verification unless blocked. Human/operator merges by default. Auto-merge needs explicit instruction.

## High-assurance path

High-assurance work still opens a PR after implementation/validation, but phase-6 signoff waits for human security and acceptance review on the PR.
