---
name: sdlc-migration
version: 1.0.0
description: Use when adopting, migrating, converting, upgrading, or rolling out AgentFlow SDLC in an existing project. Produces inventory, mapping, dry-run migration plan, safe patches, and rollout handover.
dependencies: []
permissions:
  - read:workspace
  - write:workspace
---

# AgentFlow SDLC Migration

Use this skill to help project owners adopt AgentFlow SDLC safely.

## Rules

- Default to dry-run and preview-first.
- Preserve issue history, milestones, labels, comments, and accepted criteria.
- Use section-targeted issue updates where possible.
- Do not silently rewrite issue bodies or PR manifests.
- Do not create canonical product files under `.pi`, `.claude`, `.agy`, or `.codex`.
- Never convert incidental semver into release assignment.
- Preserve existing role-pass v1 evidence and legacy input aliases while migrating new output to
  canonical roles and versioned portable evidence contracts.
- Treat external signal and delivery systems as referenced authorities, not AgentFlow-owned stores.

## Workflow

1. Inventory current repo docs, config, labels, issue templates, PR templates, validators, and harness files.
2. Map current process to AgentFlow SDLC concepts.
   Include role/profile aliases, capability/permission/control namespaces, evidence references,
   transition envelopes, action boundaries, extension plays, evals, and outcome projections.
3. Classify gaps by severity.
4. Produce migration plan with dry-run patch list.
5. Apply only after explicit approval.
6. Run:
   ```bash
   node scripts/validate-sdlc-config.mjs
   node scripts/validate-sdlc-issue.mjs --json < issue.json
   ```
7. Record unsafe or deferred changes as follow-up issues.

## Output

- readiness summary
- canonical mapping
- gap list
- dry-run changes
- validation commands
- rollout plan
- residual risks
