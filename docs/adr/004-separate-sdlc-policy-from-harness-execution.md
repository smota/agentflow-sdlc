# ADR 004 — Separate SDLC policy from harness execution

**Status:** Accepted
**Date:** 2026-09-01

## Context

AgentFlow defines reusable SDLC semantics: roles, lifecycle transitions, evidence, governance,
configuration, validation, migration, and release readiness. Harnesses define how a particular
workstation or agent runtime discovers project instructions, creates execution contexts, invokes
tools or models, and returns runtime evidence.

The v1 implementation mixes some of these concerns. Collaboration planning includes environment and
helper-launch details, execution targets are organized around built-in agent names, and repository
source operations are embedded in GitHub and Cockpit modules. This makes reuse harder and can cause
AgentFlow to duplicate orchestration that belongs to a harness.

AI Foundry Desk was inspected at commit
`d5cb4588c33d4fb2ed7fdf589e42782e64b741fb`. Its project-harness contract owns policy audit,
hash-bound planning, external staging, disposable smoke tests, confirmed transactional apply,
verification, and rollback. It does not own AgentFlow roles, lifecycle policy, readiness, or evidence
meaning.

## Decision

AgentFlow owns the portable SDLC domain and emits collaboration intent. It does not implement a
general multi-agent runtime, workstation manager, provider catalog, credential broker, process
supervisor, or project-instruction installer.

Harness integrations are optional providers behind versioned, capability-based ports. AI Foundry
Desk may supply project-adapter, workspace, execution, and receipt capabilities only where its pinned
contract proves them. AgentFlow must not copy AFD orchestration or infer support from a harness name.

`sdlc.config.json` is authoritative for domain vocabulary and policy. `agent-workflow.config.json`
contains consuming-project execution choices such as branches, CI commands, routing preferences,
enabled extensions, and source/provider bindings. Compatibility readers may accept legacy placement,
but canonical output uses the single owner.

## Consequences

**Positive:** AgentFlow remains harness-neutral; providers can evolve independently; responsibilities
are testable; unavailable optional harnesses have an explicit fallback instead of blocking the SDLC.

**Negative:** legacy configuration and execution behavior need adapters during migration; a provider
cannot be advertised until its capabilities and receipts pass contract tests.
