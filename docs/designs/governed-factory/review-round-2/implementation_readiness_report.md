# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (`lines 685-1016`, the "Detailed Implementation Plan" section to the end of the file)

## Reviewer Status

| Reviewer                       | Status    |
| ------------------------------ | --------- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details`         | completed |
| `egm-style`                    | completed |

Notes on independence: no reviewer was told to read, and none opened, anything under `docs/designs/governed-factory/review-round-1/`. The codebase-details reviewer reports that one file-count listing printed a filename from that folder and that it did not open the file. No retries were needed.

## Summary

| Severity  | Count  | IDs     |
| --------- | ------ | ------- |
| Blocker   | 4      | R1-R4   |
| Major     | 27     | R5-R31  |
| Nit       | 13     | R32-R44 |
| **Total** | **44** |         |

**Verdict:** the plan is not ready to build as written. Week 0 and most of M0 are close. M1 onward has ordering inversions, unspecified interfaces and parameters, and open decisions. The plan defers part of this to a per-milestone "re-verify" step (lines 23, 687). The implementation-readiness standard requires the zero-decision rule and an exact write allowlist in the plan the implementer receives, so the deferral does not satisfy it. Several claims about the current code are also wrong, mostly in M0-9 (the OpenRig trim) and M0-11.

Items that reviewers checked and found correct, so they need no action: ADR numbers 017-026 are free and `docs/adr/index.md` exists; `AGENTS.md:69`, `docs/guiding-principles.md` lines 43 and 59, and `docs/steering-merge-authority.md:18` match what W0-20 quotes; the `steer.mjs`, `registry.mjs`, `execution-receipt.mjs`, `seat-lease.mjs`, `github-credential.mjs`, `source-claim.mjs`, `github-merge.mjs`, `steering-merge-policy.mjs`, `gate-sweeper.mjs`, `process-supervisor.mjs`, `events.mjs` and `run-state.mjs` citations hold; the `gates open` flags and `goals/g3/goal.json` exist; files marked Create do not yet exist; deleting `lib/audit/role-flow-span.mjs`, `lease-fencing.mjs` and `handover-protocol.mjs` leaves no other code dependents.

## Prioritized Findings (Blockers -> Major -> Nits)

### R1 Control-repository and trust-policy work is used before it is built - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 786, 866, 873, 881, 891, 944, 986 (W0-15, M1-8, M1-10, M1-13, M2-1, M3-3, X-1)
- **Discrepancy Description**: M1-8 (pause flag and check-ins), M1-10 (the poller reads the pause flag) and the W0-15 gate re-run at the M1 exit ("persisted pause flag read from the control repository") all need to read the control repository. The reader, `lib/verification/control-repo-reader.mjs`, is created in M2-1. M1-13 builds "verify against trust policy" and the signed-act check in `satisfyGate`, but the policy loader and principal mapping (`lib/signing/trust-policy.mjs`) arrive in M3-3. The control repository itself (X-1) is listed last, yet W0-5, W0-12 and W0-15 need it in week 0. The M1 exit cannot pass in the listed order.
- **Rationale & Recommendation**: Move the reader and the trust-policy loader into M1, or define a stub with its exact contract. Move X-1 to week 0 with its file list. Add an explicit dependency column to every table.

### R2 The launcher has no interface or entry point, and M1-4 removes the only sanctioned run path - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness` (with `egm-style` on the contradictory run-path wording)
- **Affected Scope:** lines 785, 786, 855, 858, 868, 872
- **Discrepancy Description**: M1-4 creates `lib/substrate/launcher.mjs` and deletes `scripts/guarded-run.mjs`. No item adds a CLI verb or caller for the launcher. M1-8 adds `tick` to `scripts/coordinator.mjs` without saying it calls `intake-poll.mjs` or the launcher. M1-10's poller "hands references to the launcher" with no function signature. The launcher's inputs, outputs and error cases are undefined: receipt fields, budget and timeout parameters, the push step, and the record of a "passing conformance run" (line 855). The deletion breaks the audit-reachability convention (line 700) and the rule that each phase leaves a runnable state. Separately, line 785 says `guarded-run.mjs` is "the only path by which agents run until the launcher exists" while line 786 says "no agent run starts outside `guarded-run.mjs` until the gate passes". The second can be read as allowing other paths once the gate passes.
- **Rationale & Recommendation**: Give the launcher's function signature and result shape, and name the CLI verb and script that call it. Keep `guarded-run.mjs` until that verb passes the week-0 gate again. Order M1-7 (App token minting), M1-5 and M1-12 before M1-4, because the launcher depends on all three. Use one rule for the run path, for example "Until M1-4, no agent run starts outside `guarded-run.mjs`, and none starts until the gate passes".

