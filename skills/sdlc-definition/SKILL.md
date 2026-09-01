---
name: sdlc-definition
version: 1.0.0
description: Use when defining, designing, extending, or updating AgentFlow SDLC rules: paths, roles, gateways, labels, release model, readiness, human approval gates, or harness-neutral skill/agent compliance. Do not use for migration execution or read-only audit unless asked.
dependencies: []
permissions:
  - read:workspace
  - write:workspace
---

# AgentFlow SDLC Definition

Use this skill to define and maintain the canonical AgentFlow SDLC model.

## Required reads

1. `docs/sdlc-definition.md`
2. `sdlc.config.json` if present, otherwise `defaults/sdlc.config.json`
3. `docs/agent-workflow.md`
4. `docs/issue-standards.md`
5. `docs/execution-targets.md`
6. `docs/evidence-contracts.md`
7. `docs/lifecycle-boundaries.md`

## Rules

- Treat `docs/sdlc-definition.md` as human authority and `sdlc.config.json` as machine authority.
- Keep product source harness-neutral. Never create canonical files under `.pi`, `.claude`, `.agy`, or `.codex`.
- Preserve high-assurance human approval, role-pass provenance, readiness denominator rules, and no-secret/no-transcript evidence rules.
- Use AgentFlow concepts: Goal, Role Flow, Readiness, Release, Human approval gate, Follow-up, Source.
- Treat Cockpit as the optional first-class Goal Command Center: product artifact and release gates include it, runtime startup remains opt-in.
- Define extensions only when owner, compatibility, migration behavior, and validator are clear.
- Emit canonical role/profile vocabulary. Keep workflow capabilities, tool permissions, and control
  requirements in separate namespaces.
- Treat `ArtifactRef`, transition envelopes, external signals, delivery handoffs, and action
  boundaries as versioned portable evidence contracts. They do not transfer external-system
  authority or add mandatory phases.
- Keep eval-driven improvements owner-reviewed; never mutate policy automatically from an eval.

## Workflow

1. Identify whether request changes principles, paths, roles, labels, gates, release rules, validators, or adapter policy.
2. Update `docs/sdlc-definition.md` and config/schema together when the model changes.
3. Update templates/checklists/evals when role or gate behavior changes.
4. Run deterministic validation:
   ```bash
   node scripts/validate-sdlc-config.mjs
   node scripts/validate-extension-packs.mjs --allow-empty
   node scripts/run-agent-evals.mjs --manifest agents/evals/manifests/framework-contracts.json
   ```
5. Record remaining gaps as follow-up issues, not hidden TODOs.

## Do not

- Perform project migration; use `sdlc-migration`.
- Give compliance verdicts only; use `sdlc-audit`.
- Duplicate validator logic in prose when a deterministic command exists.
