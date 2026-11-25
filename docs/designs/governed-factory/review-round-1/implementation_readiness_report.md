# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (`lines 597-916`, "Detailed Implementation Plan" to end of file)

**Verdict:** not ready to implement. The plan has many good specifics, but the build order is not buildable as written, several file lists are incomplete, and some deletions would break `validate:release`.

## Reviewer Status

| Reviewer                       | Status    |
| ------------------------------ | --------- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details`         | completed |
| `egm-style`                    | completed |

## Severity Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 9     |
| Major    | 24    |
| Nit      | 18    |

Findings are merged across reviewers. Where two reviewers reported the same issue, it appears once with both lenses named. The codebase-details reviewer checked the plan's file, line and function references against the repository. Create paths it checked (ADRs 017-026, `lib/substrate`, `lib/signing`, `lib/evidence`, `lib/gxp`, `lib/learning`, `scripts/coordinator.mjs`, `SECURITY.md`, `CHANGELOG.md`, `docs/limits.md` and the four new workflows) correctly do not exist yet. It also confirmed many references as accurate, for example `lib/core/gate.mjs:101-124`, `lib/core/review-attestation.mjs:6-34`, `lib/providers/registry.mjs:9-112` and `lib/sdlc-state.mjs:360-376`. Where reviewers disagreed, the disagreement is noted in the finding.

---

## Prioritized Findings (Blockers -> Major -> Nits)

### The stated build order is false: items depend on later items - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 599, 709-710, 752-761, 770, 784-786, 825, 832`
- **Discrepancy Description**: Line 599 says items are "listed in the order they can be built". Several are not.
  - M1-2's test runs the shared conformance suite (755-756), which is created in M1-3 (758).
  - M1-4's launcher pushes with the builder App (761), but the token minter is M1-7 (770).
  - The launcher checks the issue's declared scope (761-763), but the `## Declared scope` section is parsed in M1-12 (784-786).
  - M2b-2 adds a time-lock gate (825), but the time-lock function is M2b-3 (832).
  - M0-1's "finds nothing on the current repository" test fails until every export is wired, exempted or retired (709-710). It exempts only four modules. `lease-fencing`, `handover-protocol` and `role-flow-span` stay unexempted until M0-2 deletes them, so CI is red between M0-1 and M0-2. Other unwired exports in `lib/runtime` and `lib/audit` would also fail and are not enumerated.
- **Rationale & Recommendation**: An implementer cannot build the items in the listed order. Reorder them, or state each dependency with an interim stub. Add exemptions for the three modules M0-2 deletes, or merge M0-1 and M0-2 into one PR.

### M1 reads the control repository before the reader exists - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 698, 772-775, 779, 797`
- **Discrepancy Description**: M1-8 adds the control-repository pause flag, check-ins and the 7-day dead-man rule. M1-10 reads the pause flag. W0-15 re-runs the gate at the M1 exit with the "persisted pause flag read from the control repository". The reader (`control-repo-reader.mjs`) is M2-1 (797). Check-in tags are signed tags, so verifying them also needs the signing seam in M1-13, which comes after M1-8. No interim read path, credential or fail-closed behavior is given.
- **Rationale & Recommendation**: Move M2-1 ahead of M1-8, or specify the interim read path (command, credential, failure mode).

### The circuit breaker contradicts the pause flag's write authority - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 833-834` (and the Open Questions text on the pause flag)
- **Discrepancy Description**: M2b-4 says the circuit breaker "trips pause and kill". The design says the pause flag is writable only by the author, and the steward and builder Apps have no control-repository write access. The plan does not say what the breaker writes (the local `.agentflow/coordinator.json` or a control-repository flag). It also does not say how a hosted `post-merge.yml` (833) opens a revert "through the steward", since the steward App key is host-held and a hosted workflow cannot mint its token.
- **Rationale & Recommendation**: State the mechanism for both. For example, the workflow reports the failure and the host coordinator performs the revert and the pause.

### M1-14's demo needs components built in M3 and M4 - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 790, 874-880, 914`
- **Discrepancy Description**: The demo runs "to an evidence bundle to a trace-matrix row". The bundle is M3-1 and the trace matrix is M4-1. M5-6 and the Verification Plan (914) also expect "a rejected tampered bundle" from `demo-skeleton.mjs`, but no M3 or M4 item lists `scripts/demo-skeleton.mjs` as modified.
- **Rationale & Recommendation**: Scope M1-14 to what exists at M1. Add explicit Modify rows for the demo script and its test in M3-4 and M4-1.

### M2-2 leaves a core design decision open and under-specifies the verifier - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 74, 800-802`
- **Discrepancy Description**: M2-2 says "`pull_request_target` or an organization-level required workflow; see Open Questions". Open Questions (line 74) says this is unresolved. `pin-verifier.mjs` "builds the release artifact and prints its digest" without saying what the artifact is, what is hashed, or how the control repository's `verifier.digest` is compared. M2-2 also says `verify-pr.mjs` "imports the validators as functions" (800), but only `validate-pr-manifest.mjs` gets an import-safety refactor (M1-12, 786). The holdout, no-op, review-freshness and path-ownership validators get none.
- **Rationale & Recommendation**: Resolve the trigger choice before M2 and record the week-0 spike result here. Define the artifact and the digest rule. List the per-validator refactors.

