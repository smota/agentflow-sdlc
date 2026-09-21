# Non-functional verification

This pack requests `read` and `shell` as tool permissions, requires branch-protection evidence as a
control, and contributes an Architect-bound play (`quality-attribute-targets`) and a Tester-bound play
(`nfr-verification`). It augments quality attribute evidence and tools; it does not change the core
graph, ownership, readiness, or approvals.

This extension pack adds standardized non-functional requirements (NFR) discipline to the AgentFlow
SDLC workflow. Grounded in ISO/IEC 25010, it enables software delivery teams to define checkable quality
attribute targets and record candidate-bound measurement evidence across 11 key engineering areas.

## Use this pack when

- architecture decisions need explicit non-functional targets (security, performance, reliability, etc.);
- changes require candidate-bound measurement evidence rather than narrative assertions;
- quality attribute coverage must be audited against ISO/IEC 25010 standards;
- projects want mechanical checkers to reject blanks and unmeasured pass claims.

## The 11 Quality Areas

1. `security`
2. `privacy and compliance`
3. `performance and capacity`
4. `reliability`
5. `observability`
6. `operability`
7. `compatibility and versioning`
8. `cost`
9. `usability and accessibility`
10. `maintainability and testability`
11. `portability and environment`

## What this pack adds

- `templates/nfr-targets.md`: Standardized format for stating quality attribute targets and applicability.
- `templates/nfr-evidence.md`: Standardized format for recording candidate-bound measurement results.
- `validators/validate-nfr-templates.mjs`: Verification tool ensuring all 11 areas and required table headers are present.
- Architect play `quality-attribute-targets` and Tester play `nfr-verification`.

## What this pack excludes

This pack defines harness-neutral and stack-neutral formats. It does not dictate specific benchmarking suites, load testing frameworks, static analysis vendors, or telemetry platforms. Core SDLC contracts (`schemas/`, `manifests/`, `lib/`) remain unmodified in Phase 1.

## Role expectations

- **Architect:** evaluate each of the 11 areas using `templates/nfr-targets.md`. State explicit targets for applicable areas or provide documented reasons for non-applicable areas.
- **Tester:** verify targets against the candidate change using `templates/nfr-evidence.md`. Provide measured values, units, thresholds, sample sizes, and verifiable origins.

## Validation

Run from the repository root:

```bash
node scripts/validate-extension-packs.mjs --run-validators
```
