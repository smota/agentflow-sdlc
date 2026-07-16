# Analysis guardrails

Use before implementation when a task is more than a trivial edit.

## Required analysis

- Issue/spec source and acceptance criteria.
- In-scope and out-of-scope work.
- Risk level and why.
- Change surfaces and likely files.
- Assumptions and open questions.
- Decision records or ADRs that constrain the work.
- Validation commands and expected evidence.
- Follow-up issues needed for deferred or out-of-scope findings.
- Rollback or undo path when applicable.

## Stop conditions

Stop and ask before implementation when:

- acceptance criteria are missing or contradictory;
- the work affects a sensitive surface not covered by the issue;
- validation requires unavailable credentials/services and no fallback evidence exists;
- a decision would create broad architectural precedent without an ADR or approval.

## Output shape

```markdown
## Analysis summary

- Scope:
- Non-goals:
- Risk:
- Change surfaces:
- Decisions/ADRs:
- Validation plan:
- Open questions: none | ...
```