### M0-10's wording rule cannot pass with the files listed, and cites a false fact - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** `Lines 739-743, 908`
- **Discrepancy Description**: Line 742 cites "the six 'fencing' mentions in `scripts/validate-docs.mjs`". Both reviewers found none there. In `scripts/`, "fencing" appears only in `steer.mjs`, `process-pilot.mjs` and tests. A case-insensitive search found about 213 occurrences in 59 files. Many are outside M0-10's list:
  - Docs: `docs/agent-workflow.md` (5), `docs/intelligent-collaboration.md`, `docs/process-autonomy/portable-continuation.md`, `docs/maintainers/onboarding-experiment-retrospective.md`, `docs/operators/openrig-execution-contracts.md`, `agents/templates/sparring-brief.md`.
  - Code: `lib/core/role-collaboration.mjs` (15), `lib/sparring-gate.mjs`, `lib/core/sparring.mjs`, `lib/config/quota-policy.mjs`, `lib/application/configured-run-source.mjs`, `scripts/process-pilot.mjs`.
  - Many tests.

  The ledger rule (743, 908) allows "fencing" only in the glossary, erratum notes, historical ADRs and releases, and the `fencingToken` field name. It does not say whether it scans prose only, or code identifiers, comments and tests as well. As written, `pnpm validate:claims` fails at the M0 exit.

- **Rationale & Recommendation**: Define the scanned file set (for example `docs/**/*.md`, `README.md`, `skills/**` and `agents/**`, excluding code and tests). List the missing prose files. State how exempt categories are identified, for example by path glob. Correct the `validate-docs.mjs` claim.

### M0-9 has no usable write allowlist and misses importers and config - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** `Lines 731-738` (line 23 for the "already read" claim)
- **Discrepancy Description**: The plan says the exact files are "confirmed when the milestone list is re-verified". That is a family list, not a path list, and the exact paths are knowable now. After the deletion `validate:release` would fail.
  - Tests that import deleted modules and are not listed:
    - `lib/__tests__/seat-table.test.mjs:5` imports `DORMANT_SEATS` from `continuity-policy.mjs`, and line 133 reads the `agentflow-product` and `agentflow-eval` `rig.yaml` files.
    - `lib/__tests__/quota-policy.test.mjs:26` imports `platform-fallback.mjs`.
    - `lib/__tests__/three-mode-equivalence.test.mjs:35` imports `lifecycle.mjs`.
    - `lib/__tests__/oracle-case-scope.test.mjs` and `lib/__tests__/native-oracle-assignment.test.mjs` import `agentflow-product/oracle-admission.mjs`. The globs `oracle-writer-*` and `handoff-*` do not match them.
    - `scripts/__tests__/run-incidents.test.mjs` tests the `incidents` subcommand being removed.
    - `scripts/__tests__/adoption-preview.test.mjs:23` and `scripts/__tests__/execution-plan-cli.test.mjs:22` iterate over the bundle name `agentflow-product`.
  - `agent-workflow.config.json` is a bigger gap than the "platform-fallback config entry". `delivery.candidate.inputs` (lines 145-272) lists the deleted adapter files, tests and docs, including `docs/openrig-runtime-compatibility.md`. `delivery.checks` (lines 327-363) names `openrig-platform-fallback.test.mjs`, `operational-preflight*.test.mjs`, `adapter-lifecycle.test.mjs` and `adapters/openrig/__tests__/*`. The plan never says to edit these lists.
  - `bin/cli.mjs:1050-1058`: `HOLD_COMMANDS` is `deliver, list, flush, release, busy, step, capacity`. All seven route to `agentflow-product/handoff.mjs` (line 1053), which is deleted. The plan removes only three verbs (735), so four would import a missing file. The `handoff` usage text at line 1425 also lists them.
  - Row 732 says "Trim to about 900 lines" with no keep-list. Row 733 lists test families, not paths, and row 734 names `lib/bridge` operations with no filenames.
- **Rationale & Recommendation**: Enumerate every path, importer and config entry as an explicit Modify or Delete row. State a keep-list for `bin/cli.mjs` handlers. If the allowlist needs a glob, limit it to the deleted directories.

### M0-9's `agentflow/**` trim conflicts with the distribution generator and `validate-seats` - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Lines 732, 735`
- **Discrepancy Description**: `scripts/generate-execution-distribution.mjs:63-76` writes the "execution distribution" paragraph into every bundle's `CULTURE.md` and fails on drift (`validate:distribution`). Removing the paragraph by hand fails the gate unless the generator stops writing it. The plan only says to remove "the deleted bundles from the generator's list". `agentflow-eval` is not in that list, which is `['agentflow','agentflow-product','agentflow-steer']`. `scripts/validate-seats.mjs:17-24` fails if `adapters/openrig/agentflow/CULTURE.md`, `README.md` or `OPENRIG.md` is missing. The plan does not say whether these survive the trim to about 900 lines. M0-10 edits `CULTURE.md`, which implies it stays.
- **Rationale & Recommendation**: Name the kept files. Specify the generator change that stops it writing the paragraph.

