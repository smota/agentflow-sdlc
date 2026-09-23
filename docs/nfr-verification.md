# Non-Functional Verification Pack

This guide covers the `extensions/nfr-verification` extension pack, which provides a structured,
verifiable way to state non-functional requirement (NFR) targets and record candidate-bound verification
evidence across 11 ISO/IEC 25010 quality areas.

## Why targets and evidence matter

Quality attributes such as security, latency, availability, and maintainability are frequently claimed
in architectural reviews as narrative assertions without measurable targets or verification data.

This pack provides:

1. **Target explicitness:** Architect-stated quality attribute targets before implementation.
2. **Accountability for all areas:** Systematic review of all 11 quality areas so none are silently ignored.
3. **Candidate-bound evidence:** Measurement data explicitly bound to a specific Git commit SHA or content digest.
4. **Mechanical validation:** Fast, local checker tools that catch blank areas, missing targets, unstated not-applicable reasons, and unmeasured pass claims.

## The 11 ISO/IEC 25010 Quality Areas

The pack adopts the ISO/IEC 25010 product quality model. Every non-trivial change must account for all 11 areas:

| Area                              | Scope                                                            | Typical Verification                       |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `security`                        | Authentication, input safety, encryption, vulnerability posture  | Deterministic tools (e.g. static analysis) |
| `privacy and compliance`          | PII handling, data governance, regulatory constraints            | Audit review or policy checks              |
| `performance and capacity`        | Latency, throughput, resource consumption, payload limits        | Benchmarks, load tests                     |
| `reliability`                     | Availability, error tolerance, fault recovery, data integrity    | Automated test suites                      |
| `observability`                   | Log structure, trace propagation, health checks, metric emission | Telemetry validation checks                |
| `operability`                     | Configuration ergonomics, deployment safety, rollback runbooks   | Runbook or CLI verification                |
| `compatibility and versioning`    | API compatibility, schema contracts, migration safety            | Schema diffs, contract tests               |
| `cost`                            | Compute, storage, memory, cloud API usage impact                 | Cost model audit                           |
| `usability and accessibility`     | User interface ergonomics, viewport layout, accessibility        | Visual audits, manual inspection           |
| `maintainability and testability` | Modularity, test coverage, code complexity, lint standards       | Linters, test coverage tools               |
| `portability and environment`     | OS matrix, runtime versions, architecture neutrality             | Cross-platform CI tests                    |

## Templates

The pack contributes two templates:

### 1. Targets Template (`templates/nfr-targets.md`)

Used by the **Architect** role in play `quality-attribute-targets`:

```markdown
## Non-functional targets

| ID     | Area                   | Applies | Target or Decision                      | Verification  | Check or Tool | Required | Reason (if not applicable) |
| ------ | ---------------------- | ------- | --------------------------------------- | ------------- | ------------- | -------- | -------------------------- |
| NFR-01 | security               | yes     | No untrusted inputs or shell injections | deterministic | bandit        | yes      | -                          |
| NFR-02 | privacy and compliance | no      | -                                       | manual        | review        | no       | No PII collected or stored |
| ...    |
```

Rules:

- If `Applies: yes`, `Target or Decision` and `Verification` (`deterministic | semantic | manual`) must be stated.
- If `Applies: no`, `Reason (if not applicable)` must state a non-empty rationale. A blank or hyphen is rejected.

### 2. Evidence Template (`templates/nfr-evidence.md`)

Used by the **Tester** role in play `nfr-verification`:

```markdown
## Non-functional verification evidence

| Target ID | Check or Tool | Environment | Candidate Identity | Measured Value | Unit            | Threshold | Sample Size | Outcome | Observed At          | Origin             |
| --------- | ------------- | ----------- | ------------------ | -------------- | --------------- | --------- | ----------- | ------- | -------------------- | ------------------ |
| NFR-01    | bandit        | local-cli   | 95f2ef8            | 0              | vulnerabilities | <= 0      | 1 tool      | pass    | 2026-09-21T05:40:00Z | collector-observed |
```

Rules:

- If `Outcome: pass`, `Candidate Identity`, `Measured Value`, and `Unit` must be non-empty and non-placeholder.
- If `Outcome: not-run`, `blocked`, or `unknown`, an explicit reason must be provided.
- Required targets cannot rest on `agent-reported` evidence alone without explicit `--allow-agent-reported` opt-in.

## Observation Vocabulary Mapping

The pack vocabulary aligns with the core framework observation model (`lib/core/verification-observation.mjs`):

- **Outcomes:** `pass`, `fail`, `blocked`, `not-run`, `unknown`.
- **Origins:**
  - `collector-observed`: Results gathered directly by an automated test runner, benchmark, or collector script.
  - `external-resolved`: Results verified by an external verification system or CI service.
  - `human-attested`: Manual verification attested by a human reviewer or operator.
  - `agent-reported`: Claims reported directly by an AI agent without third-party collector verification.

## Checker Tools

The pack includes two standalone CLI checkers in `extensions/nfr-verification/tools/`:

### Target Checker (`check-nfr-targets.mjs`)

Validates an NFR targets table against the 11 areas and completeness rules:

```bash
node extensions/nfr-verification/tools/check-nfr-targets.mjs path/to/targets.md
# Emit structured JSON findings
node extensions/nfr-verification/tools/check-nfr-targets.mjs path/to/targets.md --json
```

### Evidence Checker (`check-nfr-evidence.mjs`)

Validates an evidence table and cross-references target IDs against the targets file:

```bash
node extensions/nfr-verification/tools/check-nfr-evidence.mjs path/to/evidence.md --targets path/to/targets.md
# Allow agent-reported evidence for required targets when explicitly justified
node extensions/nfr-verification/tools/check-nfr-evidence.mjs path/to/evidence.md --targets path/to/targets.md --allow-agent-reported
```

## How to Enable and Disable

### Enabling the pack

Add `extensions/nfr-verification` to `extensions.enabledPacks` in `agent-workflow.config.json`:

```json
{
  "extensions": {
    "enabledPacks": ["extensions/nfr-verification"]
  }
}
```

Or enable via the framework CLI:

```bash
node bin/cli.mjs extensions enable extensions/nfr-verification
```

Validate pack registration:

```bash
node scripts/validate-extension-packs.mjs --run-validators
```

### Disabling the pack

Remove `extensions/nfr-verification` from `extensions.enabledPacks` in `agent-workflow.config.json` (or use `node bin/cli.mjs extensions disable extensions/nfr-verification`). Disabling the pack immediately restores default workflow behavior without leftover dependencies.

## Phase 1 Limitations

Keep these explicit boundaries in mind:

1. **Pack-first, not core-enforced:** This is an opt-in extension pack. It does not alter core schemas, digest calculations, method catalogs, or mandatory PR gates.
2. **Text evidence, not digest-bound:** Evidence is recorded in Markdown tables bound to candidate identifiers; it is not currently stored as a cryptographically signed core delivery record.
3. **No bundled measurement tools:** The pack defines target and evidence schemas and validation checkers; adopting projects provide their own domain-appropriate test runners, profilers, and scanners.
