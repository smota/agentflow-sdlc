# ADR 001 — Role-based single-agent, phase-driven workflow

**Status:** Accepted
**Date:** 2026-07-07

## Context

Coordinating multiple separate agent processes (one per role) for every issue adds handoff
overhead, state-sync bugs, and coordination failure modes without a proportional quality gain for
most work. A single executing agent can adopt each role as an explicit, evidence-producing pass
instead.

This decision and its supporting mechanics (phase state machine, role-pass contract, workflow
profiles, branch strategy, PR manifest rules) originated in Ativaly's `docs/agent-workflow.md` and
are extracted here unchanged, since they carried no application-specific coupling.

## Decision

Adopt a single-agent, multi-role, phase-driven workflow as the default operating model:

- One executing agent runs an issue through explicit role passes (analyst, architect, developer
  planning, developer, tester, review, tech writer, PR readiness), each producing a role-pass
  artifact.
- Work is classified along three independent dimensions — risk, effort, change surface — which
  select a workflow profile (bounded, standard, high-assurance) controlling review depth, not
  whether evidence exists.
- Multi-agent delegation remains available for broad discovery, advisory review, or asynchronous
  support, but is never the default implementation path.
- High-assurance security/acceptance gates require human review at the PR stage; bounded/standard
  work allows explicit, evidence-backed self-review.

Full mechanics: `docs/agent-workflow.md`, `agents/workflows/orchestrate/SKILL.md`,
`agents/templates/role-pass.md`.

## Consequences

**Positive:** one execution context per issue, less coordination overhead, machine-checkable
evidence per phase, portable across any project regardless of tech stack.

**Negative:** role skill _content_ (the domain checklist each persona applies) is not part of this
decision — each consuming project must supply its own via `docs/stack-conventions.md`
(template: `agents/templates/stack-conventions.md`).