### M2b-2's steering bundle deletion misses live references - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** `Lines 828-830`
- **Discrepancy Description**: Deleting `adapters/openrig/agentflow-steer/**` leaves live references.
  - Codebase-details: `seat-table.test.mjs:133`, `generate-execution-distribution.mjs:26`, the bundle tests above, `agent-workflow.config.json:176-177`, and the `rigs` array in `adapters/openrig/manifest.json` still name that bundle.
  - Implementation-readiness: `OPENRIG_SESSION_NAME` appears in 29 files outside the bundle, including `scripts/steer.mjs`, `scripts/validate-path-ownership.mjs`, `bin/cli.mjs`, `lib/runtime/dispatch.mjs`, `lib/agent-caller.mjs`, `docs/agent-workflow.md` and `scripts/__tests__/steering-authority.test.mjs`. Several are covered by M0-9, and the plan should confirm which remain.
  - The steward identity change also touches `manifests/seats.json`, `npm-package.json`, `product-payload.json` and the ledger. None is listed.
  - Lines 829-830 are two Modify rows over the same two `SKILL.md` files. Merge them so two PRs do not edit the same lines.
  - `steer-guard.mjs` lives under the bundle, so the Delete glob covers it. Say so.
- **Rationale & Recommendation**: List every importer and config entry as an explicit row. Merge the two `SKILL.md` rows.

