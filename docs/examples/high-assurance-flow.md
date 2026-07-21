# Example: high-assurance flow

High-assurance work includes sensitive surfaces such as auth, tenant isolation, RLS, schema migrations, billing, secrets, production permissions, or cross-tenant behavior.

## Scenario

A team changes authorization logic. Even if an agent implements the code, human review is required before merge.

## Required shape

1. Agent completes analysis, architecture, planning, implementation, deterministic testing, docs review, and PR readiness.
2. The PR is opened with complete evidence.
3. Human security and acceptance review happen on the open PR.
4. Merge waits for the human gate.

## PR evidence excerpt

```markdown
Implements #456

## Validation

Status: passed

- `pnpm test` — passed
- `pnpm test:workflow` — passed

## Agent review

Mode: single-agent
Implemented by: pi
Security review: blocked; high-assurance human review required on PR before merge.
Acceptance review: blocked; human acceptance required on PR before merge.
Merge owner: human/operator
```

## Why this helps

AgentFlow does not let AI speed bypass sensitive gates. It makes the gate visible, evidence-backed, and tied to the PR where humans can review the actual diff.
