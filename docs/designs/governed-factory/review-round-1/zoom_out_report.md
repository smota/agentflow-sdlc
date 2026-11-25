# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (lines 1-916, full file)

**Mode:** REVIEW. Context read by both reviewers: `AGENTS.md`, `docs/guiding-principles.md`, `docs/modular-architecture.md`. The zoom-out reviewer also applied `zoom-out-standard.md`. The inventive-catalyst reviewer used no standard.

## Reviewer Status

| Reviewer                 | Status    |
| ------------------------ | --------- |
| `egm-zoom-out`           | completed |
| `egm-inventive-catalyst` | completed |

## Severity Summary (after deduplication)

| Severity | Count |
| -------- | ----- |
| Blocker  | 2     |
| Major    | 23    |
| Nit      | 10    |

The inventive-catalyst persona normally caps REVIEW findings at Major. It used Blocker once, for the credentialed-verifier hole, and the zoom-out reviewer rated the same issue Major. This report uses Blocker because both reviewers found the same hole, and it stops the design meeting its own goal G4.

## Overall Verdict

The problem diagnosis in the design is strong. As written, the design does not pass the zoom-out standard. Two issues must be fixed before factory-core work is admitted. First, the design contradicts the project's own governing documents in places it does not name. Second, its central verifier runs candidate code beside secrets. Beyond those, the design carries far more scope than its month-6 claim needs. It also mixes architecture, decision history and a per-file work plan in one 916-line file. Several enforcement points rely on a model session's behavior where a deterministic or platform check would remove the trade-off.

**Code claims the zoom-out reviewer verified (these hold):**

- The six named modules have no non-test importers.
- `scripts/audit-reachability.mjs:575` has `CORE_API_PREFIXES = ['lib/core/', 'lib/verification/']`.
- `lib/providers/local-cli.mjs` passes `HOME` and `USERPROFILE` (lines 13-14), with a default timeout of 120,000 ms (line 140).
- `lib/sources/github-credential.mjs:13` calls `gh auth token`.
- `lib/core/source-claim.mjs:66` uses a random `claimId`.
- `lib/config/quota-policy.mjs:11` allows only `['weekly', 'five-hour']`.
- `lib/core/execution-receipt.mjs:203` runs the four-eyes check only when `metadata.builderReceipt` exists.

---

## Section 1: Zoom-Out Lens (`egm-zoom-out`)

Findings below come from this lens. Where the inventive-catalyst lens found the same issue, the item is marked "also found by catalyst" and is fully described once in Section 3 or in the consolidated list in Section 4.

## Blocker

### B1. The design contradicts the project's governing documents and overclaims "no person in the loop" - Severity: Blocker

- **Reviewer Lens:** `egm-zoom-out` (also found by `egm-inventive-catalyst`, contradictions 5 and 6)
- **Affected Scope:** Overview (line 11), CUJ 1, Alternative C (lines 301-305), W0-2 (line 679), M0-4 (lines 719-720)
- **Discrepancy Description:**
  - **Overclaim.** The Overview promises merging "without a person in the loop". Elsewhere the design requires many human acts: signing the delegation and every scope change or ladder promotion, writing the verifier digest to the control repository (M2-2), nine milestone admission gates, a 7-day check-in, the npm `latest` release (M5-4), pinning the distribution (M0-11, M2-4) and closing OpenRig issues (M0-9). Alternative C then says the end state is "unconditional agent merge, including `factory-core` and release". A buyer or auditor will read the Overview sentence literally.
  - **Governing documents not fully reconciled.**
    - W0-2 cites `AGENTS.md` "Review and safety, lines 62-64". Those lines are "Branch discipline". The human-review rule is at `AGENTS.md:69`.
    - W0-2 and M0-4 do not list `docs/guiding-principles.md:59` ("MUST: Require multi-agent consensus, rigorous exploratory QA, and formal human security sign-off for `high-assurance` tasks"). The catalyst adds that line 43 (self-review cannot satisfy the high-assurance gate) is also not named.
    - The "Two-Plane Separation" section (`AGENTS.md:90-93`) says rigs are barred from granting self-approvals and that merge verbs belong to the steering plane. The design changes this relationship but lists no edit to that section.
    - `AGENTS.md` lines 81-83 deny code writes to steering identities. That collides with the steward opening revert PRs (see M16).
    - Principle 4 says humans keep "meaningful control at decision boundaries". The design never says how a signed advance delegation satisfies it.
  - G1's own CI rule would then force these lines into `implemented` rows that contradict the plan.
- **Rationale & Recommendation:** Replace "without a person in the loop" with a precise statement such as "no per-change human action", and keep the list of recurring human acts in the same section. Add a table to W0-2 or the Technical Plan. For each governing sentence in `AGENTS.md`, `guiding-principles.md` and `person-gates.md` that the design overrides, give the file, the line and the replacement rule. Correct the W0-2 line numbers. Finish this before any factory-core work is admitted, because these documents bind the agents that will build it.

(Blocker 2, the credentialed verifier, appears in Section 3 as F1 and in Section 4.)

## Major

