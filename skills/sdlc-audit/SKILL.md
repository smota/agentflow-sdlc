---
name: sdlc-audit
version: 1.0.0
description: Use when auditing, validating, scoring, or reviewing AgentFlow SDLC compliance for a project, issue, PR, release, role-pass, agent, or skill. Defaults read-only and emits severity/evidence/fix recommendations.
dependencies: []
permissions:
  - read:workspace
---

# AgentFlow SDLC Audit

Use this skill for read-only SDLC compliance evaluation.

## Rules

- Read-only by default.
- Use deterministic validators before prose judgment.
- Report severity, source, evidence, and fix recommendation.
- Do not expose secrets, raw prompts, transcripts, full logs, or tool payloads.
- Do not mutate issues, PRs, files, labels, or adapters unless explicitly switched to migration/remediation.
- Validate canonical output vocabulary while allowing documented legacy aliases only at input
  boundaries. Confirm `exploratory` wherever profiles are enumerated.
- Audit `ArtifactRef` authority/revision/digest semantics, transition graph validity, action-boundary
  non-escalation, and the separation of capabilities, permissions, and controls.
- Treat eval and outcome reports as derived evidence, never policy or telemetry authority.

## Workflow

1. Identify audit profile: project, issue, PR, release, role-pass, agent, skill, or full.
2. Run relevant validators:
   ```bash
   node scripts/validate-sdlc-config.mjs --json
   node scripts/validate-sdlc-role-pass.mjs --path <file> --json
   node scripts/validate-sdlc-skill.mjs --path <skill>/SKILL.md --json
   agentflow-sdlc cockpit doctor --json
   node scripts/validate-extension-packs.mjs --allow-empty
   node scripts/run-agent-evals.mjs --manifest agents/evals/manifests/framework-contracts.json
   ```
3. Inspect durable evidence only as needed.
4. Treat Cockpit as optional but first-class: audit packaging, docs, and `cockpit doctor`, but do not require it to be running for SDLC compliance.
5. Return PASS/FAIL/WARN with fix recommendations.
6. Suggest follow-up issues for non-trivial fixes.

## Output

- summary
- findings table
- command evidence
- residual risks
- optional JSON report
