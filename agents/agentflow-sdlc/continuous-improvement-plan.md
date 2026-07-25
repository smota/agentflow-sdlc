# Continuous improvement plan

## Feedback sources

- GitHub issue comments and follow-up issues;
- PR review findings and failed PR manifest validation;
- validator failures from `pnpm test:workflow`, role routing, branch strategy, extension packs, and capability evidence;
- downstream adopter reports from assisted onboarding/update runs;
- release closeout notes and changelog entries.

## Triage loop

1. Classify feedback as defect, docs gap, eval gap, adapter gap, or validator gap.
2. Create or update a GitHub issue using `../../docs/issue-standards.md`.
3. Add regression fixture or eval assertion when behavior should never regress.
4. Update package docs only after confirming canonical authority sources.
5. Record validation and release-note impact in PR manifest.

## Changelog workflow

Use `CHANGELOG.md` for package-level changes and `../../docs/releases/` for repository release notes. Entries should name user-visible behavior, evidence contract changes, validator changes, and migration guidance.

## Level 5 exit criteria

AgentFlow SDLC can claim stronger Level 5 maturity when:

- executable eval suites cover onboarding, issue/PR evidence, routing, capability evidence, package completeness, and false multi-agent claims;
- benchmark fixtures are versioned;
- eval results are recorded in CI or release validation;
- feedback triage routinely creates regression tests or docs updates;
- changelog entries tie improvements to evidence.
