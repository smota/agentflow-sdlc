# Retrospective: incremental onboarding experiment & autonomous process evolution (#259)

Status: ratified retrospective for issue #259. Reviews the execution of the incremental-onboarding experiment (epic #249, PR #258, run `onboarding-251`) and documents how its findings directly shaped the autonomous SDLC architecture delivered in epic #260 (PR #272, S0–S9).

---

## 1. Executive Summary & Problem Statement

The incremental onboarding experiment (#249, PR #258) was the first multi-agent workflow in this repository to exercise real headless Agy CLI execution paired with adversarial Codex review. While the feature delivered successfully (enabling incremental, transactional adoption without wiping custom user configuration), the execution encountered significant process friction:

1. **Accidental Lifecycle Closure**: PR #258 closed this retrospective (#259) upon merge even though the PR only referenced it (`Refs #259`), because the initial lifecycle automation treated every `#<id>` reference as an instruction to close.
2. **Impersonation vs. Delegation**: The experimental authorization granted prospective authority to accept and merge PR #258, but the schema lacked explicit typing to distinguish prospective delegated authority from actual human candidate review.
3. **Double-Escaped Newlines in Headless Artifacts**: Headless CLI generation repeatedly produced `\\n` escaping in structured file contents, requiring coordinator-side unescaping before patch application.
4. **Process Volume & Narrative Churn**: The workstream generated over 4,000 lines of GitHub markdown comments and repeated full-context dumps, exhausting model context windows and leading to tool execution denials.
5. **Historical State Desynchronization**: The formal `onboarding-251` phase-0 run stalled; experimental implementation progressed on GitHub while the durable run store remained frozen in an unadvanced phase.

---

## 2. Problem-to-Architecture Mapping

The following matrix documents each observed defect, its root cause, the architectural solution delivered in Epic #260 (ADRs 010–012, S0–S9), and the automated test verifying that the issue cannot recur.

| Observed defect                        | Root cause in PR #258                                                                     | Architectural solution in Epic #260                                                                                                                                                          | Regression test suite                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Accidental issue closure**           | PR-close automation matched any `#\d+` token without parsing `Closes` vs `Refs` semantics | **S0 (#261)**: Implemented strict regex parsing in `lib/core/run-state.mjs` and `scripts/integration-lifecycle.mjs` ensuring only `Closes #<id>` closes issues; `Refs` remains informational | `scripts/__tests__/integration-lifecycle.test.mjs`                                           |
| **Delegation ambiguity**               | Conflated user-delegated PR authority with human candidate attestation in PR manifest     | **S2 (#263)** / **ADR 011**: Defined typed `DelegationGrant` with `assuranceLevel: 'bounded' \| 'high-assurance'`, explicit `issuerMode: 'local-cooperative'`, and mandatory disclosure      | `lib/__tests__/delegation-grant.test.mjs`, `scripts/__tests__/delegation-journey.test.mjs`   |
| **Double-escaped newlines**            | Tool-call stringification in LLM JSON generation double-escaped `\n` to `\\n`             | **S6 (#268)**: Standardized output parser in `lib/providers/harness-dispatch.mjs` with byte-exact SHA-256 digest validation and truncation rejection                                         | `lib/__tests__/harness-execution-contract.test.mjs`                                          |
| **Process volume & context explosion** | Repeatedly posting full project configs and whole-file context into issue comments        | **S4a/S4b (#265/#266)** & **S5 (#267)**: Coalesced human projections, segmented immutable event store (`v2`), and portable continuation bundles bounded to $\le 32\text{ KiB}$               | `lib/__tests__/source-efficiency.test.mjs`, `lib/__tests__/portable-continuation.test.mjs`   |
| **Stalled run desynchronization**      | Formal run ledger required synchronous transitions while work proceeded experimentally    | **S3 (#264)** & **S5 (#267)**: Local bounded pending-audit journal (`lib/sources/pending-audit-journal.mjs`), writer generation fencing, and superseded run isolation                        | `lib/__tests__/pending-audit-journal.test.mjs`, `lib/__tests__/run-store-migration.test.mjs` |
| **Silent output truncation**           | CLI output truncation markers caused corrupted partial files to be written                | **S6 (#268)**: Reject outputs marked with `truncated: true` or `[truncated]` markers (`OUTPUT_TRUNCATED`) to prevent corrupt code application                                                | `lib/__tests__/harness-execution-contract.test.mjs`                                          |
| **Foreign integrity hashes**           | Meshloop integration attempt passed opaque 16-hex `DefaultHasher` hashes as SHA-256       | **S7 (#269)**: Independent SHA-256 byte hashing of all returned artifacts, treating foreign hashes as unverified correlation markers                                                         | `lib/__tests__/meshloop-provider.test.mjs`                                                   |

---

## 3. Detailed Root-Cause Analyses

### 3.1 Accidental Issue Closure & Lifecycle Correctness

In PR #258, the PR description included:

```markdown
## Implemented issues

Closes #250 ... Closes #257

## Related issues

Refs #259
```

The GitHub Action closeout script parsed all numbers matching `/#(\d+)/g` across the entire PR body. Consequently, #259 was automatically closed upon merge. The maintainer manually reopened #259 with the note: _"The PR-close automation closed this retrospective even though PR #258 only references it (Refs #259)... Reopened because retrospective work is intentionally deferred."_

**Resolution**: In S0 (#261), the lifecycle scanner was rewritten to parse sections and strictly respect keyword boundaries: only tokens preceded by `Closes`, `Fixes`, or `Resolves` trigger state transitions; tokens under `Related issues` or prefixed with `Refs` or `See` are recorded as reference links only.

### 3.2 Distinguishing Scoped Delegation from Human Review

In PR #258, the maintainer provided prospective authorization: _"The maintainer explicitly authorized end-to-end delivery and delegated acceptance/merge for this isolated development workstream."_
However, the PR body recorded:

```markdown
Review: self-review
Merge owner: human/operator
```

This conflated two different concepts:

1. Prospective authorization to proceed autonomously within bounded risk.
2. Verified human inspection of the specific candidate code diff.

**Resolution**: Under ADR 011 and S2/S3 (#263/#264), AgentFlow now explicitly distinguishes these concepts:

- **`DelegationGrant`**: Records who authorized the work (`issuerActor`), the origin (`origin`), the scope (`allowedPaths`, `allowedActions`), and the ceilings (`maxAttempts`, `maxExternalEffects`).
- **`assuranceLevel`**: Standard/bounded work operates under explicit automated self-review with disclosed delegation. High-assurance work strictly requires human security and acceptance review on the open PR before merge. A delegated agent can never forge or claim `human-reviewed` status.

### 3.3 Artifact Integrity & Normalization

During PR #258 development, Agy returned source files embedded within JSON responses. In several slices, literal `\n` characters were escaped as `\\n`, resulting in files where newlines appeared as literal backslash-n characters in source code. The coordinator had to perform unescaping fixes before running the test suite.

**Resolution**: In S6 (#268), `lib/providers/harness-dispatch.mjs` formalized the artifact retrieval contract:

- All returned files must provide exact string contents.
- Each artifact's SHA-256 digest is independently calculated from its raw UTF-8 bytes and matched against declared digests.
- Truncated strings or malformed encodings trigger `OUTPUT_TRUNCATED` or `MALFORMED_OUTPUT` errors immediately, preventing corrupted code from entering the repository.

### 3.4 Context Optimization and Projection Coalescing

During the onboarding experiment, progress updates repeatedly dumped entire configuration structures and skill catalogs into issue comments. This caused:

- High GitHub API rate-limiting risk.
- Massive context consumption during agent resumption.
- Inability for a fresh agent session to reconstruct state without loading thousands of lines of conversational history.

**Resolution**: S4a, S4b, and S5 introduced:

- **Coalesced Projections** (`lib/application/publication-service.mjs`): Unchanged state projections produce no new GitHub comments or writes.
- **Segmented Storage** (`lib/sources/segmented-run-store.mjs`): Events are chunked into immutable content-addressed segments with periodic snapshots, avoiding full linear replays.
- **Portable Continuation Bundles** (`lib/application/continuation-service.mjs`): Fresh agents resume using lightweight packets strictly bounded to $\le 32\text{ KiB}$, referencing bulk data via SHA-256 artifact digests.

---

## 4. Policy Reaffirmation & Governance Invariants

This retrospective formally ratifies the following governance invariants:

1. **No Human Impersonation**: An automated or delegated execution receipt may never claim `human-reviewed` or `human-review-requested` attestation without a cryptographically bound or verifiable human signature.
2. **Generic Policy Preservation**: Experimental authorizations (such as those granted for #249 or #260) are strictly issue-scoped. They do not alter, weaken, or rewrite the baseline repository policy defined in `AGENTS.md`.
3. **No Narrative Acceptance**: No gate may be advanced or closed based solely on natural language claims in comments or PR narratives. Acceptance requires reproducible CI test execution and verified SHA-256 artifact digests.
4. **Historical Run Integrity**: Runs that stall or are superseded by subsequent workstreams are permanently preserved as historical evidence with `superseded: true`. They must never be rewritten, deleted, or synthetically marked completed.

---

## 5. Conclusion & Issue Closure

With the delivery of Epic #260 (PR #272) and the formal ratification of this document, all requirements of Issue #259 are satisfied:

- Every observed problem in #258 has been mapped to a reproducible case and an architectural fix.
- The boundary between prospective delegation and human review is permanently codified in ADR 011 and `lib/core/delegation-grant.mjs`.
- The fixes have been tested and verified across all supported platforms (Linux, macOS, Windows on Node 20 and 24).