### M1. Scope far exceeds the stated month-6 claim - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Overview (lines 11-19), Goals G1-G8, Components table, the M1-M5 tables
- **Discrepancy Description:** The narrow month-6 claim needs five things: the stack works end to end, it is in use, a conformance report, a case study and a verifier. For one maintainer over 26 weeks, the plan also carries a launcher, a substrate port with two implementations, a signing seam with a trust policy, an optional RFC 3161 timestamp seam, an intake seam, a time-lock, a circuit breaker, a canon ratchet, a tester lane, an evidence envelope, a GxP projection and a mock-GxP repository, a learning pipeline (M4-3), a website, manuals, a demo recording, the OpenRig trim and a repository-wide wording rename. Weakly justified items:
  - **Learning pipeline (M4-3, line 191, lines 863-867).** It serves no goal G1-G8 and is not in the month-6 claim. It adds a sanitizer, a write-scope guard, a PR-opening helper, a new seat and three CLI verbs. The design says external optimizers wait past month 6 and lessons are "never applied automatically".
  - **Second substrate (M2-7).** The WSL2 stack is described as "the most glue to maintain" (Alternative U). It exists mainly so the word "pluggable" can be used, and the design says it will not use the word until then.
  - **Signing seam.** Two operations, one implementation, and "pluggable" is not claimed for it either.
  - **RFC 3161 timestamps (W0-17, M3-3).** Called "optional" but comes with a spike, a library module, a script and a nightly job. (The catalyst notes G5's back-dating claim actually depends on it, see Section 3 contradiction 4.)
  - **Null `substrate` and `evaluator` envelope blocks (line 217).** Speculative schema.
  - **Surface growth.** About 14 new CLI verbs and 6 schemas with "no count budget", while Problem 4 says a newcomer already reads about 1,150 lines of policy.
- **Rationale & Recommendation:** Tier the work against the month-6 claim. Tier 1 (must have): claims ledger, containment, verifier, review attestation, merge path, signed evidence and `evidence verify`. Tier 2: GxP projection and case study. Tier 3 (stretch or cut): learning pipeline, second substrate, RFC 3161, tester lane, website beyond corrections, demo recording. Move "If time slips" (line 572) up into the Goals as a priority order. Remove unused envelope blocks until needed, since additive schema change is already the migration policy (line 571).

### M2. An implementation plan, decision history and process minutiae are embedded in the design - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Lines 265-283 (Deviations), 285-545 (Alternatives A to AQ), 597-915 (Detailed Implementation Plan), Key shapes (lines 616-668)
- **Discrepancy Description:**
  - The plan is about 320 lines of per-file tables with line numbers the document admits "will drift" (line 599). Line 23 also says the lists for M1 onward "depend on what week 0 and M0 find", so detail is specified before the facts exist. The pseudocode for the substrate contract (lines 636-646) and the claims-ledger row shape (lines 627-634) are interface sketches that belong in the ADRs and schemas the plan creates.
  - There are 43 alternatives. AG to AQ cover process choices such as spike timing, surface-budget wording, milestone tags and screencasts. Several are "Rejected by author" with no technical reason.
  - "Deviations from the brief" has 17 items, including "item dropped" notes. It is the history of a document the reader does not have.
- **Rationale & Recommendation:** Keep the design to problem, goals, journeys, architecture, contracts and about 6-8 real architectural alternatives. Move the implementation breakdown to the program and milestone goals (W0-19 already creates them) or to issues written at milestone start. Keep only milestone exit criteria. Move process alternatives and the deviations list to `concepts_brief_history.md`.

### M3. The brief is cited as the source but is not available to a fresh reader, and the citations disagree - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Line 21 versus line 578, and throughout (D3, D5, D12, D17, D18, D21, D26, "C3", "D-A1", "Step 6", "the council", "reviewers")
- **Discrepancy Description:** Line 21 says decisions "D1-D22"; line 578 says "D1-D26". The document leans on D-numbers, "the council" and "the reviewers" without defining them, and `concepts_brief.md` is untracked in git. A newcomer cannot tell which decisions bind or why, although the Overview promises a self-contained read.
- **Rationale & Recommendation:** Define each D-number in one line where it first appears, or inline the decision. Fix the D-range. Commit the brief or stop citing it as the source of truth. Define or remove "council", "reviewers" and "Step 6".

### M4. Week 0 is not a week, and it builds throwaway code - Severity: Major

- **Reviewer Lens:** `egm-zoom-out` (catalyst F16 agrees the item count is excessive)
- **Affected Scope:** Known risks (line 259), W0-1 to W0-19 (lines 674-703), Alternatives AG to AJ
- **Discrepancy Description:** Week 0 holds ten ADRs, a setup guide, a box checker, two new CLI groups, a run cap, a guarded runner, a gate script, a baseline document, three to four spikes, the vendor-terms review and nine goal files. The document admits "week 0 is heavier".
  - `guarded-run.mjs` and its test are created and then deleted in M1-4, along with a coordinator state module, a run-cap module and the `box check` and `box gate` verbs.
  - ADRs 017-026 are written before the spikes that determine them (ADR 020 needs the `sbx` spike; ADR 022 and 023 need the digest and signing spike), so they will be rewritten.
  - The run cap (W0-14, `.agentflow/run-cap.json`) is a second budget mechanism next to M2-5's `daily` window in `lib/config/quota-policy.mjs` and `delivery-policy.mjs`.
- **Rationale & Recommendation:** Keep week 0 to decision-affecting work: the spikes, the containment check and the vendor-terms review. Write each ADR with the milestone that implements it, after its spike. Build the run cap once inside the existing quota code. Consider whether `sbx` plus a manual kill and a documented cap is enough for an attended week 0; Alternative AG rejected this without weighing the throwaway code. Catalyst alternative: split into 0a (containment floor and `sbx` spike, which alone gates unattended work) and 0b (ADRs, baseline, vendor terms).

### M5. The unattended-use and terms-of-service risk has no concrete fallback - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Open Questions (line 72), Known risks (line 256), W0-18 (line 701), Overview (line 16)
- **Discrepancy Description:** The execution plane runs around the clock on the author's consumer subscription logins, and the design records that this is unverified. Cross-vendor review needs both vendors. If either is attended-only, G3 and G4 fail as written. The design says a no-go "reopens D3" and "the finding names the fallback", but names none. The product already supports Codex, Grok and Pi (Non-Goals line 56).
- **Rationale & Recommendation:** Name the fallback in the design (for example an API-billed second family, or Codex as the second family). State which goals survive in attended-only mode. Resolve the check before any M1 launcher work, not in parallel with it.

### M6. Architecture-blocking questions are left open when an obvious default exists - Severity: Major

- **Reviewer Lens:** `egm-zoom-out` (catalyst contradiction 3 adds the offline angle)
- **Affected Scope:** Open Questions (lines 73-77), G5, G6, CUJ 5, CUJ 6, X-2, line 588
- **Discrepancy Description:** Artifact attestations on private repositories need GitHub Enterprise Cloud (line 73). G5, G6 and CUJ 6 depend on `calibration-logbook`, a repository the author creates, and the simple default is to make it public. G5 needs a clean machine with the `gh` CLI (M3-3 shells out to `gh attestation verify`), while the library verifier that avoids `gh` is deferred (line 588).
- **Rationale & Recommendation:** Decide that `calibration-logbook` and the evidence bundles are public in the reference stack. State that `gh` is a prerequisite of `evidence verify` in G5 and CUJ 5. See also F-offline below for the signed-human-act verification gap.

### M7. Layering inversion and a hidden refactor in the verifier path - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M1-4 (line 763), M2-2 (line 800), M1-12 (line 786)
- **Discrepancy Description:** `lib/verification/declared-scope.mjs` is to import `matchOwnedPath` from `scripts/validate-path-ownership.mjs:25`, making `lib/` depend on `scripts/`. Separately, `verify-pr.mjs` is meant to "import the validators as functions", but M1-12 shows `validate-pr-manifest.mjs` runs at import time. About 37 `scripts/validate-*.mjs` files use `process.exit` or `process.argv`, so the refactor is likely much larger than one plan line.
- **Rationale & Recommendation:** Move `matchOwnedPath` to a `lib/` module and have the script import it. Count the validators the pinned verifier needs and budget the pure-function refactor explicitly.

### M8. The repository-wide "fencing" rename is high churn for a wording problem - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M0-10 (lines 739-743), Alternative AB (lines 451-455), Deviation 12
- **Discrepancy Description:** The retracted claim is the unwired `lease-fencing` module. The plan renames the live mechanisms across about 25 files (docs, skill mirrors, `scripts/steer.mjs`, CULTURE files, tests), adds a wording rule to the ledger validator, and still keeps the `fencingToken` field name.
- **Rationale & Recommendation:** Retract only the false claim and keep the live mechanism names (Alternative AB). If the rename is wanted, do it as separate cleanup outside the month-6 path.

### M9. The OpenRig trim is a large unrelated program inside this one - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** W0-13, M0-9 (lines 693, 731-738), M2b-2 (line 828), Alternative Y
- **Discrepancy Description:** It deletes about 15,000 lines (an 18,438-line adapter cut to about 1,800) and rewrites the `lib/bridge` layer, several CLI verbs, manifests and ADR 016, across 8 table rows. The adapter is "optional and outside the reference stack" (Alternative Y), and the trim depends on a W0 capability review. It competes for the one maintainer's time in the most critical milestone.
- **Rationale & Recommendation:** Take the trim off the month-6 critical path and run it as a separate track. In M0, keep only the ledger rows and retractions the claims check needs.

### M10. The coordinator is both a model session and a deterministic program, and it overlaps existing code - Severity: Major

- **Reviewer Lens:** `egm-zoom-out` (also found by catalyst as F3 and contradiction 1; see consolidated item C3 in Section 4)
- **Affected Scope:** Components row "Coordinator" (line 179), Known risks (line 263), M1-8 and M1-10 (lines 772-779), W0-14
- **Discrepancy Description:** The coordinator is described as "a stateless scheduled session" that is the `steer.lead` seat, yet it is also `scripts/coordinator.mjs` with `tick`, a state file, an in-flight cap, an admission test and a poller. Polling, claiming, capping and admitting are deterministic. A model in that loop adds cost, quota use and exposure to hostile issues. Names collide: `lib/cockpit-coordinator.mjs` exists, and `scripts/actuate-readiness.mjs` plus the hourly `actuate-readiness.yml` cron is the existing scheduled actuator. The design says it "extends" these but creates a separate `coordinator` group and `intake-poll.mjs`.
- **Rationale & Recommendation:** Make the coordinator a deterministic script and keep the model only where judgement is needed. State how it relates to `actuate-readiness.mjs` (extend or replace) and to `cockpit-coordinator.mjs`.

## Nit

- **Z-N1. Ledger rows keyed by file and line (line 627, M0-3).** Every doc edit shifts lines and breaks "the quote still exists at its source". Key rows by quote or heading anchor.
- **Z-N2. Directory sprawl.** The plan adds `lib/evidence/`, `lib/signing/`, `lib/substrate/`, `lib/gxp/` and `lib/learning/` beside `lib/evidence-contracts.mjs` and `lib/verification/`. Check that `lib/evidence/verify.mjs` (M3-4) does not duplicate `lib/verification/` modules.
- **Z-N3. Duplicate or confusing item IDs.** W0-1, W0-12, W0-14, W0-19, M0-3, M0-6, M0-9, M0-10 and M2b-2 each appear on several rows. M5 items run M5-1, M5-2, M5-3, M5-6, M5-4 with no M5-5. The Verification Plan switches from `-` to `*` bullets at line 907.
- **Z-N4. Missing timeline.** "26 weeks" appears but no milestone has a duration, and exit criteria are scattered across the Verification Plan. Add one table of milestone, goal, duration and exit criterion.
- **Z-N5. Unverified statements stated as design input.** Alternative P ("I believe ... (unverified)"), T ("unconfirmed") and V ("my background knowledge, unchecked"). Keep the conclusion in the design and move the research notes to the context file.
- **Z-N6. Status line says only "Draft".** The Detailed Implementation Plan header should flag that file lists are provisional.
- **Z-N7. Time-lock default.** CUJ 7 says "24 hours, to calibrate" with no calibration criteria. Define what measurement changes it.

## Reuse opportunities to confirm before committing (zoom-out lens)

- Budget and run caps: reuse `lib/config/quota-policy.mjs` and `lib/core/delivery-policy.mjs` rather than adding `run-cap.mjs`.
- Scheduling: extend `scripts/actuate-readiness.mjs` and its workflow rather than adding a new coordinator and poller.
- Path matching: reuse `matchOwnedPath`, but relocate it to `lib/`.
- Claim logic: changing `lib/core/source-claim.mjs` for deterministic IDs is good reuse. Keep it.
- Chained evidence: retiring `role-flow-span` in favour of `run-state.mjs` is the right call.

---

## Section 2: Cross-Lens Blocker (found independently by both reviewers)

### B2. The pinned verifier executes candidate-supplied code while holding secrets - Severity: Blocker

- **Reviewer Lens:** `egm-inventive-catalyst` (F1, rated Blocker) and `egm-zoom-out` (M1, rated Major). Merged here.
- **Affected Scope:** Trust boundaries table (lines 221-228), Components row "Pinned verifier" (line 182), Open Questions (line 74), M2-1 and M2-2 (lines 798-802), G4
- **Discrepancy Description:** The table says the verifier "cannot run workflow code a PR supplied" and holds the control-repository read credential and attestation permission. Yet its own checks run PR-controlled content: the holdout runner executes holdouts against the candidate, the no-op check runs the PR's new tests on the base tree, and the post-merge run executes the full suite and the red-team canon against agent-written code. A `pull_request_target` job that runs PR content with a read credential is the classic "pwn request" shape. Candidate code can read the holdouts or the credential and print or exfiltrate them; on the public AgentFlow repository CI logs are public. G4's negative test only proves the builder token cannot read holdouts, and misses this route. Open Questions treats `pull_request_target` versus an org-level required workflow as a plan-tier question, when it is really a job-separation question.
- **Rationale & Recommendation:** State the separation at architecture level. Job A checks out and runs candidate code with no secrets and no network, and emits only artifacts and digests. Job B holds the credential, never executes candidate code except in a network-less sandbox, mounts the holdouts there and emits only pass/fail bits and counts. The attestation job runs apart from any job that executes merged code. Add a red-team canon case where candidate code tries to read the holdout directory or the verifier token, or exfiltrate a holdout through CI. Cost: two jobs, artifact handoff, slower verification. Pass/fail bits still leak, so bound retries per issue.

---

## Section 3: Inventive-Catalyst Lens (`egm-inventive-catalyst`)

False compromise was detected. The strongest pattern is that the design puts enforcement in an agent's behavior, or in "the author does it", where a platform-enforced or deterministic mechanism would remove the trade-off. It also treats four things as unavoidable: bad changes merge and are then reverted, the author is the bottleneck on trust-bearing files, a weaker fallback substrate is acceptable, and the steward must be a model session.

The design's real contradiction is "agents may modify everything inside the repository" against "no agent may influence the judge". The design resolves it well with the pinned verifier, the control repo, "N-1 governs N" and the canon ratchet. The residual leaks are where the judge's data or enforcement still travels through an agent-influenced channel: CI jobs that run candidate code beside credentials (B2), a steward session that holds the token (M13, M10), and mutable issue text (M21).

## 3.1 Contradictions found

These are conflicts inside the document, or between the document and the repository.

1. **Non-Goals line 61 versus Deviation 4 (line 270) and Components (lines 179, 185).** The non-goal says there are no unattended runs on Windows native. The coordinator and steward are model sessions that run unattended on the Windows host, outside any sandbox, and the steward holds the merge token. G2 and the red-team suite cover only the builder, reviewer and tester sandboxes.
2. **Overview line 15 ("never reachable by an agent") versus Trust boundaries (lines 221-228).** Intent-plane artifacts (App keys, subscription logins and possibly the signing key) live on the same host as the model-session coordinator and steward. Hardware-backed signing keys are a week-0 "act" (line 254), but `box check` (W0-12) does not verify a hardware key.
3. **G5 and CUJ5 (offline verification) versus D-A1 and M1-13 (lines 213, 787).** A signed human act is "a commit or tag whose verification GitHub reports", which is an online API result. W0-17 (line 700) only asks whether it can be verified offline. Alternative L (line 359) relegates SSH-signature verification to a "second implementation", but offline verification of human acts needs it first.
4. **G5 "back-dated timestamp is detected" versus the trust policy and Signing seam (lines 213, 652).** The RFC 3161 timestamp is "optional" and "a separate optional seam", yet an author-signed commit carries a time the signer chooses. Back-dating of human acts is not detectable without that seam.
5. **`guiding-principles.md` lines 43 and 59 versus Alternative C and G3.** Line 59 requires formal human security sign-off for high-assurance tasks, and line 43 says self-review cannot satisfy that gate. W0-2 amends only `agent-workflow.md`, ADR 016 section 9 and `AGENTS.md`. M0-4 rewrites lines 42-47 but does not name line 59 or the line-43 rule. (Same issue as B1.)
6. **W0-2 cites `AGENTS.md` "Review and safety, lines 62-64".** Those lines are Branch discipline; Review and safety is lines 66-71. `AGENTS.md` lines 81-83 also deny code writes to steering identities, which collides with M16. (Same issue as B1.)
7. **CUJ4 "in-flight items finish or checkpoint" versus Alternative D and M0-2 (lines 103, 311, 712).** WIP checkpoint branches and handover are retracted. The launcher pushes only after collect, scope check and sandbox destroy, so no checkpoint mechanism remains.
8. **Clerical conflicts.** Line 21 says "D1-D22" and line 578 says "D1-D26". The plan opening says "Paths were checked" for every milestone (line 599), which conflicts with line 23 (M1 onward is re-verified later). M5 numbering has no M5-5.
9. **Local paths in a committable file.** X-3 and other places embed `a local user path`, the author's name and `~/.local/bin/rig`, which conflicts with `guiding-principles.md` section 3 rule 4 (never leak local state).

## 3.2 Findings and suggested transforms

Each finding names the false compromise, the proposed inventive transform and the secondary liabilities. Finding labels F1-F19 are the catalyst's own. Where a finding is consolidated into an item in Section 4, the Section 4 label is given.

### F1. Holdouts run in a credentialed CI job against candidate code

Merged into Blocker B2 above. Transform: Segmentation plus Extraction.

### F2. Time-lock, pause flag and delegation checks are enforced by the steward's behavior - Major (Section 4: M13)

- **Scope:** Merge, verification and recovery (lines 230-236), Steward component (line 185), CUJ7.
- **False compromise:** "Cannot override the evaluator" is claimed, but the steward is a model session holding the merge App token and reading hostile issue and PR text. The time-lock, pause state and delegation expiry live in local steward code (`steering-merge-policy.mjs`, M2b-2/3), not in a required check. A prompt-injected steward can merge `factory-core` early.
- **Transform (Extraction and Inversion):** Make `time-lock`, `pause.json`, delegation-in-force and "L-level covers class" required checks from the pinned verifier. The check fails until `now >= attested_at + window`, using a signed timestamp, and a signed veto tag flips it to fail. Merge-queue rulesets enforce them even if the steward misbehaves. The steward reduces to a deterministic actuator that merges when required checks are green.
- **Liabilities:** Re-evaluation needs a scheduled workflow with coarse cron granularity; another verifier surface to pin; a signed-tag veto UX for the author.

### F3. The steward and coordinator are model sessions with the merge and builder tokens - Major (Section 4: M10, M13)

- **Scope:** Components (lines 179, 185), Known risks (line 263), Trust boundaries, Non-Goals line 61.
- **False compromise:** The design accepts "a hostile issue can only waste runs" as the price of an agentic coordinator, but a model that processes untrusted text also holds secrets on an uncontained host.
- **Transform (Intermediary plus Segmentation):** The coordinator and steward become deterministic code. A model is consulted only for hold/escalate advice and holds no token. A small host-side merge actuator takes a structured `{pr, headSha}` request and checks evaluator output, delegation and pause itself. Any model session for coordination runs inside `sbx` with no tokens. Alternatively, use GitHub native auto-merge on the queue with the verifier as the only gate.
- **Liabilities:** One more component to build and pin; less judgment flexibility; the actuator becomes a high-value target needing its own tests.

### F4. Time-lock versus revert latency, and the revert authoring path - Major (Section 4: M16)

- **Scope:** CUJ2, CUJ7, M2b-4, `AGENTS.md` lines 81-83.
- **False compromise:** The post-merge net (merge, verify, revert) routes the revert through normal merge conditions, so a bad `factory-core` change sits in main for the 24-hour time-lock plus review. A steering identity "may not author commits" (`AGENTS.md` 81-83), yet the steward opens the revert PR. Reverting commit N while N+1 onward build on it is unspecified.
- **Transform (Beforehand Cushioning plus Blessing in Disguise):** Define a mechanically verifiable "pure inverse revert" class, where the verifier proves the tree equals the parent tree of a verified merge. That class is exempt from time-lock and new review and carries its own App identity. On revert conflict, fail closed: pause and alert.
- **Liabilities:** A new bypass class to red-team; a revert-chain policy; a distinct "reverter" App and seat in `seats.json`.

### F5. The merge-queue pre-merge gate omits the canon and full suite - Major (Section 4: M17)

- **Scope:** G3, CUJ2, Merge section (line 234).
- **False compromise:** The full suite and canon run only after merge, and the canon runs pre-merge only on `factory-core`. "Bad change merged, then reverted" becomes the designed path.
- **Transform (Preliminary Action plus Segmentation):** Pre-merge runs required checks plus a fast tier in the queue, chosen by risk class. Cache a nightly canon baseline so the queue run is incremental. Keep post-merge as a second net and as the drill target.
- **Liabilities:** Queue latency and hosted-minute cost on private repos; cache-validity logic; test-selection errors can miss regressions.

### F6. Failure classification (infrastructure versus change) is unspecified and exploitable - Major (Section 4: M18)

- **Scope:** CUJ2, Known risks (line 257), M2b-4 `circuit-breaker`.
- **False compromise:** "Failures caused by an outage or quota exhaustion are classified as infrastructure" is treated as a solved lookup. A change that induces hangs, quota burn or 429s could be classed as infrastructure and never trip the breaker.
- **Transform (Self-Service plus Blessing in Disguise):** Use a control run: re-run the suite on the last known-good commit in parallel. If it also fails, it is infrastructure; if it passes, count it against the change. Classify as infrastructure only on positive evidence (provider status, an explicit 429 signature).
- **Liabilities:** Doubled CI cost on failure; the control run can flake; a "counts against the change" default risks false reverts, so tune with a retry budget.

### F7. Holdout and canon authorship is unspecified, and the author is the bottleneck - Major (Section 4: M19)

- **Scope:** Control repository (line 177), G4, M2-1, Alternative X.
- **False compromise:** The control repo is "writable only by the author", yet every L2 change needs fresh holdouts the builder cannot read. The design never says who writes them. Taken literally, the author's hours become the throughput limit that Alternative X rejected.
- **Transform (Segmentation):** Split the control repo into `control-trust` (author-only: delegation, trust policy, path classes, verifier digest, pause) and `control-fixtures` (holdouts, canon, seeded defects). A separate test-author App, from a different lane than the builder, gets append-only write to `control-fixtures` through path-scoped rulesets. The canon ratchets and only grows. Cross-family review applies to holdout authorship.
- **Liabilities:** A fourth App and more attack surface; collusion or leakage if author and builder share a vendor; holdout quality now depends on a model; repo-split overhead.

### F8. The Agy login sits inside the sandbox, and allowlisted vendor hosts are an exfiltration channel - Major (Section 4: M20)

- **Scope:** Trust boundaries (line 223), G2, Open Questions (line 72).
- **False compromise:** Claude's login is brokered by `sbx` but Agy's is "open". G2's red-team list covers `~/.ssh`, `gh` config, ambient tokens, off-allowlist hosts and writes outside the worktree, but not extraction of the vendor OAuth token or its use through allowlisted vendor hosts. A stolen refresh token outlives the destroyed sandbox.
- **Transform (Intermediary, or Cheap Dispensables):** Broker both vendors' credentials through a host-side proxy that injects the token and never exposes it. Or use a dedicated, narrowly scoped login per lane with revocation drills. Add red-team cases for reading the token and exfiltrating through an allowed host.
- **Liabilities:** Vendor terms may forbid a brokered or secondary login (ties to M5); proxy maintenance; `sbx` capability limits.

### F9. The conformance claim requires a weaker fallback to pass the same suite - Major (Section 4: M14)

- **Scope:** G2, Alternatives P, Q and U (lines 379-413), Deviation 5, M2-7.
- **False compromise:** P and Q are rejected for shared kernels and editable in-distro egress, but U (the WSL2 assembled stack) has the same weaknesses, then becomes the second implementation that must pass the same suite for "pluggable". Either it fails, or the suite is softened.
- **Transform (Dynamics):** The suite verifies that declared guarantees are true. Each adapter declares a guarantee tier (the contract already has this). Admission by risk class requires a minimum tier, for example WSL2 only for L1. A lower-tier adapter never passes by weakening cases.
- **Liabilities:** A tier matrix to maintain; a reduced-autonomy fallback (if `sbx` fails the spike, less dark running, not equal dark running); honest wording in the conformance report.

### F10. The verifier-digest pin is human-only, but L3 and "release" are described as agent-merged - Major (Section 4: M15)

- **Scope:** G3, Alternative C, M2-2, Rollout "Releases" (line 570).
- **False compromise:** The text says the end state is unconditional agent merge "including `factory-core` and release". Writing the digest to the control repo is a human act and `latest` is the author's release act. In steady state the factory stalls on a human step for every verifier change, or the intent plane becomes agent-reachable.
- **Transform (Intermediary):** A promoter identity may update only `verifier.digest`, and only when the new digest has CI provenance, passed the time-lock and cross-family review, and was verified by the current pinned verifier ("N-1 governs N"). Alternatively, state that factory-core changes always wait on the author's digest act and remove "unconditional" from G3 and Alternative C.
- **Liabilities:** A promoter widens the trust root; the signed delegation scope must cover it; an added App and drill.

### F11. The "implemented" ledger bar checks reachability, not effect - Major (Section 4: M22)

- **Scope:** G1, M0-3 `lib/claims-ledger.mjs` (line 714).
- **False compromise:** The design diagnoses "documented but unwired" as the root failure, then fixes it with "an `implemented` row names a non-test importer and a test". A caller that enforces nothing passes. Only "supports X" needs a conformance run (line 45), and the claim row is written by the same agent in the same PR.
- **Transform (Beforehand Cushioning):** Require each `implemented` MUST/INVARIANT row to link a negative or behavioral test id (a tamper test for "tamper-evident", a kill-timing test for the supervisor, a deadline test for the sweeper). The pinned verifier runs those linked cases, and the ledger rows are covered by the canon-ratchet rule.
- **Liabilities:** More tests, so slower M0; ledger churn; a rule for what counts as behavioral.

### F12. Watchdog and alerting are passive and co-located with the thing they monitor - Major (Section 4: M23)

- **Scope:** Open Questions (line 77), M1-14 (line 791), CUJ4, Known risks.
- **False compromise:** The watchdog "writes `.agentflow/alerts.json` and exits non-zero" on the host it must detect failing. A dead host kills its own alert, and the alert channel is left unchosen.
- **Transform (Inversion plus Self-Service):** The coordinator pushes a heartbeat outward, to a non-control ref or repo (so "control repo is author-only" holds). A scheduled hosted workflow opens a GitHub issue or notification when the heartbeat is stale, paired with the existing dead-man pause. Make the alert channel a `box check` item.
- **Liabilities:** Scheduled workflows can be delayed or disabled on inactive public repos; a heartbeat credential; alert fatigue.

### F13. Scope time-of-check/time-of-use: declared scope is read from a mutable issue - Major (Section 4: M21)

- **Scope:** Intake seam (line 209), "How a unit of work flows" steps 2, 7 and 8, M1-4 and M1-12.
- **False compromise:** The adapter "re-reads the item" (Contracts, line 209). The launcher and the pinned verifier each re-read the issue's `## Declared scope` at different times, so issue edits after the claim can widen scope, and the issue author (any collaborator on a public repo) chooses the scope.
- **Transform (Preliminary Action):** Snapshot the scope into the append-only claim record at claim time, keyed by a content digest. The launcher and verifier check against that digest. A later issue edit makes the claim stale and forces a re-claim. Path-class admission also uses the actual changed paths from the diff, not only declared paths.
- **Liabilities:** A re-claim flow and duplicate-work handling; a larger claim log.

### F14. Pause and resume of in-flight runs is undefined once checkpoints are retracted - Major (Section 4: M24)

- **Scope:** CUJ4, G7, Alternative D.
- **False compromise:** G7 requires idempotent mid-run pause and resume, but sandboxes are disposable and partial work has no durable form (see contradiction 7).
- **Transform (Cheap Dispensables):** Declare that a paused in-flight run is discarded and resume restarts from the claim at the base commit, with a deterministic branch name so pushes are idempotent. If partial work must survive, push to a quarantined ref (`refs/factory/wip/<claim>`) that never triggers CI, and state this as a deliberate narrow exception to the WIP retraction.
- **Liabilities:** Discarded runs waste quota; the quarantined ref reintroduces part of what was retracted and needs a ledger note.

### F15. Configuration authority fragmentation versus `modular-architecture.md` - Major (Section 4: M25)

- **Scope:** Control repository layout (lines 655-666), M2-2 (path classes), new `lib/substrate`, `lib/signing`, `lib/evidence`, `lib/gxp`, `lib/learning`.
- **False compromise:** `modular-architecture.md` says canonical configuration has one owner, enforced by `validate:authority`, and that execution-target and provider facets belong to the provider layer. `guiding-principles.md` line 123 forbids parallel configuration mechanisms. The design adds a third policy authority (the control repo) beside `manifests/path-ownership.json` and the two config files, a substrate registry parallel to `ProviderBinding` and execution targets, and new local state files (`coordinator.json`, `run-cap.json`, `egress-allowlist.json`). None of this is reconciled with `validate:authority`.
- **Transform (Extraction):** Declare the control repo the sole owner of trust-bearing policy (classes, delegation, trust, canon, digest pin), with `agent-workflow.config.json` holding only a reference to an expected control-repo commit. Extend `validate:authority` to cover it. Model the substrate as a provider facet under `ProviderBinding`, or write the ADR explaining why not.
- **Liabilities:** A migration step for the in-repo path-ownership manifest; indirection for newcomers; the authority validator must tolerate an unreachable control repo.

### F16. The week-0 floor is not time-boxed and its item count is large - Nit (merged into M4)

- Transform (Segmentation): split into 0a (containment floor and `sbx` spike, gating unattended work) and 0b (ADRs, baseline, vendor terms). Liabilities: two gates to track, and ADRs may drift if deferred.

### F17. The soak criterion proves little - Nit (Section 4: N8)

- **Scope:** G3.
- "Zero containment escapes in about 20 issues" has no statistical power and mostly shows the red-team suite did its job. Reword G3 and the ladder promotion rule to cite red-team results plus the soak as supporting evidence, not as proof. Liability: the promotion criterion becomes less crisp.

### F18. Pause state has two authorities and an unspecified failure mode - Nit (Section 4: N9)

- **Scope:** W0-14 and M1-8 (lines 694, 772), Coordinator states (line 240).
- There is a local `coordinator.json` and a control-repo `pause.json`, and the coordinator is also called "stateless". State fail-closed: the strictest of the two wins, and an unreachable control repo means pause. Liability: outages stall work.

### F19. Clerical - Nit (Section 4: N3, N10)

- Fix the decision range and the line references, add the missing M5-5 numbering, and replace local paths with placeholders.

---

## Section 4: Consolidated Prioritized Findings (Blockers -> Major -> Nits)

Overlapping findings are merged. The "Lens" column shows which reviewer found each. Sections 1 to 3 hold the full detail, so this section is the checklist.

## Blockers (2)

| ID  | Issue                                                                                                                                                          | Lens                                 | Detail    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------- |
| B1  | Design contradicts governing documents (`guiding-principles.md:43,59`, `AGENTS.md:69,81-83,90-93`); W0-2 cites wrong lines; "no person in the loop" overclaims | zoom-out, catalyst                   | Section 1 |
| B2  | Pinned verifier runs candidate code while holding the control-repo credential (pwn-request shape)                                                              | catalyst (Blocker), zoom-out (Major) | Section 2 |

## Major (23)

| ID  | Issue                                                                                                                                                                                                                   | Lens               | Detail                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| M1  | Scope far exceeds the month-6 claim; tier the work                                                                                                                                                                      | zoom-out           | Section 1                                  |
| M2  | Implementation plan, 43 alternatives and deviation history embedded in the design                                                                                                                                       | zoom-out           | Section 1                                  |
| M3  | Brief not available to a reader; D-range 22 versus 26; undefined terms                                                                                                                                                  | zoom-out, catalyst | Section 1                                  |
| M4  | Week 0 overloaded, builds throwaway code, ADRs precede spikes, duplicate budget mechanism                                                                                                                               | zoom-out, catalyst | Section 1                                  |
| M5  | Terms-of-service and unattended-use risk has no named fallback                                                                                                                                                          | zoom-out           | Section 1                                  |
| M6  | Open questions with obvious defaults (public logbook; `gh` prerequisite); offline verification of signed human acts needs SSH-signature verification first and G5 back-dating needs RFC 3161                            | zoom-out, catalyst | Section 1, 3.1 items 3 and 4               |
| M7  | `lib/` imports from `scripts/`; validators are not importable functions (about 37 files)                                                                                                                                | zoom-out           | Section 1                                  |
| M8  | Repository-wide "fencing" rename is high churn for a wording fix                                                                                                                                                        | zoom-out           | Section 1                                  |
| M9  | OpenRig trim (about 15,000 lines) is an unrelated program on the critical path                                                                                                                                          | zoom-out           | Section 1                                  |
| M10 | Coordinator and steward are model sessions with tokens on an uncontained host; coordinator also duplicates `actuate-readiness.mjs` and `cockpit-coordinator.mjs`; conflicts with Non-Goals line 61 and Overview line 15 | zoom-out, catalyst | Section 1 (M10), 3.2 F3, 3.1 items 1 and 2 |
| M13 | Time-lock, pause and delegation enforced by steward behavior, not by required checks                                                                                                                                    | catalyst           | 3.2 F2                                     |
| M14 | Fallback substrate (WSL2) cannot pass the same suite without softening it; use guarantee tiers                                                                                                                          | catalyst           | 3.2 F9                                     |
| M15 | Verifier-digest pin and release are human acts, but the end state is described as unconditional agent merge                                                                                                             | catalyst           | 3.2 F10                                    |
| M16 | Revert path blocked by time-lock and by steering identities not authoring commits                                                                                                                                       | catalyst           | 3.2 F4                                     |
| M17 | Merge-queue gate omits canon and full suite; "merge then revert" is the designed path                                                                                                                                   | catalyst           | 3.2 F5                                     |
| M18 | Infrastructure-versus-change failure classification is exploitable                                                                                                                                                      | catalyst           | 3.2 F6                                     |
| M19 | Nobody is named to author holdouts and canon; the author becomes the bottleneck                                                                                                                                         | catalyst           | 3.2 F7                                     |
| M20 | Agy vendor login is inside the sandbox; allowlisted vendor hosts are an exfiltration channel                                                                                                                            | catalyst           | 3.2 F8                                     |
| M21 | Declared scope read from a mutable issue (time-of-check/time-of-use)                                                                                                                                                    | catalyst           | 3.2 F13                                    |
| M22 | "Implemented" ledger bar checks reachability, not effect                                                                                                                                                                | catalyst           | 3.2 F11                                    |
| M23 | Watchdog and alerts run on the host they monitor; alert channel unchosen                                                                                                                                                | catalyst           | 3.2 F12                                    |
| M24 | Pause and resume of in-flight runs undefined after checkpoint retraction (CUJ4 versus Alternative D)                                                                                                                    | catalyst           | 3.2 F14, 3.1 item 7                        |
| M25 | Configuration authority fragmentation versus `modular-architecture.md` and `validate:authority`                                                                                                                         | catalyst           | 3.2 F15                                    |

(IDs M11 and M12 are intentionally unused. The two lens-specific numbering schemes were merged and the gap was kept so cross-references in Sections 1 to 3 stay stable.)

## Nit (10)

| ID  | Issue                                                                                                                           | Lens               |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| N1  | Ledger rows keyed by file and line; key by quote or heading                                                                     | zoom-out           |
| N2  | Directory sprawl in `lib/`; possible overlap of `lib/evidence/verify.mjs` with `lib/verification/`                              | zoom-out           |
| N3  | Clerical: duplicate item IDs, M5 numbering gap, bullet style switch at line 907, "Paths were checked" (line 599) versus line 23 | zoom-out, catalyst |
| N4  | No timeline table of milestone, duration and exit criterion                                                                     | zoom-out           |
| N5  | Unverified research statements (Alternatives P, T, V) stated as design input                                                    | zoom-out           |
| N6  | Status says only "Draft"; mark file lists as provisional                                                                        | zoom-out           |
| N7  | Time-lock default of 24 hours has no calibration criteria                                                                       | zoom-out           |
| N8  | Soak criterion (zero escapes in about 20 issues) is weak evidence; reword                                                       | catalyst           |
| N9  | Pause state has two authorities and an unspecified failure mode; state fail-closed                                              | catalyst           |
| N10 | Local paths and author name embedded in a committable file (X-3, `~/.local/bin/rig`)                                            | catalyst           |

## Suggested order of work

1. Fix B1 and B2 first. Both change what the design says is true, and both gate factory-core work.
2. Decide the scope tiers (M1) and move the plan, alternatives and history out (M2, M3). This shrinks the file and makes the later fixes cheaper to check.
3. Resolve the open decisions that block architecture: M5 (fallback), M6 (public logbook, offline verification), M10 (deterministic coordinator and steward), M13 (required checks) and M15 (digest and release authority).
4. Apply the remaining catalyst transforms (M14, M16 to M25) selectively and in this order: Extraction (enforce on the platform), Segmentation (split jobs and the control repo), Intermediary (deterministic actuator and credential broker).
5. Clean up Nits last.
