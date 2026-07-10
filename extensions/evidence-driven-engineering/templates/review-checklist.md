# Evidence-driven review checklist

## Requirement fit

- [ ] The implementation maps to the issue/spec acceptance criteria.
- [ ] Out-of-scope findings are captured as follow-up issues, not hidden TODOs.

## Decision quality

- [ ] Material decisions name context, selected approach, alternatives, and tradeoffs.
- [ ] ADRs are created or updated when the decision sets precedent.
- [ ] Project-owned policy is not overwritten by reusable framework guidance.

## Risk and safety

- [ ] Sensitive surfaces are identified and receive the right review depth.
- [ ] Review is read-only unless work is explicitly returned to implementation.
- [ ] Rollback/undo path is documented when relevant.

## Validation evidence

- [ ] Required validation ran, or not-run reasons are explicit.
- [ ] Expected failures link to follow-up issues.
- [ ] PR body does not claim stronger validation than the evidence supports.