### R3 M2-2 depends on an open question, and the verifier bootstrap is missing - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 74, 896-899 (M2-2, `verify-pr.yml`, `pin-verifier.mjs`)
- **Discrepancy Description**: The workflow is "`pull_request_target` or an organization-level required workflow; see Open Questions", and Open Questions leaves the choice open. The design also omits: how a `pull_request_target` job runs the base-branch verifier against PR contents without executing PR code; a `merge_group` trigger (M2b-2's merge queue needs the required check on queued commits); the artifact format of the release that `pin-verifier.mjs` builds; the digest algorithm and how the workflow fetches and checks the pinned artifact; and the first-pin bootstrap ("release N-1 judges release N" has no N-1 at first).
- **Rationale & Recommendation**: Decide the trigger, artifact form, fetch-and-verify step and first-pin procedure before M2 starts, and write them into the row.

### R4 M0-11 would break the shipped distribution profile - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details` (with `egm-implementation-readiness` on the open model choices)
- **Affected Scope:** lines 838-840 (M0-11)
- **Discrepancy Description**: The plan says to fix a "stale Gemini row in `ROUTES` (line 15)" so Gemini routes through `agy` and not "the removed `pi`". `lib/config/execution-distribution.mjs:15` does map `gemini` to `pi`, but `validateOptions` (lines 35-37) requires every profile option to equal its `ROUTES` tuple. `manifests/execution-distributions/subscription-balanced-v1.json` uses `runtime: pi`, `executionTarget: pi-session`, `client: pi` for its Gemini options (lines 49-58). Editing `ROUTES` makes `resolveDistribution` throw for the shipped profile, which breaks `pnpm validate:distribution` (`scripts/generate-execution-distribution.mjs`) and every project pinned to it (`agent-workflow.config.json:439-440`). Editing the profile instead changes its digest, which is pinned at `agent-workflow.config.json:440`, `:450` and `defaults/agent-workflow.config.json:88`, and M0-11 itself says consumer defaults keep `subscription-balanced-v1`. "The removed `pi`" is inaccurate: only the `pi-cli` provider was removed (`lib/providers/registry.mjs:62-65`). `ROUTES` keys are subscription names with no `agy` key, and the model-prefix map at line 38 has no Agy entry. The plan also leaves profile contents (17 roles, three options each, "initial choices come from the station's current settings"), the project-supplied profile config key, and the `ROUTES` values for Claude, Agy, Codex, Grok and Pi to the implementer.
- **Rationale & Recommendation**: Specify how a project-supplied profile gets its route tuples while the shipped profile stays valid and its digest unchanged. Supply the profile JSON or a table of role, default and two fallbacks, and name the config key.

### R5 File boundaries are not exact, so a write allowlist cannot be enforced - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 790, 794, 825-829, 834, 849, 925-926
- **Discrepancy Description**: Several rows defer exact paths to the re-verification step: M0-9 tests ("exact files confirmed when the milestone list is re-verified", test families such as "handoff-_" and "oracle-writer-_"), M0-10 ADRs (`docs/adr/007-*.md`, `011-*.md`), W0-20 skill mirrors ("where they exist", `adapter-*.md` "under `references/`"), M1-2 (whether a `manifest.json` is needed) and W0-19 (goal fields). Directory globs are used for existing files: `adapters/openrig/agentflow/**`, `agentflow-product/**`, `agentflow-eval/**`, `lib/bridge/**`, `adapters/openrig/__tests__/**`. The standard allows globs only for generated output.
- **Rationale & Recommendation**: Enumerate every file now, or make each milestone's re-verification an item that produces the exact list and must merge before the implementation items.

### R6 M0-9 (OpenRig trim) misstates the code and misses dependents - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (with `egm-implementation-readiness` and `egm-style`)
- **Affected Scope:** lines 781, 825-832, 1007
- **Discrepancy Description**:
  - Dead import: the plan removes only `deliver`, `list` and `flush` from `HOLD_COMMANDS` and cites line 1053. The constant is at `bin/cli.mjs:1050` (line 1053 is the import). The set is `deliver, list, flush, release, busy, step, capacity`, and `handleHoldHandoff` dynamically imports `adapters/openrig/agentflow-product/handoff.mjs`, which M0-9 deletes. `release`, `busy`, `step` and `capacity` would route to a deleted module. The "handoff" usage text (about line 1424) also needs editing.
  - Wrong manifests: none of the deleted OpenRig files appear in `manifests/npm-package.json`, `product-payload.json`, `composition-profiles.json` or `seats.json`. Only `adapters/openrig/agentflow-world/manifest.yaml` does, and it is kept. The lists that name deleted files are in `agent-workflow.config.json`: `delivery.candidate.inputs` (lines 145-226, about 80 deleted files) and the verification commands `openrig-execution-contract` (327-350) and `openrig-preflight` (351-367).
  - Unlisted dependents: `lib/__tests__/quota-policy.test.mjs:26` and `fallback-health.test.mjs:5` import `platform-fallback.mjs`; `seat-table.test.mjs:5` imports `DORMANT_SEATS` from `continuity-policy.mjs`; `three-mode-equivalence.test.mjs:35` imports `lifecycle.mjs`; `openrig-versioned-specs-and-topology.test.mjs:18,22` import `lifecycle.mjs` and `continuity-policy.mjs`; `native-oracle-assignment.test.mjs` and `oracle-case-scope.test.mjs` import `oracle-admission.mjs`; `scripts/__tests__/handoff-hold.test.mjs` imports `handoff.mjs` and `handoff-guard.mjs`; `dogfood-surface.test.mjs:27,74` names `adapters/openrig/lifecycle.mjs`. `quota-policy.test.mjs` and `seat-table.test.mjs` cover live behavior, so they need modifying, not deleting. The plan's globs do not match these files. Other adapter tests are unassessed: `connector-boundary`, `eval-seat`, `seat-authority`, `human-channel`, `workflow-spec`, `no-openrig-package`, `openrig-floor`, `execution-route-roundtrip`.
  - Links that will break `validate:docs` (`scripts/validate-docs.mjs:190`): `docs/operators/index.md:7` links `openrig-mutations.md`, `docs/process-autonomy/delegation.md:132` links `../native-source-handoff.md`, and `adapters/openrig/README.md:4,7` links both deleted docs. `adapters/openrig/manifest.json` lists `rigs` and `commands`, not only `lifecycle.module`, and the `adapters squads ...` usage text in `lib/adapters/lifecycle.mjs` needs editing. `docs/operators/openrig-execution-contracts.md` and `docs/openrig-runtime-compatibility.md` (`agent-workflow.config.json:198,207`) are not covered by the "cut to about 310 lines" item.
  - `lib/bridge` scope: `slice-worktrees` is `lib/runtime/slice-worktrees.mjs`, not under `lib/bridge/**`. The keep and delete lists mix subcommands (`intake`, `start`, `escalate`, `cleanup`, `status`) with file names, `scripts/bridge.mjs:29` has `reconcile` and not "replay", and `memory-queue.mjs` is not mentioned. Orphaned and unlisted: `lib/runtime/slice-worktrees.mjs` (only non-test caller is `lib/bridge/worktrees-port.mjs`, plus `scripts/bridge.mjs:14`), `lib/runtime/scrub-git-output.mjs` (only caller `worktrees-port.mjs:30`), `lib/runtime/path-identity.mjs`, `lib/__tests__/slice-worktrees.test.mjs` and `bridge-worktrees.test.mjs`.
  - Workflow yaml: line 825 keeps `manifest.json` "with no lifecycle module" while line 826 keeps the rig and workflow yaml. `lib/bridge/config.mjs:17` and `lib/__tests__/bridge-intake.test.mjs:43` default to the workflow yaml, yet line 832 retracts "#583 (the generated workflow)" and line 829 removes the workflow validator. The plan must say whether `agentflow-delivery.workflow.yaml` stays.
  - Approximations: targets such as "about 900", "about 3,100", "about 1,800 or fewer", "about 310", "about 1,150 source and 600 test lines" are not acceptance criteria, and the cut and keep files are described only by category. No breaking-change note (`docs/maintainers/breaking-changes.md`) or CHANGELOG entry is listed for removed verbs, config keys and shipped files. Line 825 also gives "Commit `9227d22`, 2026-10-15 and 16", which reads as one commit on two dates.
- **Rationale & Recommendation**: Replace "exact files confirmed at re-verification" with an enumerated delete list, modify list and kept list. Make W0-13's output a numbered keep list and have M0-9 execute it exactly. Remove the whole `HOLD_COMMANDS` and `handleHoldHandoff` path. List `agent-workflow.config.json` precisely and drop the three manifests, or state that nothing changes there. Add the orphans and the breaking-change note.

### R7 Several items are too large for "one focused PR" - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** lines 687, 763-790 (W0-12, W0-14, W0-15), 792-797 (W0-20), 825-832 (M0-9), 851 (M1-2), 918-930 (M2b-2)
- **Discrepancy Description**: Line 687 says each item is one focused PR. W0-20 spans about 26 files. M0-9 deletes about 18k lines plus CLI, manifest and doc edits. M2b-2 mixes merge-queue enqueue, the steward path in `steer.mjs`, the OpenRig steer bundle deletion, skill rewrites, policy code in `posture.mjs` and `gate.mjs`, the per-merge decision and tag pushing. M2b-2 also specifies `skills/agentflow-steerer/SKILL.md` and `adapters/claude-code/skills/agentflow-steerer/SKILL.md` in two rows (925, 926). M1-2 contains an M2-7 action (`adapters/wsl2/wsl2.mjs`).
- **Rationale & Recommendation**: Split these into separately mergeable items with their own declared scope, or change the convention to "one or more PRs per item, each with a declared scope". Move the M2-7 clause to the M2-7 row.

### R8 Ordering and dependency inversions - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** lines 687, 777, 779, 786, 791, 803-806, 810-811, 818, 884, 921, 930-931, 971-980, 987-989
- **Discrepancy Description**: Line 687 says items are listed in build order. Beyond R1 and R2:
  - W0-12 adds the `box gate` verb to `bin/cli.mjs`, but its target `scripts/week0-gate.mjs` is created in W0-15 (neither row names the script `box` dispatches to).
  - M1-14's demo covers "evidence bundle to trace-matrix row", but the bundle is M3-1 and the trace matrix M4-1. M5-6's recording shows "a rejected tampered bundle" (M3-4), and no row extends `demo-skeleton` later.
  - W0-12 signs the first delegation in week 0, but the delegation format and issuer are built in M2b-1.
  - M0-1 extends the audit to `lib/runtime/` and `lib/audit/`, and M0-2 then deletes `lease-fencing`, `handover-protocol` and `role-flow-span`, which are not in M0-1's exemption list. The test at line 161 "fails until every export is wired, exempted or retired".
  - M0-6 (line 818) checks the tag creator "against the trust policy", which does not exist at M0.
  - M2b-2 (lines 921, 930) needs the time-lock built in M2b-3 (line 931).
  - M0-3 puts `validate:claims` before `validate:reachability` in the release chain (line 810) and the workflow step after it (line 811).
  - M5 rows run M5-1, 2, 3, 6, 4 with no M5-5.
  - X-2 and X-3 have no milestone. X-2 needs the factory running, X-3 must follow the npm release in M5-4, and its read-only claim fix is needed with M0-4.
  - The sweeper behavior at line 791 ("resolves a hung gate to a recorded `timed_out`") is described for week-0 to M1 admissions, but the sweeper has no product caller until M1-9 (line 872) and the poller until M1-10.
- **Rationale & Recommendation**: Add an explicit dependency column, re-sequence, renumber M5, give the X items a milestone and a predecessor, and say "from M1-9; before that, the author checks open gates by hand with `gates waiting`". Or replace the sentence at line 687 with "listed by milestone; dependencies are named in each row".

### R9 Test strategy is thin and some verification outcomes have no owning item - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** lines 687, 991-1014 and the rows M0-5, M0-6, M1-5, M1-8, M1-9, M2-2, M3-6, M4-3
- **Discrepancy Description**: Line 687 says each item lists its tests. Many do not (M0-5 has only a registry test, no cases; M0-6 `publish.yml`; M1-5 `provider-receipt.mjs` and `sparring.mjs`; M1-8 `run-delivery`, `run-service`, `actuate-readiness`, `seat-lease`; M1-9 `person-gates.mjs`; M2-2 `validate-path-ownership` and workflows; M3-6; M4-3 telemetry scripts). Where a test file is named, the cases almost never are. The Verification Plan is milestone-level. These outcomes have no item that builds them: the pause-mid-run-and-resume conformance case (line 1005), the builder-cannot-read-holdout negative test (line 999), the seeded vacuous test and seeded defect fixtures, the merge-path drill, the seeded failure run for the circuit breaker (line 1000), and the `week0-gate.mjs` additions for the M1 exit (persisted pause flag) and the M2 exit (daily budget window). W0-15 says the gate is re-run there, but no later item modifies it. M2-2 also names a new `validate-pr-manifest.test.mjs` and ignores the existing `scripts/__tests__/validate-pr-manifest-desktop.test.mjs`, and `scripts/validate-pr-manifest.mjs` has no exports and runs at import.
- **Rationale & Recommendation**: Add a test-case list to every item and an owning item for each fixture, drill and gate extension. Say "tests are listed where the item adds or changes behavior" if that is the intent. Line 687's claim that paths "were checked against the repository on 2026-11-24" also conflicts with line 23 (M1+ not re-verified); reconcile them.

### R10 Unspecified parameters, defaults and storage locations - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 743-755, 784, 838-840, 855, 872-875, 904, 933 (W0-14, M0-11, M1-4, M1-9, M1-10, M2-6, M2b-4)
- **Discrepancy Description**: No values or locations are given for: the circuit-breaker N and window (M2b-4); the run-cap size and window (W0-14); the run timeout and run budget, and the transcript size cap (M1-4); the tick interval (M1-10); the egress allowlist contents (M2-6, "model vendor hosts and any package registries"); where the per-repository autonomy level (L1/L2/L3) lives (the control-repository layout at lines 743-755 has no field); where the "recorded passing conformance run" is stored, in what format, who writes it, and how a provider id and version are matched (M1-4); the config keys for the sweeper and person-gate deadlines (M1-9); the config key for a project-supplied distribution profile (M0-11). The config schema (`schemas/agentflow-config.schema.json`) is not listed in M0-11 or M1-9.
- **Rationale & Recommendation**: Add a "parameters and defaults" table with owner file and config-authority classification for each value, and add the schema rows.

### R11 Local state files have no ownership, ignore or tamper rules - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 757, 784, 785, 871, 885
- **Discrepancy Description**: The plan creates `.agentflow/coordinator.json`, `run-cap.json`, `gates/*.json`, `supervisor/` and `alerts.json`. `.gitignore` does not ignore `.agentflow/` as a whole, and PM seats may write `.agentflow/**` (`AGENTS.md:82`). The kill, pause and cap state could therefore be committed or agent-writable, which undermines the week-0 gate. Neither `.gitignore` nor `manifests/path-ownership.json` appears in any file list for these.
- **Rationale & Recommendation**: Add `.gitignore` and path-ownership rows, or move the state outside the repository tree.

### R12 Digest and canonical-JSON changes invalidate existing sealed records - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** lines 859, 861, 883, 941, 948 (M1-5, M1-13, M3-5)
- **Discrepancy Description**: M1-5 makes `providerDigest` delegate to `recordDigest` and drops the private `canonicalJson` from sparring. The sparring file is `lib/core/sparring.mjs:2`, not `lib/sparring.mjs` (which does not exist), and being in `lib/core` it may import `./record-digest.mjs`. The two are not equivalent. `recordDigest` (`lib/core/record-digest.mjs:15-18`) hashes `stableJson` of the record minus a top-level `digest` key, and `stableJson` is not exported, so the change needs an export that is not listed. `providerDigest` (`lib/providers/provider-receipt.mjs:4-6`) hashes `JSON.stringify(value)` and is called with arrays and `null` (lines 64-66). `recordDigest(null)` and `recordDigest([])` both hash `{}`, and arrays become index-keyed objects. Plan tokens in `codex-engineering.mjs:257-263`, `manual.mjs:16-20` and `provider-api.mjs:63-68`, and stored `receipt.digests.output` values checked at `governed-engineering.mjs:50`, would change. M3-5 changes `computeOracleDigest` and `computeReviewDigest` to hash line-ending-normalized content, and M1-13 bumps the attestation schema version. Records sealed under the old functions would stop verifying. The Migrations paragraph (line 659) states the principle but no item implements it.
- **Rationale & Recommendation**: For each item, state the digest-version field, the dual-read behavior, the affected tests and a test that old fixtures still verify. State whether a plain revert is safe.

### R13 Behavior of key new modules is described by intent, not specified - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 715-734, 807-808, 846-853, 873-875, 892-893, 900, 962
- **Discrepancy Description**:
  - M0-3 ledger rules: how "negation" is detected for "compliant" and "validated"; how "by default" is matched; which "listed files" the keyword scan covers and where that list lives; which status each of about 40 rows gets (ADR 024 gives only part of the wire/retract table); the row typing in Key shapes leaves `quote`, `verifiedAt` and `conformance` undefined.
  - M1-10: how the claim ID is derived (hash, field order, encoding); what replaces the GitHub comment read-then-append, since the comment API has no conditional append; how an issue maps to its goal and gate (goals are filesystem `goals/gf-*/goal.json`, issues are on GitHub); how the per-lane in-flight count is computed.
  - M2-1: the `holdouts/` layout in the control repository; how a holdout runs against a candidate; how a "new test" is identified for the no-op check; how the base tree is built and tested in hosted CI; the fields of the "holdout kind" in custody receipts.
  - M2-3: how the reviewer family is chosen; the reviewer's prompt, inputs and output format; the attestation format and storage place (a PR review is explicitly not a signature, line 213); who signs; how the required check reads the attestation.
  - M1-1 and M1-3: `FACET_OPERATIONS` gets "its operation" (singular) although the contract has six; the factory interface of the shared conformance suite; the schema of `tests/redteam/starter-canon.json`; what "a candidate editing its own verifier" means inside a substrate suite; the pseudocode in Key shapes lacks error semantics and types.
  - M4-3: the "length caps" and "allowlists" are not given.
- **Rationale & Recommendation**: Add schemas, algorithm descriptions and example fixtures for each.

### R14 W0-20 policy edits give locations but not wording, and carry review history - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** lines 792-797
- **Discrepancy Description**: The row lists line numbers across about 26 files and says "qualify with 'by default'" and "add the opt-in", but gives neither the replacement sentences nor the text of the new "Opt-in delegation" section. W0-20 edits the governing policy by hand, and the M0-3 wording rule must later match this text. Line 792 also narrates a review round ("These were the lines the reviewers found wrong in the first W0-2 row: the rule is at `AGENTS.md:69`, not 62-64"), and "first W0-2 row" no longer exists.
- **Rationale & Recommendation**: Provide one canonical replacement sentence per statement type and the full new section before W0-20 starts. Drop the review history and keep it in the review record.

### R15 Admission gates are described inconsistently with `docs/person-gates.md` - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 790, 791
- **Discrepancy Description**: `docs/person-gates.md:28-32` says an admission gate is per change class ("each class is its own gate"), and `:72` says `gates open --change-class <class>` opens an admission. W0-19's command uses `--class adequacy-of-intent --role analyst` and names no change class. It is unclear which classes each milestone admits, or whether "nine gates" is nine or nine times the classes in play. Editing a milestone goal body makes the gate stale (`:25-26`), and the goal body carries the exit criteria, so any later edit re-opens the admission.
- **Rationale & Recommendation**: State the class set per milestone and the exact open command, and say how a milestone goal's body is frozen.

### R16 Kill, pause and revert mechanics have gaps - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 261, 783, 785, 786, 932, 933, 986
- **Discrepancy Description**: The M2b-4 circuit breaker "trips pause and kill", but the pause flag lives in the control repository, writable only by the author, with no access for the builder and reviewer Apps. The plan does not say which credential lets the breaker set it, or whether it changes only local state. W0-14 says `kill` stops the running guarded run and its process tree but not how `coordinator kill` reaches a running process (pid file, polling, signal), and the 10-second budget in W0-15 depends on it. The Windows tree kill (`taskkill`) is not named. `post-merge.yml` "opens a revert PR through the steward" (line 932), but the steward token is host-held (line 227), not a CI secret. The plan does not say who runs the step, which delegation action covers a revert, whether it needs review, or whether a `factory-core` revert waits for the time-lock.
- **Rationale & Recommendation**: Specify the credential and path for each action, the kill propagation mechanism per platform, and the revert authority.

### R17 Evidence transport between host and hosted CI is unspecified - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 940-946 (M3-1 to M3-3)
- **Discrepancy Description**: M3-1 builds the bundle "from run-state events and receipts", and M3-2 attests it in hosted CI after post-merge success. The run store and transcripts are on the host. The plan does not say how events, receipts and transcript digests reach CI, or where the bundle is stored. The offline verifier calls `gh attestation verify` (M3-3), but the plan does not state that a `gh` CLI, and which version, must be on the clean machine. Line 941 leaves "an envelope event or `checkpoint` payload" as an open choice.
- **Rationale & Recommendation**: Add the transport and storage step to M3-1 and M3-2, state the `gh` requirement, and choose the event form.

### R18 M2b-2 contains unresolved decisions, conflicting merge mechanics and duplicated edits - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** lines 793-794, 922, 925-927, 929
- **Discrepancy Description**: Row 927 says "Check how `requiredHumanGateClasses` and `satisfyGate` treat a candidate gate for high-assurance work, and limit the change to merge and release", which is an investigation and not an instruction. Row 922 (merge-queue enqueue) and row 929 (`gh pr merge --match-head-commit`) describe two merge mechanisms, with no choice between GraphQL `enqueuePullRequest` and `gh pr merge`, and no statement of how the head-commit match is kept under a queue. The "steward path parallel to the human endpoint" has no function or CLI signature. Rows 925-927 repeat edits already assigned to W0-20 (the steerer skill, `docs/steering-merge-authority.md`, `docs/person-gates.md`, "strictly human-gated"), and line 793 says only "the code change is in M2b-2".
- **Rationale & Recommendation**: Choose the merge API, state the interfaces, make the row-927 investigation a prior item whose output is the exact change, and drop the duplicated doc edits or say what is new beyond W0-20.

### R19 M1-7 removes a default credential fallback without migration - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** line 865
- **Discrepancy Description**: Removing the default `gh auth token` fallback breaks existing local use. The opt-in is "explicit", but its flag or config name is not given, and no schema or doc row is listed.
- **Rationale & Recommendation**: Name the opt-in and add its documentation and schema rows.

### R20 M0-1 and M0-2 leave reachability findings unexempted, and the "planned" mechanism does not exist - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** lines 803-806 (M0-1, M0-2)
- **Discrepancy Description**: `OFF_PATH_EXEMPTIONS` is a `Map` keyed `module#export` with a free-text reason (`scripts/audit-reachability.mjs:74-207`). There is no "planned" kind, and nothing makes a "planned" exemption expire when wired. Adding `lib/audit/`, `lib/gates/`, `lib/qa/` and `lib/runtime/` to `CORE_API_PREFIXES` (line 575, currently `['lib/core/','lib/verification/']`) flags every function or class export without a non-test caller. The plan names four exemptions (sweeper, supervisor, QA contract verifier, refinement engine). The real set is larger: `lib/gates/gate-sweeper.mjs` (`createGateTracker`, `formatRevisionContext`, `handleWebhookEvent`, `sweepGate`, `BoundedGateSweeper`), `lib/qa/process-supervisor.mjs` (`isPortInUse`, `killProcessTree`, `ProcessSupervisor`), `lib/qa/qa-contract-verifier.mjs` (`computeArtifactDigest`, `verifyQAEvidenceContract`), `lib/runtime/context-sanitizer.mjs` (`cleanupGitLocks` and `compressContextPayload` lose their callers once M0-2 deletes the handover protocol, yet M0-2 says only that the file "stays"), and the orphans listed in R6. `lib/refinement-engine.mjs` is not under any new prefix, so it needs a different justification. `lib/audit/` has one file, which M0-2 deletes, so the new prefix covers an empty directory.
- **Rationale & Recommendation**: Enumerate the exemption keys, and state the "planned" mechanism and its expiry check.

### R21 The Conventions section misstates what `validate:npm` enforces - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** lines 698, 819, 851
- **Discrepancy Description**: Line 698 says a new shipped file must be added to `manifests/npm-package.json` and "`validate:npm` enforces this". The manifest has `requiredFiles` and `forbiddenPathPrefixes`, and `scripts/validate-npm-package.mjs:42-58` only checks that required files are in the pack and that no packed path starts with a forbidden prefix. `package.json` `files` already ships whole directories (`adapters/`, `lib/`, `docs/`), so M1-2's "Ship both folders" is already satisfied.
- **Rationale & Recommendation**: Correct the convention and the M1-2 text.

### R22 M0-6 cites wrong lines and an unworkable mechanism - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** line 819
- **Discrepancy Description**: `package.json` `files` is at lines 62-85, not 53-77. `__tests__` is not a `files` entry. It ships because `lib/`, `scripts/` and `adapters/` ship whole. `forbiddenPathPrefixes` (`manifests/npm-package.json:153`) uses `startsWith` (`scripts/validate-npm-package.mjs:52`), so it cannot forbid nested `adapters/*/__tests__/` without listing each one. The plan does not say whether to use `files` negation globs or a validator change. Excluding `lib/__tests__/` also removes the conformance suites (`lib/__tests__/source-contract-suite.mjs` today, `substrate-contract-suite.mjs` from M1-3), which third-party adapter authors would then not receive.
- **Rationale & Recommendation**: Choose the mechanism, fix the line numbers, and decide where shipped conformance suites live. Name the "provenance and tag" checks instead of "check provenance and tag".

### R23 M1-1 omits two schema enums and the docs that list facets - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** line 847
- **Discrepancy Description**: Adding `containment` to `PROVIDER_FACETS` (`lib/core/provider-binding.mjs:9`) also requires the facet enums in `schemas/provider-binding.schema.json:26` and `schemas/execution-intent.schema.json:53`, both hard-coded to the same six values. Neither schema is in the plan. The facet list is also documented in `docs/providers/provider-matrix.md:3` and `docs/adr/005-versioned-provider-and-source-ports.md:25`.
- **Rationale & Recommendation**: Add both schemas and the two docs to the row.

### R24 M2-3 contradicts the code on `modelFamily()` - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** line 901
- **Discrepancy Description**: The row says to "make `modelFamily()` (lines 11-24) recognise Agy and Gemini names". `lib/core/model-family.mjs:17` already maps `gemini` and `gemma` to `google`. Agy is a client, not a model family.
- **Rationale & Recommendation**: If the intent is to recognize models served through Agy, name the model-name patterns. Otherwise remove the clause.

### R25 M1-12 breaks existing issue validation and templates - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** lines 878-880
- **Discrepancy Description**: Requiring `## Declared scope` in `validateIssueAgainstSdlc` (`lib/sdlc-state.mjs:376`) fails every existing issue and fixture that has `## Acceptance criteria`, and adopters use `sdlc validate-issue` too. The templates carrying `## Acceptance criteria` are not listed: `.github/ISSUE_TEMPLATE/chore.md`, `lib/github-setup.mjs:44,73,95` (generated templates), `docs/agent-workflow.md`, `docs/sources/product-discipline.md`, and fixtures and tests (`lib/__tests__/sdlc-state.test.mjs` and others). The plan does not say whether the new rule is posture-gated or applies to all projects.
- **Rationale & Recommendation**: State the scope of the rule, list every template, doc and fixture to change, and keep the existing CLI behavior of `scripts/validate-pr-manifest.mjs` that its desktop test relies on.

### R26 M2-5 is incomplete and leaves design choices open - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** lines 903, 904
- **Discrepancy Description**: The `weekly` and `five-hour` window enum also lives in `schemas/agentflow-config.schema.json:456` and `:473`, in `scripts/generate-execution-distribution.mjs`, and in `lib/__tests__/quota-policy.test.mjs`. M2-5 lists only `quota-policy.mjs`, `delivery-policy.mjs` and its test. `budgetAdmission({budget, used, estimatedNext, providerCanStop})` (`lib/core/delivery-policy.mjs:171`) is a pure function with no window, so "a counter in `budgetAdmission`" leaves the counter's state and storage to the implementer. `ALLOWED_QUOTA_WINDOWS` is at `lib/config/quota-policy.mjs:11`, not 9. The sentence "Today it has only `weekly` and `five-hour` and no window" is unclear (probably "no daily window").
- **Rationale & Recommendation**: Add the schema, generator and test files, and specify where the counter state lives and how it is passed into `budgetAdmission`.

### R27 M0-10 cites mentions that do not exist, and M0-4 contradicts the fencing wording rule - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-style`
- **Affected Scope:** lines 813, 836, 1008
- **Discrepancy Description**: M0-10 says "Check the six 'fencing' mentions in `scripts/validate-docs.mjs`". A case-insensitive search finds none. Source files such as `lib/core/role-collaboration.mjs` (15), `lib/core/sparring.mjs` (6), `lib/sparring-gate.mjs` (9) and `lib/config/quota-policy.mjs` (1) do contain "fencing", and the plan does not say whether the wording rule covers code. Separately, M0-4 (line 813) says "keep writer-generation fencing", while M0-10 and the verification bullet (line 1008) ban "fencing" outside the glossary, errata, ADRs, releases and the schema field.
- **Rationale & Recommendation**: Remove `scripts/validate-docs.mjs` from the row, state whether code is in scope, and use "writer generation" at line 813.

### R28 The week-0 gate tests an allowlist that does not exist yet - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 786, 904
- **Discrepancy Description**: The gate checks that the agent "cannot reach an off-allowlist host". The allowlist and its generator are created in M2-6, and W0-14's runner mentions none. W0-15 also does not list the probe commands run inside the sandbox.
- **Rationale & Recommendation**: State which allowlist the gate uses in week 0 (an `sbx` default or an interim file), or scope the gate to "no GitHub credential" until M2-6. List the probes.

### R29 Several acceptance and exit criteria are unmeasurable - Severity: Major

- **Reviewer Lens:** `egm-style`, `egm-implementation-readiness`
- **Affected Scope:** lines 902, 975, 996, 997, 999, 1007
- **Discrepancy Description**: "The repository mapping performs acceptably" (997) has no metric. "I found no coverage threshold" (996) is first person, has no source, and presents the reachability audit as the substitute although reachability is not coverage. "48-72 active hours, about 20 issues" (999) is a range and an approximation. "A shorter path for a newcomer" (975) has no target against the 1,150-line baseline. "Different model or effort choices are better" (902) names no metric or threshold. "About 1,800 lines or fewer" (1007) mixes "about" with a ceiling, and "targets from the review" refers to an unnamed review.
- **Rationale & Recommendation**: Give a metric and threshold for each. For line 996, for example: "The repository sets no coverage threshold (`vitest.config.mjs`, checked 2026-11-24). Reachability and CLI tests are substitute controls; they do not measure coverage." Use "at most 1,800" and "at least 48 active hours and at least 20 issues".

### R30 No per-item rollback or phase-level checkpoint - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** whole section
- **Discrepancy Description**: The only rollback in the document is the runtime one (revert PR, kill switch). For destructive items (M0-2, M0-9, M1-5, M1-7, M3-5) the plan does not say whether a plain revert is safe. Apart from a few Verification Plan lines, there is no per-milestone "stable and buildable" checkpoint statement.
- **Rationale & Recommendation**: Add a rollback line to each destructive item and a checkpoint statement to each milestone.

### R31 The reachability rule is applied inconsistently, and the audit does not scan what the plan assumes - Severity: Major

- **Reviewer Lens:** `egm-style`, `egm-codebase-details`
- **Affected Scope:** lines 700, 825, 850, 851
- **Discrepancy Description**: Line 700 requires a caller from `bin/cli.mjs`, a workflow or a validator, and says the audit requires a CLI-level test (it does not). Line 825 treats "no caller outside tests" as a deletion criterion, but line 850 says the contract suite "counts as the adapter's caller" because the registry loads the adapter dynamically, and line 851 says the registry registers the adapter beside `builtInProviders`. `scripts/audit-reachability.mjs:208-209` scans only `lib`, `scripts` and `bin` and skips `__tests__`, so a test cannot count as a caller, and `adapters/` is not scanned at all.
- **Rationale & Recommendation**: State which mechanism makes `adapters/sbx/sbx.mjs` reachable (a static import in the registry or a named exemption) and align line 700 with the audit's real behavior.

### R32 The "(human)" marker is used inconsistently - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 687, 777, 792, 795, 832, 863, 902, 927
- **Discrepancy Description**: Line 687 says "(human)" marks acts only the author can do. The marker sits sometimes in the Action column (M5-4, X-1), sometimes mid-sentence (W0-12, M0-11), and sometimes appears as "human-authored PR", "human-built", "a human act" or "the author's call". W0-17, W0-19 (answering gates in the author's terminal) and M0-9's issue closure are unmarked.
- **Rationale & Recommendation**: Use one marker, always in the Action column, with two defined tags for "human performs" and "human-authored PR".

### R33 Stale line numbers and one inaccurate statement about `rig whoami` - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-style`
- **Affected Scope:** lines 692, 804, 850, 870, 903, 918, 924, 926, 961, 987
- **Discrepancy Description**: Drifted references: `vitest.config.mjs:7` is line 8; the reachability test `describe` is at `lib/__tests__/audit-reachability.test.mjs:161` and `it` at 162; `killProcessTree` is `lib/qa/process-supervisor.mjs:31-70`, not 37-47; `ALLOWED_QUOTA_WINDOWS` is `lib/config/quota-policy.mjs:11`; `planProjectAdoption` is `lib/init.mjs:441-498`; the `validate-evidence-contract` usage string is `scripts/validate-evidence-contract.mjs:19`; the `docs/extension-packs.md` built-in list is at lines 148-149; the `local-cooperative` rejection is `delegation-grant.mjs:92`; `rig whoami --json` is `skills/agentflow-steerer/SKILL.md:31`. Line 924 says `rig whoami` "appears only in policy yaml and test strings", but it also appears in `skills/agentflow-steerer/SKILL.md:31` (and the Claude Code copy), `adapters/openrig/agentflow-steer/startup/lead.md:10`, `startup/context.md`, `agentflow-product/startup/context.md:3`, and `bin/cli.mjs:1112` and `:1218` read `OPENRIG_SESSION_NAME`. Line 926 contradicts line 924. Line references also mix "near", "~" and bare ranges (lines 697, 875, 876).
- **Rationale & Recommendation**: Fix the numbers or name the symbol instead, use one convention, and correct line 924.

### R34 The stated reason for the vitest test location is wrong - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 692, 854
- **Discrepancy Description**: The plan says vitest includes only `lib/__tests__/`, `scripts/__tests__/` and `adapters/**`. `vitest.config.mjs` includes `scripts/**/*.test.mjs`, `lib/**/*.test.mjs` and `adapters/**/*.test.mjs`. The suggested placement still works.
- **Rationale & Recommendation**: Correct the stated reason in both places.

### R35 Layering inversion in M1-4 and two naming collisions - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-style`
- **Affected Scope:** lines 746, 857 (and W0-14, M1-8 for `coordinator`)
- **Discrepancy Description**: `lib/verification/declared-scope.mjs` would import `matchOwnedPath` from `scripts/validate-path-ownership.mjs:25`. No non-test file under `lib/` imports from `scripts/` today, and `scripts/validate-path-ownership.mjs:210` re-exports from `lib/verification/workspace.mjs`, the opposite direction. The new `coordinator` (W0-14, M1-8) clashes with the existing Cockpit coordinator (`lib/cockpit-coordinator.mjs`, `scripts/cockpit-server.mjs`). `delegation/D-<n>.json` collides with the decision IDs D1-D38.
- **Rationale & Recommendation**: Move the matcher into `lib/`, and rename the coordinator and the delegation files (for example `DEL-<n>.json`).

### R36 Verification Plan formatting and voice - Severity: Nit

- **Reviewer Lens:** `egm-style`, `egm-codebase-details`
- **Affected Scope:** lines 993-1014
- **Discrepancy Description**: The list switches from `-` to `*` markers at line 1007 after a blank line, so it may render as two lists, and the second group has no heading. Line 1011 largely repeats W0-15 (line 786). Line 1009 ("a drift check passes after the pin") does not name the command. Line 1013 gives `agentflow-sdlc gates waiting` without the `--medium` and `--root` flags that `scripts/person-gates.mjs:47-65` requires.
- **Rationale & Recommendation**: Add an "Item-level checks" subheading, use one marker, keep one copy of the repeated check, and give exact commands.

### R37 Count and citation mismatches - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 807, 814, 815, 1012
- **Discrepancy Description**: Line 807 says "24 `MUST` or `INVARIANT` lines", but the cited ranges hold 22 keyword lines in `docs/guiding-principles.md`. The other two are lines 120 and 122, which are not cited. Line 814's inline counts ("63 schemas", "31 validators") go stale as soon as M0-3 adds a schema and a validator, which lands before M0-4. Line 815 gives "Line 5", "Lines 90-95" and "Lines 62-76" without mapping them to one of the three listed files. Line 1012 labels "Week-0 spikes (W0-16 to W0-18)", but W0-16 is a baseline and W0-18 a vendor-terms finding, and the `sbx` spike (line 997) has no item ID.
- **Rationale & Recommendation**: Cite the missing lines or fix the count, date-stamp or drop the counts, attribute each line range to a file, and relabel to "Week-0 spikes and findings".

### R38 Overclaims in two descriptions - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 778, 777
- **Discrepancy Description**: "Read-only checker for each human act" (778) covers only rulesets, Apps, `sbx` version, control-repository access and host power. Line 777 also lists signing the first delegation, npm trusted publishing, and kill authority and quotas.
- **Rationale & Recommendation**: Say "for the acts listed here" and name the exceptions.

### R39 Deferred facts and hedges that should be decided now - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 788, 849, 941, 988
- **Discrepancy Description**: "If the `adapters/*` validators require a `manifest.json`" (849) is a checkable fact deferred as a hedge. "An envelope event or `checkpoint` payload" (941), "Remove or correct" (X-3, 988) and "deleted or promoted" for the W0-17 spike script (788) leave the choice to the implementer.
- **Rationale & Recommendation**: Check the fact and state the answer, and pick one option for each.

### R40 Wording, fluff and undefined terms - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 718, 774, 781, 785, 838, 848, 873, 894, 900, 931, 934, 946, 955, 960, 964, 978, 980, 987, 1001
- **Discrepancy Description**: Filler: "Deliberately small runner (about 100 lines)" (a size hint, not an acceptance criterion), "Actually runs", "wholly new", "Thin pack validator", "Stop swallowing JSON parse errors", "This enforces the brief's separation with a test and not a convention", and "hands references to the launcher. Delivers references only" (873). Undefined terms in this section: "minimal scenario" (also used differently as "minimal state", 782), "station", "hybrid placement", "wording rule", "case A/B", "factory-core", "canon", "holdouts", "CAPA", "Hold" (894), "Loosens" (934), "Integration packages removed" (946), and decision IDs D3, D11, D13 without links. "Pure function: path class, window, veto" (931) is a fragment with no inputs or outputs. "Without the author's keys" (1001) against "the author's public key" should say private keys. "Short recording" (978) has no length target, and M5-4 (980) puts a description in the Path column.
- **Rationale & Recommendation**: Drop or replace with facts, and add a one-line glossary link at the top of the section.

### R41 A local workstation path appears in the plan - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 781
- **Discrepancy Description**: `~/.local/bin/rig` is a workstation path. `docs/guiding-principles.md` section 3, rule 4 says to scrub local paths from durable docs.
- **Rationale & Recommendation**: Drop the path and keep "installed in WSL".

### R42 Overlong table cells - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 777, 781, 790, 929
- **Discrepancy Description**: Some cells carry 8 to 12 clauses or paths (W0-12, W0-13, W0-19, W0-20 file lists, M2b-2 steward path).
- **Rationale & Recommendation**: Split into sub-bullets or separate rows, or move the narrative to the ADR.

### R43 Smaller row-level gaps - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** lines 686-687, 700, 787, 788, 824, 850
- **Discrepancy Description**: M0-8 (824): `validate-pr.yml` already runs `pnpm validate:release` on an ubuntu, windows and macos matrix, so adding the smoke to the release chain in `package.json` may make the workflow edit unnecessary. W0-16 (787) gives measured numbers ("under an hour", "29 merged in the last 30 days") without the `gh` command and filters or an anchor date. Shared hot files (`bin/cli.mjs`, `scripts/validate-docs.mjs`, `package.json`, `manifests/npm-package.json`) are edited by most items, with no merge-order or conflict guidance. The plan's "Zero-Decision Rule" claim at line 687 depends on re-verification at line 23, which is not an item.
- **Rationale & Recommendation**: Check M0-8 against the existing matrix, state the `gh` query and anchor date for W0-16, and add merge-order guidance for the hot files.

### R44 Fixed-by-reference items the plan should restate - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** lines 685-687
- **Discrepancy Description**: The section opening relies on the reader having read the Conventions list and the "re-verify" note (lines 23, 687) to learn that line numbers drift and that new paths are unverified. An implementer who receives a single row would not see this.
- **Rationale & Recommendation**: Add a one-line pointer to the conventions in each milestone header.
