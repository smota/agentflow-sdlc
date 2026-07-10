# Evidence-driven engineering

This extension pack adds reusable engineering discipline to the core multi-agent SDLC workflow. It is intentionally stack-neutral: it defines how a team analyzes work, records decisions, validates outcomes, and prepares reviewable PRs without naming any application framework, cloud provider, database, or product domain.

## Use this pack when

- decisions should be traceable through ADRs or equivalent records;
- implementation should be gated by explicit analysis and risk classification;
- PRs need evidence for requirements, design, validation, review, and follow-up handling;
- the team wants repeatable guardrails without importing a source project's stack-specific rules.

## What this pack adds

- ADR shape and decision lifecycle expectations.
- Analysis-before-implementation guardrails.
- Evidence requirements for validation and PR readiness.
- Review checklist focused on decision quality and risk controls.
- Follow-up issue discipline instead of hidden TODOs or silent deferrals.
- Separation of reusable framework guidance from project-owned policy.

## What this pack excludes

Do not put stack, product, or organization-specific policy in this pack. Excluded examples include application frameworks, cloud providers, database technology, billing providers, tenant/domain rules, localization policy, and repository-specific CI command values.

## Role-pass expectations

- **Analyst:** identify acceptance criteria, assumptions, open questions, risk signals, and evidence needed before implementation.
- **Architect:** record decision options, selected approach, tradeoffs, reversibility, and any ADR need.
- **Developer:** implement only the accepted plan, record deviations, and avoid hidden TODOs.
- **Tester/validator:** run agreed checks or document not-run reasons with follow-up issues.
- **Reviewer:** review evidence completeness and decision quality, not only code correctness.
- **Orchestrator:** summarize pack evidence in the workflow-status comment and PR body.

## Validation

Run from the repository root after enabling the pack:

```bash
node scripts/validate-extension-packs.mjs --run-validators
```