### Test plan gives file names, not cases - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `All tables, lines 677-891`
- **Discrepancy Description**: Only a few rows give assertions (M0-1 fixtures, M1-3's suite list, M2-10, M3-4 fixtures and the milestone-exit lines at 907-914). Most rows give only a filename, for example `claims-ledger.test.mjs` (714), `launcher.test.mjs` (761), `intake-poll.test.mjs` (779), `delegation-grant.test.mjs` (824), `time-lock.test.mjs` (832), `circuit-breaker.test.mjs` (834) and `trust-policy.test.mjs` (845). Some rows have no test: `post-merge.yml`, `attest-evidence.yml`, `verify-pr.yml`, `publish.yml`, `claude-agy-v1.json`, `egress-allowlist.json`.
- **Rationale & Recommendation**: Add a happy-path and edge-case list per item, at least for each launcher, poller, steward and verifier item.

### Substrate adapter manifest convention does not exist - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** `Lines 753, 755, 757`
- **Discrepancy Description**: Existing `adapters/*/manifest.json` files use a `harness` key and no `kind`. `validatePluginManifests` requires `skills`, `roleEntry`, `roles`, `namespace`, `commands`, `settings` and `entry` (`lib/plugin-manifests.mjs:24-36`), and `PLUGIN_HARNESSES` is a closed set at line 6. Row 757 cites "line 102", which is inside `buildPluginManifests`. The plan gives no shape for the `kind: substrate` manifest, and does not say how it escapes the harness validations. Neither `lib/substrate/registry.mjs` nor `adapters/sbx/manifest.json` has a spec.
- **Rationale & Recommendation**: Give the manifest JSON shape. Say whether `validatePluginManifests` skips non-harness entries or a separate validator is added. Correct the line reference and list any `schemas/` change.

### Existing digests change with no migration - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 765, 767, 849`
- **Discrepancy Description**: M1-5 makes `providerDigest` delegate to `recordDigest` (`lib/providers/provider-receipt.mjs:4-6`, currently a key-order-dependent `JSON.stringify`) and replaces `sparring.mjs`'s `canonicalJson`. Both change stored and sealed digests. `providerDigest` has callers in `local-cli.mjs`, `manual.mjs`, `provider-api.mjs`, `governed-engineering.mjs` and `codex-engineering.mjs`, none of which appear in the plan. M3-5 normalizes line endings inside `computeOracleDigest` and `computeReviewDigest`, which invalidates existing digests after signed human acts start in M1-13. The plan's own Alternative AI text (493-497) names this ordering problem, yet schedules the fix after M1-13.
- **Rationale & Recommendation**: State a dual-read or version-tag strategy per change. Add the caller and test files to the allowlist, or move the line-ending fix before M1-13.

### Receipt and schema changes lack field definitions - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 766, 788, 789, 850, 648-653`
- **Discrepancy Description**: "Add the `substrate` and `evaluator` blocks (null by default)" has no `evaluator` fields and no JSON shape. M1-13 says the attestation schema "needs a version bump" without a version number, new field names or a dual-read rule. `trust-policy.schema.json` and `signed-human-act.schema.json` have no field list beyond the sketch at 648-653. `lib/core/gate.mjs` must stay pure (`architecture-fitness.test.mjs:33-42` forbids imports from providers, sources, adoption or config), and the plan does not say how `satisfyGate` receives the verified signature result.
- **Rationale & Recommendation**: Include the field tables, version values and the injection signature for `satisfyGate`.

### M1-12 breaks existing consumers and tests without listing them - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 784-786`
- **Discrepancy Description**: Requiring `## Declared scope` in `validateIssueAgainstSdlc` affects every file that references "Acceptance criteria": `lib/github-setup.mjs`, `.github/ISSUE_TEMPLATE/chore.md`, `scripts/validate-spec.mjs`, `lib/cockpit-goal-model.mjs`, `lib/cockpit-markdown.mjs`, `lib/core/delivery-policy.mjs`, `docs/sources/product-discipline.md`, `docs/examples/simple-bugfix-flow.md`, `roles/analyst/ROLE.md` and the `audit-reachability` fixtures that copy `sdlc-state.mjs`. The plan does not say whether the requirement is always on or gated by profile or posture, although principle 3 lets `light` work skip gates.
- **Rationale & Recommendation**: List every touched file. State the profile-gating rule and the adopter behavior (warn versus fail).

### New docs, manifests and ADRs are not all registered - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** `Lines 610-611, 688, 693`, and the Create rows throughout
- **Discrepancy Description**: The conventions require every new doc to be linked from `docs/index.md` or `validate:docs` fails. Only W0-12, M0-3, M0-7 and M5-3 list the index. These are never linked: `week-0-gate.md`, `milestone-admission.md`, `vendor-terms.md`, `baseline-2026-11.md`, `coordinator-runbook.md`, `wsl2-substrate.md`, `soak-runbook.md`, `verify-evidence.md`, `evidence-predicate.md`, `gxp-projection.md`, `supplier-table.md`, `responsibilities.md`, `conformance-report.md`, `case-study.md`. Operator docs also need `docs/operators/index.md`. W0-11 registers ADRs 017-026 (688) but W0-13 creates ADR 027 (693), so 027 is never registered. Most new shipped files under `lib/substrate`, `lib/signing`, `lib/evidence`, `lib/verification`, `lib/gxp` and `lib/learning` are not in `manifests/npm-package.json` or `product-payload.json`.
  - Codebase-details adds that `validate:npm` checks that `requiredFiles` are present and no forbidden prefixes exist. It does not enforce "new shipped file added to `npm-package.json`". Unlisted lib files pack silently. The closed-import enforcement is `architecture-fitness`, through `composition-profiles.json` and `product-payload.json`. Line 610 overstates what `validate:npm` does.
- **Rationale & Recommendation**: Add a per-milestone registration row, or state which new files need no registration and why. Correct the line 610 description.

### W0-2 cites the wrong `AGENTS.md` lines and lists too few contradictions - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`
- **Affected Scope:** `Line 679`
- **Discrepancy Description**: All three reviewers found that "Review and safety, lines 62-64" is wrong. Lines 62-64 are "Branch discipline". "Review and safety" is lines 66-71, and the high-assurance human-review statement D4 contradicts is line 69 (line 70 covers read-only review roles). The Two-Plane Separation text (lines 90-93, which reserves merge verbs for the steering plane) is also affected. The plan says "the three statements", but the same human-PR-review statement also appears in `CLAUDE.md:31`, `AGY.md:30`, `CODEX.md:27`, `defaults/AGENTS.md:42`, `docs/guiding-principles.md:43` and `:59`, `docs/agent-workflow.md:587`, `agents/agentflow-sdlc/AGENT.md:95`, `docs/delivery-release-acceptance.md:21` and `docs/guides/contribution-workflow.md:84`. The "ADR 016 section 9" reference does not map to a heading (the headings are Context, Decision, As built, Not yet shipped, Consequences), though a later check found ADR 016 decision 9 exists.
- **Rationale & Recommendation**: Correct the line references. Name the exact sentences amended. Add the other files to W0-2 or to named later items, and give the replacement wording or point to the design paragraph that supplies it.

### Design values left to the implementer - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 700, 702, 713-714, 761-762, 768-769, 772-778, 779, 808, 831, 844-846, 858-860, 866, 878`
- **Discrepancy Description**: Under the Zero-Decision Rule the plan leaves these to the implementer:
  - Launcher (761-762): timeout, run-budget values, config keys, behavior when the declared-scope check fails, and redaction and size-cap values.
  - M1-6 (768-769): the `providers` array schema, the `-p` and effort flags for Claude and Agy, and the `resolveConfiguredEngineeringProvider` mapping.
  - M1-8 (772-775): what `tick` does and what "draining" does at coordinator level.
  - M1-9 (776-778): config keys for the person-gate deadline and the `.agentflow/gates/` file format.
  - M1-10 (779): where autonomy level, lane caps and poll interval live in config.
  - M2-6 (808): the host list ("model vendor hosts and any package registries").
  - M2b-2 (831): "check how `requiredHumanGateClasses` and `satisfyGate` treat..." is investigation, not an instruction.
  - M3-2 and M3-3 (844-846): the predicate type URI, the TSA and the scheduler for the "nightly job".
  - M4-2 (858-860): no clause mappings, and `<version>` placeholders instead of paths.
  - M4-3 (866): the seat id for the learning worker.
  - M5-3 (878): `docs/releases/v<next>.md` and the version bump value.
  - W0-17 (700): "deleted or promoted into `lib/signing/`" is an open choice.
  - W0-19 (702): goal fields "confirmed when re-verified".
  - M0-3 (713-714): the "listed files" for the keyword scan live nowhere, the set of ledger rows is open-ended ("for example"), and the wording rule for "compliant" and "supports X" has no detection method.
- **Rationale & Recommendation**: Decide these in the plan, or mark the item spike-first with its output recorded before the item opens.

### `declared-scope.mjs` creates a dependency-direction risk - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Line 763`
- **Discrepancy Description**: `lib/verification/declared-scope.mjs` imports `matchOwnedPath` from `scripts/validate-path-ownership.mjs`. That puts a library module behind a script in the pinned verifier's dependency chain, and the script itself imports from `lib/verification/workspace.mjs` (line 210), so a cycle is possible. The codebase-details reviewer notes `lib/trace-auditor.mjs` is a precedent for a lib import of a script, and confirmed the `matchOwnedPath` export exists.
- **Rationale & Recommendation**: Move `matchOwnedPath` into `lib/` (state where) and have the script re-export it, or state why the precedent is acceptable.

### Week-0 `box` verb wiring and the M1-4 deletion of `guarded-run.mjs` - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** `Lines 689-691, 698, 764`
- **Discrepancy Description**: W0-12 registers `box check` and `box gate` in `bin/cli.mjs` and `KNOWN_CLI_COMMANDS`, but `box gate`'s target `scripts/week0-gate.mjs` is created in W0-15. That leaves a registered verb with no implementation, which breaks the stable-phase rule. The dispatcher script for the `box` group is not named. M1-4 deletes `scripts/guarded-run.mjs` (764), but the week-0 gate checks agent runs, kill timing and cap refusal and is re-run at the M1 exit (698). M1-4 does not list `scripts/week0-gate.mjs` or its test as modified, so they would break.
- **Rationale & Recommendation**: Move the registration to W0-15. Name the `box` dispatcher. Add the gate script and test to M1-4.

### `lib/sparring.mjs` does not exist - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 767` (M1-5)
- **Discrepancy Description**: The private `canonicalJson` is at `lib/core/sparring.mjs:2`. The Modify row names a path that does not exist, so it would fail the write allowlist.
- **Rationale & Recommendation**: Correct the path to `lib/core/sparring.mjs`, and add its test.

### Deleting `handover-protocol.test.mjs` strands `context-sanitizer` - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Lines 711-712` (M0-2)
- **Discrepancy Description**: That test file is the only test of `lib/runtime/context-sanitizer.mjs`. Tests 1, 2, 3 and 5 exercise `normalizePathToPosix`, `scrubSecretsAndPii`, `compressContextPayload` and `cleanupGitLocks`. Only `scrubSecretsAndPii` has a production importer (`lib/providers/engineering-evidence.mjs:2`). With `lib/runtime/` added to `CORE_API_PREFIXES` by M0-1, the other exports are flagged as unwired. `scrubObject` is another unwired export.
- **Rationale & Recommendation**: Say which tests move to a new `context-sanitizer.test.mjs`. Say whether to remove or exempt the retracted exports, since the 15% compression cap is retracted.

### M0-1 understates the audit's blast radius and contradicts the reachability rule - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-style`
- **Affected Scope:** `Lines 709-710, 756, 612, 714`
- **Discrepancy Description**: Adding four prefixes audits every exported function in `lib/audit`, `lib/gates`, `lib/qa` and `lib/runtime`. `lib/runtime` alone includes `dispatch`, `seat-claim`, `seat-lease`, `seat-prime`, `path-identity`, `scrub-git-output` and `slice-worktrees`. The `export class` fix does not make the sweeper's function exports visible, so `createGateTracker`, `sweepGate`, `handleWebhookEvent` and `formatRevisionContext` are also flagged. The "refinement engine" exemption is unnecessary, since `lib/refinement-engine.mjs` is outside every prefix. The mechanism is a `module#export` Map, and there is no "planned" concept today, so the exemption schema is an unstated design choice. Separately, line 756 says the conformance suite "counts as the adapter's caller for `audit-reachability`", but line 612 requires a caller reachable from `bin/cli.mjs`, a workflow or a `validate-*` script, and line 714 requires a non-test importer for `implemented` ledger rows. A test importer cannot satisfy these rules.
- **Rationale & Recommendation**: Enumerate the expected findings and each disposition. Define the exemption schema. State the exemption or audit rule that makes line 756 true (for example a named `OFF_PATH_EXEMPTIONS` entry), or state that the launcher's registry call is the caller.

### M0-11 cannot work as written - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Lines 744-745, 909`
- **Discrepancy Description**: `lib/config/execution-distribution.mjs:4-12` loads one module-level `PROFILE`. `APPROVED_MODELS` (line 26) derives from it and `validateOptions` rejects any other model. `resolveDistribution` rejects any other profile id (line 67). A Claude and Agy profile with new models fails regardless of a path in config. The Gemini fix is under-specified: line 15 is `['pi','pi-session','antigravity','google','pi']` and `validateOptions` checks all five fields in order, but the replacement tuple, model prefix and the mapping of Agy to the `gemini` subscription key are not given. The "any runtime in the registry (Claude, Agy, Codex, Grok, Pi)" claim has no `ROUTES` entries for Agy or Pi. `generate-execution-distribution.mjs:11` always projects `defaultDistributionSelection()`, so "a drift check passes after the pin" (909) is ambiguous.
- **Rationale & Recommendation**: Specify the loader change, the replacement tuple and the Agy and Pi routes, and clarify the drift check.

### M1-10 duplicates existing intake code - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 779`
- **Discrepancy Description**: `lib/bridge/bridge.mjs` already calls `callSourceCapability(source,'ready-predicates','listWorkItems')` (lines 820 and 951) and `claimOrYield` (lines 34 and 146). M0-9 keeps `intake`.
- **Rationale & Recommendation**: Say how `lib/runtime/intake-poll.mjs` reuses or differs from `bridge.mjs`, and whether it imports `callSourceCapability` from `lib/core/source-adapter.mjs`.

### W0-14 reuse, reachability and naming - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Lines 694-697`
- **Discrepancy Description**: `guarded-run.mjs` re-implements timeout, kill and process-tree termination, while `killProcessTree` and `ProcessSupervisor` already exist in `lib/qa/process-supervisor.mjs`. The plan wires them only at M1-9. `scripts/guarded-run.mjs` has no CLI verb or validate caller, so `lib/runtime/run-cap.mjs` exports are unreachable once M0-1 adds `lib/runtime/`. `lib/cockpit-coordinator.mjs` already exists for the OpenRig DEV coordinator, so "coordinator" collides, as do the existing `run pause` and `resume` verbs.
- **Rationale & Recommendation**: Require `guarded-run.mjs` to import `killProcessTree`. Add a CLI path or an exemption for `run-cap`. Define the distinction from `cockpit-coordinator.mjs`.

### W0-19 misdescribes `goal.json` - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 702`
- **Discrepancy Description**: `goals/g3/goal.json` has only `{version, title, body, createdAt}`. `kind`, `parent` and `change-class` are flags on `phase append` and `gates open`, not goal fields.
- **Rationale & Recommendation**: Say where each value is recorded.

### M1-8 `seat-lease.mjs` row has no action and a wrong line reference - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 775`
- **Discrepancy Description**: `claimSeatLease` already takes `allowSupervisory`, and the guard is at lines 50-54, not 48-52. The real caller is `bin/cli.mjs:1119-1129`, gated on `--allow-supervisory` or `AGENTFLOW_SUPERVISORY_VERIFIED`. The Modify row names no change.
- **Rationale & Recommendation**: Specify the change and how the coordinator proves supervisory authority instead of passing `true`.

### M0-9 `lib/bridge` row names a nonexistent file and wrong verbs - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 734`
- **Discrepancy Description**: `lib/bridge/slice-worktrees.mjs` does not exist. The module is `lib/runtime/slice-worktrees.mjs` with `lib/__tests__/slice-worktrees.test.mjs`, and neither is in the boundary. `replay` is not a bridge verb. The verbs are `intake|start|evidence|reconcile|cleanup|escalate|status` (`scripts/bridge.mjs:29`), and `reconcile` is neither kept nor deleted. `lib/bridge/bridge.mjs` and `memory-queue.mjs` implement the subcommands, so the work is a Modify, and the `bridge` usage string at `bin/cli.mjs:1388` needs updating.
- **Rationale & Recommendation**: State which verbs survive and which files change.

### Line 599 makes claims the tables do not satisfy - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Line 599` (rows 731-738, 761-764, 767, 774-775, 802, 833)
- **Discrepancy Description**: "Each lists its tests in the same row" is false for several rows: M1-5 `lib/sparring.mjs` (767), M1-8 `run-delivery.mjs`, `run-service.mjs`, `actuate-readiness.mjs` (774), M1-8 `seat-lease.mjs` (775), M2-2 `verify-pr.yml` and `pin-verifier.mjs` (802), and M2b-4 `post-merge.yml` (833). "Each is one focused PR" is also false: M0-9 (731-738) deletes about 3,100 lines across roughly 40 paths, and M1-4 (761-764) adds three modules and deletes one script. "Focused" is subjective.
- **Rationale & Recommendation**: Say "most rows list their tests; rows without one name the covering test or state none", or add the missing tests. Replace "focused" with a measurable bound, and split M0-9 or mark it as an exception.

### Line 889 leaks a local workstation path - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Line 889` (X-3); milder case at line 693
- **Discrepancy Description**: The path `movetheneedle/website` contains a drive, a user name and a local layout. `docs/guiding-principles.md` section 3 item 4 ("Never Leak Local State") requires scrubbing these from durable evidence. Line 693 names `~/.local/bin/rig`, a home-relative install path.
- **Rationale & Recommendation**: Name the repository by role, for example "the website repository (`movetheneedle`)". Say only "installed in WSL" at line 693.

### M0-4 findings are not attributed to files - Severity: Major

- **Reviewer Lens:** `egm-style`, `egm-codebase-details`
- **Affected Scope:** `Line 721`
- **Discrepancy Description**: One row lists three files and then gives "Line 5", "lines 90-95" and "lines 62-76" without saying which belongs to which. The claims are true but unattributed. The codebase-details reviewer maps them: `mockPacket`, `lease-fencing` and `handover-protocol` are at lines 92-94 of `process-autonomy-reconciliation.md`, the `lib/core/*` paths are at lines 52, 62, 68 and 74 of `goal-recursive-self-improvement-dogfooding.md`, and only line 5 ("v1.0.0") is in `agentflow-in-5-minutes.md`.
- **Rationale & Recommendation**: Split the row or prefix each finding with its file, using the mapping above.

### The count of "24 `MUST` or `INVARIANT` lines" is disputed and load-bearing - Severity: Major

- **Reviewer Lens:** `egm-style`, `egm-implementation-readiness`, `egm-codebase-details`
- **Affected Scope:** `Line 713` (and the ledger rule at 714)
- **Discrepancy Description**: Style and implementation-readiness counted 22 keyword lines in the cited ranges (27-29, 42-44, 57-60, 72-74, 87-91, and 105, 106, 110, 111). Reaching 24 needs lines 120 and 122, which are outside the cited ranges, and line 122 only lists the keywords. Lines 107-109 sit inside "105-111" without a keyword. The codebase-details reviewer reports the count of 24 and the ranges as verified. The reviewers disagree, so the count needs a fresh deterministic check. The ledger validator (714) enforces "every uppercase-keyword line has a row", so the number is load-bearing.
- **Rationale & Recommendation**: Recount with a script. Either cite the full set including lines 120 and 122 or state the correct number, and decide whether line 122 needs a row.

### Unmeasurable pass and decision criteria - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Lines 806, 876, 898`
- **Discrepancy Description**: Line 898: "the repository mapping performs acceptably" has no metric or threshold, and it drives a go or fallback decision for the substrate. Line 806 (M2-4): "different model or effort choices are better" names no metric. Line 876 (M5-3): "a shorter path for a newcomer" states the current 1,150 lines but no target.
- **Rationale & Recommendation**: Name the measure and limit (sandbox start time or representative build time for 898, cost per merged PR or rework rate for 806, a target line count for 876), or drop the clause.

### Duplicate IDs and M5 numbering break "order they can be built" - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
- **Affected Scope:** `Lines 677, 879-881`
- **Discrepancy Description**: W0-1 has two rows with different column spacing, and the same pattern appears for W0-14. M5-6 (879-880) is listed before M5-4 (881), and there is no M5-5.
- **Rationale & Recommendation**: Merge or renumber the rows and fix the order.

### Line-number drift - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** `Lines 604, 710, 735, 775, 779 and others`
- **Discrepancy Description**: References that are close but off:

  | Plan                                            | Actual                                          |
  | ----------------------------------------------- | ----------------------------------------------- |
  | `audit-reachability.test.mjs:161`               | line 162                                        |
  | `HOLD_COMMANDS` at `cli.mjs:1053`               | line 1050                                       |
  | usage `cli.mjs:1383-1404`                       | `ROOT_USAGE` at 1383, `COMMAND_USAGE` 1386-1435 |
  | dispatch `cli.mjs:1728-1741`                    | dispatch spans about 1600-1770                  |
  | `quota-policy.mjs:9`                            | line 11                                         |
  | `validate-evidence-contract.mjs` usage 15-16    | lines 18-20                                     |
  | `delegation-grant.mjs:91`                       | line 92                                         |
  | `verifyMergeGates`, `steer.mjs:689`             | line 691                                        |
  | `github.mjs` claim ~365-385                     | `claim()` at 396                                |
  | `package.json` `files` 53-77                    | lines 62-85                                     |
  | `killProcessTree` 37-47                         | function spans 31-70                            |
  | `refinement-engine` evidence 132-136            | evidence at line 140                            |
  | steerer `SKILL.md` identity assertion 21-27     | lines 26-35                                     |
  | `docs/extension-packs.md` built-in list 115-117 | pack list at 149-150                            |
  | `seat-lease.mjs` guard 48-52                    | lines 50-54                                     |

  The reviewers disagree on `vitest.config.mjs:7` (line 604): codebase-details says line 8, style says it matches. Recheck it.

- **Rationale & Recommendation**: Update the references, or anchor on function names instead of line numbers.

### `.agentflow/gates/` path collision - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `W0-15 (line 698) and M1-9 (776-778)`
- **Discrepancy Description**: Both use `.agentflow/gates/` (`week0.json` and sweeper state).
- **Rationale & Recommendation**: Separate the paths.

### `sdlc validate-claims` needs a handler branch - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 716` (M0-3)
- **Discrepancy Description**: The new subcommand needs a `handleSdlc` branch (`bin/cli.mjs:405-437`), not only the usage text at 439-457.
- **Rationale & Recommendation**: Add the handler branch to the row.

### M2-3 restates an existing mapping - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** `Line 805`
- **Discrepancy Description**: `modelFamily` already maps `gemini` and `gemma` to `google` (`model-family.mjs:17`). Agy is a platform, not a model name.
- **Rationale & Recommendation**: Restate the actual change.

### Rows mix Create and Modify - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 723, 725, 823`
- **Discrepancy Description**: `lib/application/local-cooperative-issuer.mjs` already exists (Modify), while `signed-delegation-issuer.mjs` is new (Create). They share a row.
- **Rationale & Recommendation**: Split the rows.

### Inconsistent list markers in the Verification Plan - Severity: Nit

- **Reviewer Lens:** `egm-style`, `egm-implementation-readiness`
- **Affected Scope:** `Lines 894-914`
- **Discrepancy Description**: Lines 894-906 use `-`, lines 907-914 use `*`. The "W0-16 to W0-18" row also calls the baseline a spike.
- **Rationale & Recommendation**: Use one marker.

### Inconsistent table padding - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Rows 677, 693-697, 703, 753-756, 764, 772-773, 806, 808-809, 812-813, 828, 830`
- **Discrepancy Description**: These rows are not padded like their neighbors.
- **Rationale & Recommendation**: Run Prettier on the file.

### Heading at line 670 omits Delete rows - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Line 670`
- **Discrepancy Description**: "Target Files to Create/Modify" but the tables also contain Delete and (human) rows.
- **Rationale & Recommendation**: Rename to "Files to create, modify or delete".

### Undefined or informal terms - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Lines 693, 711, 731, 828, 887` and the M2 heading
- **Discrepancy Description**: "the box" (`box check`, `box gate`, "out-of-repo box"), "minimal scenario", "dark running", "second chain" and "four-eyes" (804) are not defined in this section.
- **Rationale & Recommendation**: Define each once in Conventions, or use the specific term.

### Filler words - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Lines 697, 759, 804`
- **Discrepancy Description**: "deliberately small", "deliberately weak" and "actually runs" add no information.
- **Rationale & Recommendation**: Use "a small runner", "a weak adapter" and "so the four-eyes check runs".

### Unclear sentence at line 807 - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Line 807`
- **Discrepancy Description**: "Today it has only `weekly` and `five-hour` and no window." The last clause is unclear.
- **Rationale & Recommendation**: If it means no `daily` window or counter exists, say that.

### First person at line 897 - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Line 897`
- **Discrepancy Description**: "I found no coverage threshold" and "A threshold is not added" switch to first person.
- **Rationale & Recommendation**: "This repository has no coverage threshold. None is added."

### Re-verify rule repeated per row - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Lines 599, 702, 733, 740`
- **Discrepancy Description**: "Before a milestone starts, its list is re-verified" is repeated in rows.
- **Rationale & Recommendation**: Keep the rule once in 599, and drop the repeats unless a row names a specific unknown. Note this conflicts with the Blocker above: M0-9's allowlist must be enumerated now, so the repeat at 733 should go.

### Size targets are not stated as limits - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Lines 697, 732`
- **Discrepancy Description**: "about 100 lines" and "about 900 lines" are targets.
- **Rationale & Recommendation**: Say whether they are limits.

### `sbx` spike has no script or notes path - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Line 898`
- **Discrepancy Description**: Unlike W0-17 (700), no output path is given.
- **Rationale & Recommendation**: Add one.

### Unbounded or unreproducible evidence phrases - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** `Lines 723, 914`
- **Discrepancy Description**: Line 914 says "a short recording" with no length. Line 723 says "`agy --help` on the author's machine lists `--model`" with no version.
- **Rationale & Recommendation**: Give a length bound (for example under 2 minutes) and record the `agy` version or point to the W0 spike.

### Conflicting line citation for `lib/runtime` exemptions and guiding-principles count (see Major above) - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** `Line 710`
- **Discrepancy Description**: Residual note only: the 22 versus 24 disagreement is recorded under the Major finding on line 713. No separate action.
- **Rationale & Recommendation**: Resolve it there.

---

## Items Verified Accurate (codebase-details)

`lib/core/gate.mjs:101-124`, `lib/core/review-attestation.mjs:6-15` and `17-34`, `lib/core/execution-receipt.mjs:203-205`, `lib/core/source-claim.mjs:62-70`, `lib/sources/github-credential.mjs:13`, `lib/providers/github-merge.mjs:39-42`, `lib/providers/registry.mjs:9-45` and `75-112`, `lib/providers/local-cli.mjs:117, 136, 211`, `lib/core/run-state.mjs:28-51`, `scripts/actuate-readiness.mjs:54-78`, `lib/observability/events.mjs:72-117` and `134-145`, `lib/gates/gate-sweeper.mjs:28` and `204`, `lib/qa/process-supervisor.mjs:74`, `lib/sdlc-state.mjs:360-376`, `lib/evidence-contracts.mjs:130-195`, `lib/core/delivery-policy.mjs:171-196`, `scripts/validate-docs.mjs:7-45`, the `audit-reachability.mjs` references, `docs/agent-workflow.md` sections at 673, 700 and 704-719, README counts (63 schemas, 31 validators), `validate-pr-manifest.mjs` running at import time, and the `matchOwnedPath` export.
