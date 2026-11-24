# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (lines 1-684, the feature specification; the "Detailed Implementation Plan" from line 685 was not reviewed)

**Mode:** REVIEW. Independent pass: no reviewer read `docs/designs/governed-factory/review-round-1/`.

## Reviewer Status

| Reviewer         | Status    |
| ---------------- | --------- |
| `egm-design`     | completed |
| `egm-structural` | completed |
| `egm-style`      | completed |

No reviewer needed a retry.

## Severity Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 2     |
| Major    | 25    |
| Nit      | 18    |
| Total    | 45    |

Overlapping findings from the three reviewers were merged. The reviewer lens in each entry names every lens that raised it. The synthesizer changed three severities: the style lens rated K28 and K29 and K30 as Major, and they are Nits here because they are wording or consistency fixes with no design impact.

## Points Checked Against the Repository

These claims were confirmed by one or more reviewers and need no action:

- The six unwired modules (`lib/audit/role-flow-span.mjs`, `lib/gates/gate-sweeper.mjs`, `lib/qa/process-supervisor.mjs`, `lib/qa/qa-contract-verifier.mjs`, `lib/runtime/handover-protocol.mjs`, `lib/runtime/lease-fencing.mjs`) have no importer outside tests. The only product import is `handover-protocol.mjs` importing `lease-fencing.mjs`, which is itself unwired.
- `lib/providers/local-cli.mjs` passes `HOME` and `USERPROFILE`, uses `spawnSync` and has a 120 s default timeout. `lib/sources/github-credential.mjs` runs `gh auth token`. `package.json` is at 1.12.0.
- Line citations into `AGENTS.md`, `docs/agent-workflow.md`, `docs/guiding-principles.md` and `docs/modular-architecture.md` are accurate. The `#human-acts` anchor resolves. Every document named in Additional Resources exists.
- Kept as good practice by the style lens: "pluggable is not claimed until a second implementation passes the same suite" (lines 181, 213), the compliance-wording non-goal (line 57), "supports" and "maps to" wording (lines 50, 115), and the dated evidence in lines 72-73.

## Prioritized Findings (Blockers -> Major -> Nits)

### K1. Merge controls that GitHub cannot enforce rest on a host-side model session - Severity: Blocker

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 185, 232, 236, 295-297 (Components table, "Merge, verification and recovery", Known risks)
- **Discrepancy Description**: The merge needs five things: required checks, the cross-family attestation, the evaluator's approval, a delegation in force and, for `factory-core`, the time-lock. Only the required checks and the attestation can be enforced by GitHub rulesets and the merge queue. The evaluator (`lib/core/steering-merge-policy.mjs`), the delegation check, the time-lock, the pause flag and the 7-day dead-man rule are coordinator or steward behavior. The steward is a model session on the host that reads issue, PR and comment text, and it holds a merge App token. A prompt injection or a host compromise lets that token merge directly, skipping the time-lock, pause flag and delegation expiry. The claim that a persuasive prompt "does nothing, because the evaluator's output is the gate" holds only if the token cannot be used outside the evaluator.
- **Rationale & Recommendation**: State, for each of the five conditions, who enforces it (GitHub or the host). Move the time-lock, pause flag, check-in age and delegation validity into the pinned verifier as a required check that reads control-repository state and fails closed. Or state that the steward's token is usable only through a non-model signing step. Add the residual risk to "Known risks the design carries".

### K2. Alternatives Considered: rejections are attributed to the author, not justified - Severity: Blocker

- **Reviewer Lens:** `egm-structural`, `egm-design`, `egm-style`
- **Affected Scope:** lines 319-633 (about 40 of the 52 alternatives); worst cases A, B, AD, AK, AL, AM, AN, AO, AX, and C, E, I, T
- **Discrepancy Description**: The feature-spec standard requires a concrete technical or scope trade-off for each rejection, and forbids attributing a rejection to a maintainer without a linked issue, discussion or PR. Nearly every entry reads "Rejected by author" with a date or a decision ID (D1-D38) that resolves only to the unlinked `concepts_brief.md`. Several give no reason of their own: A, B and AD restate the chosen design, AK and AL say "accept the rule as drafted" (circular), AM says "as D5 says", and AN, AO and AX state a preference. C, E, I and T cite "the council and reviewers" or "a research report" with no link. The repeated "(decided by the author, 2026-11-24)" is provenance noise.
- **Rationale & Recommendation**: For each alternative, give the cost, complexity, risk or scope reason that decided it, separate from who decided. Where the author's decision is the evidence, link it (brief section anchor, PR or issue). Replace "council and reviewers" with a linked artifact or drop it. Rewrite AK and AL with real reasons. Record decision owner and date once in a decision log instead of in every entry.

### K3. Holdout tests and the red-team canon can be read by the candidate code running beside them - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 177, 182, 226, 234, G4 (line 48), open question at line 74
- **Discrepancy Description**: The verifier runs in hosted CI with a control-repository read credential and runs holdouts and canon against candidate code. The candidate executes in the same job as the checked-out holdouts, so it can read, overfit to or print them, and logs on a public repository are public. G4's negative test proves only that the builder's token cannot read the holdouts, not that the candidate cannot. The "workflow the PR cannot edit" (`pull_request_target`) pattern is a known route for exposing secrets to untrusted PR code, and the open question leaves it unresolved.
- **Rationale & Recommendation**: Specify the CI topology: run candidate code in a job without the control-repository credential, and run holdouts in a step that receives only the build artifact and executes no PR-supplied scripts. Redact output. Extend the G4 negative test to the candidate's execution context. Resolve the open question before M0.

### K4. The evidence layer proves what CI saw, not that the recorded events happened - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 33 (Problem 3), lines 187-188, G5 (line 49), CUJ 5
- **Discrepancy Description**: Problem 3 names self-asserted evidence as the defect, yet receipts, egress logs, substrate identity and "actual model" are still written by the launcher on the host. Hosted CI attests only a digest of the bundle. A host-written record back-dated inside the bundle is not caught by anything stated. "Tamper-evident" and "verifiable" could mislead a regulated buyer.
- **Rationale & Recommendation**: Define what each signature and attestation asserts and what it does not. Either sign host-produced receipts with a launcher key that is in the trust policy, or label them "reported by the host". Say what the timestamp binds to.

### K5. The Agy login is exposed inside the sandbox, and sandbox output is handled on the host without a stated method - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 223 (trust table), CUJ 3, G2, flow step 6 (line 201)
- **Discrepancy Description**: The trust table leaves Agy's login "open" inside the builder sandbox, so a hostile prompt can read the OAuth token, and the vendor allowlist gives it a channel out. G2 and the red-team list do not include "read the model login". Separately, the launcher takes commits, transcript and logs out of the sandbox and processes them on the host. Agent-controlled `.git` content (hooks, config, filters, symlinks, submodules) can lead to host code execution if git commands run on it. The extraction method is not stated.
- **Rationale & Recommendation**: Add "exfiltrate the model login" and "attack the host through collected artifacts" to the red-team suite and to Known risks. State the extraction method (for example a patch or bundle applied to a fresh clone). State the Agy token mitigation (scoped, revocable, separate account, or the same brokering as Claude) or accept the risk explicitly.

### K6. The plan depends on unattended subscription use that is unverified, with no go/no-go rule - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** lines 16, 70-76 (Open Questions), 287-288, G3, Alternatives H and I
- **Discrepancy Description**: G3 and the dark-running plan rest on vendor terms that the text says "were not read". The fallback covers only Agy (attended-only). Nothing says what happens if Claude is unusable, or whether the factory is viable on one vendor. Brokered credentials via `sbx` may themselves be what the vendor bars. Suspension would hit the author's personal accounts and possibly the root-of-trust identity. Subscription-only (D2) has no comparison with API billing. The Open Questions mix evidence, assumption and decision: line 72 carries hearsay ("secondary reports", "staff opinion, not terms text") and speculation ("Agy is the likelier vendor to fall into the attended-only fallback"). Lines 70, 73, 74 and 76 name no owner or date.
- **Rationale & Recommendation**: Read the terms before approval, not in W0-18. Add an explicit go/no-go rule, state single-vendor viability, and use dedicated accounts separate from the root of trust. Add an API-billed alternative with a cost comparison. In Open Questions keep dated facts and the decision, drop hearsay and speculation (or move them to `concepts_context.md`), and give each question an owner and a week.

### K7. No behavior when one model family is unavailable, and the reviewer's resistance to injection is not addressed - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** G4, lines 183, 203, 232, 293
- **Discrepancy Description**: With two families, every merge needs both vendors up, in quota and permitted. If Agy is attended-only or rate-limited the merge rule has no valid path, so L2 stalls, or the rule is silently weakened. The reviewer is itself an LLM reading builder-authored diffs, and the builder can plant text meant to induce an approving attestation. The design treats issue and PR text as data for the steward (line 232) but says nothing about the reviewer, the main semantic control.
- **Rationale & Recommendation**: State the fail-closed behavior and recovery path when a family is unavailable. Say how the reviewer resists injection, or state that it is advisory and deterministic checks carry the weight. Add a seeded-injection case to the seeded-defect suite.

### K8. Revert and prerelease paths have unspecified ordering and edge cases - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** CUJ 2 (line 91), lines 186, 234, 266, 294, G3
- **Discrepancy Description**: Merges landing after a bad one may depend on it or conflict with the revert. The merge queue keeps admitting changes while main is broken because the post-merge run is asynchronous. The revert PR must pass required checks on a broken base. The steward pushes a `next` tag after a `factory-core` merge and `publish.yml` publishes it; it is not stated whether publish waits for post-merge verification, and an npm publish cannot be undone, only deprecated.
- **Rationale & Recommendation**: Specify that the queue halts on post-merge failure until the revert lands, how conflicts and dependent merges are handled, and which checks the revert must pass. Gate the tag on a green post-merge run.

### K9. No cost, quota or capacity model, and the host is a single point of failure - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-structural`
- **Affected Scope:** NFR "Performance & Latency" (lines 647-652), G3, G8, line 291, Open Questions lines 69 and 77
- **Discrepancy Description**: Two lanes and up to 6 concurrent PRs each need builder, reviewer, tester, steward and post-merge sessions plus a coordinator, on subscription plans with weekly limits. No estimate of runs per day, token use or quota burn exists; spend is reported but has no ceiling. Sandbox start time, disk and memory per microVM are "not measured", and up to 6 microVMs share a Windows host with the author's own work. The host is also coordinator, launcher, steward and watchdog. The watchdog only writes a file and the alert channel is undecided, so host loss is a silent stall. Polling cost grows with open issues with no stated ceiling.
- **Rationale & Recommendation**: Add a back-of-envelope budget (runs and tokens per change, microVM resource needs, the quota ceiling that trips the circuit breaker), even if provisional. Decide the alert channel and run it off the host, for example a scheduled GitHub workflow that checks heartbeat age.

### K10. The delegation scope is called "narrow" while this repository opts in for every class - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 215, 242-244, 295
- **Discrepancy Description**: Known risks relies on the delegation scope "staying narrow" to limit the steward's self-issued decisions, but line 242 says this repository opts in for all classes, including high-assurance and `factory-core`. Principle 2 of `docs/guiding-principles.md` requires human review for high-assurance work and says self-review cannot satisfy it. A standing delegation signed once is advance authorization, not review of a change. The expiry is unstated.
- **Rationale & Recommendation**: State the actual scope and expiry for this repository, or stop calling it narrow. Say plainly in the Overview that the human gate becomes advance authorization, and say what the delegation records about what the human saw.

### K11. Several outcomes lack thresholds, sample sizes or parameter values - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** G3 (line 47), G8 (line 52), lines 91, 234, 236, 656-657
- **Discrepancy Description**: "N reverts in the window" has neither N nor the window, and there is no failure classification rule. The time-lock is "24 hours (to calibrate)" and the delegation expiry is not given. The soak (about 20 issues, 48-72 active hours) is too small to support "no containment escapes" as a promotion criterion, and no confidence statement is made. Promotion needs "no post-merge failure" with no minimum merge count. G8 lists measures with no targets, so "measured numbers" cannot fail.
- **Rationale & Recommendation**: State defaults for N, the window, the time-lock and the expiry, or list them as Open Questions with an owner and week. Say what the soak can and cannot show, set a minimum sample, and give pass and fail thresholds for the reported measures.

### K12. The attestation plan depends on an unresolved GitHub plan tier and repository visibility - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** line 73, G5, G6, G8 (lines 19, 49, 52), Alternative M (line 398), CUJ 5
- **Discrepancy Description**: Attestations on private repositories need Enterprise Cloud (line 73), and it is unknown whether the mock-GxP and author repositories are public. Alternative M rejects Sigstore because the public log would expose private-repository metadata, but GitHub attestations on public repositories expose exactly that, and private ones use a different trust root. CUJ 5's "trusted root fetched from Sigstore" does not say which root applies.
- **Rationale & Recommendation**: Decide each repository's visibility and the plan before approval. State the trust root `evidence verify` uses in each case. Correct Alternative M.

### K13. Alternatives: unverified premises, inconsistent human/agent boundary and missing options - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** Alternatives P, Q, R, S, T, V (lines 416, 428, 452 and neighbors); C, AR, AW, AX; section as a whole
- **Discrepancy Description**: Rejections rest on unchecked, first-person premises: "I believe all WSL2 distros share one VM and kernel (unverified)" (P, and V which depends on it), "unverified" (Q), "my estimate, not measured" (R), "unconfirmed" (T), "my background knowledge, unchecked" (V). S cites "about 9k stars" (undated) and "one review" (unnamed). The human/agent line is inconsistent: C and AR are rejected because human merge approval stops the factory running dark, yet AW and AX keep `latest` human because an error there is hardest to undo. AX's ratchet objection (small weakenings still pass the previous judge) applies equally to agent-merged `factory-core` and verifier changes. Missing alternatives: a reduced scope (stop at L2, defer GxP, website and manuals), API-billed agents, and host-independent enforcement of merge controls (see K1).
- **Rationale & Recommendation**: Verify each premise or drop the alternative's reliance on it (the shared WSL2 kernel is publicly documented), and use impersonal wording. Date and name sources. State one criterion for the human/agent boundary, for example reversibility and detectability. Add the missing alternatives.

### K14. Alternative U is not a rejected alternative - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 443-447
- **Discrepancy Description**: The "Reason for Rejection" field says "Not rejected. Kept as the fallback". An adopted fallback is a design element, not an alternative, and it breaks the section's pattern.
- **Rationale & Recommendation**: Move it to the architecture (Components and Deviations already treat it as the second substrate), or retitle the field "Disposition" for this entry.

### K15. No Risks & Mitigations section, and risk content is duplicated and incomplete - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 284-297, 639-645, 647-652, and lines 11, 69-77, 236, 272, 286-288, 643-644, 656-657
- **Discrepancy Description**: The standard requires an explicit risks and limits section covering failure modes, security, scalability limits and mitigations. Risk content sits in the H3 "Known risks the design carries" (mid-Technical-Plan) and in NFR "Security & Privacy", and some Open Questions are really risks. Single root of trust (286, 643), supplier risk and the `sbx` CVE count (287, 640, 644), vendor terms (72, 288), the autonomy ladder (236, 656), revert and kill-switch rollback (234, 657) and pause and resume (G7, CUJ 4, 272, 657) are each stated two to four times and will drift. Several risk bullets name a risk with no mitigation ("Surface growth", "Two lanes double the exposure", "The coordinator is a model session"). "Performance & Latency" gives no scalability limits.
- **Rationale & Recommendation**: Promote one "Risks & Mitigations" H2 with columns for risk, failure mode, mitigation and residual limit. Give each repeated statement one authoritative home and link to it from elsewhere. Add provisional scalability limits.

### K16. "Additional Resources" and "Future Improvements" are nested under Non-Functional Requirements - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 664 and 671 (H3 headings after a horizontal rule)
- **Discrepancy Description**: Both are H3s, so they read as children of "Non-Functional Requirements" (which ends with "If time slips" at line 660). Resources and future work are not non-functional requirements, and Future Improvements is hidden when NFR is read alone.
- **Rationale & Recommendation**: Make both H2s in the order Non-Functional Requirements, Future Improvements, Additional Resources, ahead of the Detailed Implementation Plan. Remove the stray rules.

### K17. Overview and Non-Goals contradict the current substrate decision - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** Overview line 16, Non-Goals line 61, Deviation 4 (line 304)
- **Discrepancy Description**: The Overview says agents run "inside WSL2 substrates". The Technical Plan and Deviations 1-3 make `sbx` microVMs on the Windows host the reference substrate, with WSL2 only the fallback. Deviation 4 says the non-goal "no unattended runs on Windows native" is reworded, but line 61 still carries it unchanged even though the launcher, coordinator and steward run unattended on the Windows host.
- **Rationale & Recommendation**: Update the Overview and line 61. For example: "Agents run in Linux microVMs launched from a Windows host. Unattended agent execution on native Windows or macOS is out of scope."

### K18. The "Deviations from the brief" block is a change log that holds design decisions - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 299-317
- **Discrepancy Description**: This 17-item log sits inside the Technical Plan. Its heading says "to reconcile at Step 6", which the document never defines, yet most items are "Resolved by the author". Item 10 is a long mixed paragraph. Items 12 and 14-17 hold requirements (the writer-generation rename rule, qa-contract-verifier lane, surface freeze, in-flight cap, phase gates) that a reader would not look for under "Deviations".
- **Rationale & Recommendation**: Fold each decision into its home section (Components, flow, Human acts, Alternatives). Keep a short "Changes from the brief" appendix with a defined "Step 6" or a link. Split item 10.

### K19. The specification is not self-contained: IDs and sources cannot be resolved - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`, `egm-design`
- **Affected Scope:** lines 11, 19, 21, 56, 71, 202, 299-317, 321, 337, 351, 375, and throughout
- **Discrepancy Description**: Decision IDs D1-D38 (plus unexplained "D-A1" and "C3"), work-item IDs (W0-n, M0-n, M1-n, M2-n, M2b-n, M3-n, M4-n, M5-n), "the brief", "Step 6", "the council", "reviewers", "the brainstorm" and "the assistant" appear with no gloss. The brief is called "the source for every decision" (line 21), but its path is not given. Work-item IDs are defined only in the Detailed Implementation Plan, outside the reviewed section. File references in the Overview and Additional Resources are plain text, omit the `docs/designs/` prefix, and `concepts_context.md` and `concepts_brief_history.md` are not linked. Terms such as `claude-agy`, canon, lane, admission gate, writer generation and L1-L3 are used before they are defined.
- **Rationale & Recommendation**: Define each ID class once near the top with a link, make file references repository-relative links, name and date any "council" or "reviewers" artifact, and add a short glossary.

### K20. The trust boundaries table omits actors the text and diagram rely on - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 221-228
- **Discrepancy Description**: The coordinator (a model session that reads the pause flag and path classes and claims issues) and the tester sandbox (line 184) have no row. The reviewer row has no model-login entry although the builder row does. Row two says the launcher cannot read the control repository, yet it checks scope, and admission uses path classes that "come from the control repository". The text does not say who supplies the classification to the launcher.
- **Rationale & Recommendation**: Add Coordinator and Tester rows, complete the reviewer row, and state how classifications reach the launcher without a control-repository read.

### K21. The description of the reachability audit's scope is imprecise on a load-bearing point - Severity: Major

- **Reviewer Lens:** `egm-style` (the `egm-design` lens read the same claim as accurate; reviewers disagree)
- **Affected Scope:** line 29; related G1 (line 45) and M0 work
- **Discrepancy Description**: The text says the audit "scans only `lib/core/` and `lib/verification/`". The synthesizer checked `scripts/audit-reachability.mjs`: `SCAN_ROOTS` is `['lib', 'scripts', 'bin']` (line 208), and only the control-shaped-export rule uses `CORE_API_PREFIXES = ['lib/core/', 'lib/verification/']` (line 575). The design lens's reading is right about the control-export rule, and the style lens is right that "scans only" is literally wrong.
- **Rationale & Recommendation**: Rewrite to say the importer scan covers `lib`, `scripts` and `bin`, and the location-based control-export rule covers only `lib/core/` and `lib/verification/`, which is why the six modules under `lib/audit`, `lib/gates`, `lib/qa` and `lib/runtime` passed.

### K22. "No human action" in CUJ 1 contradicts the Human acts table - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 11, 81-85, 252-264
- **Discrepancy Description**: CUJ 1 is titled "with no human action" and says "The author took no action". The Human acts table requires signing the delegation, admitting milestones, weekly check-ins and policy edits. Line 11 already says "per-change".
- **Rationale & Recommendation**: Scope CUJ 1 to "no per-change human action".

### K23. "Thin launcher and evidence glue" understates what the design lists as new - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 127, 171, 187, 281
- **Discrepancy Description**: Line 127 says "Most pieces exist already or are rented. What is new is the launcher, the substrate port, the evidence glue and the checks." Line 281 adds a control-repository reader, delegation issuer, GxP generator, `evidence verify`, claims ledger, intake poller and conformance suites, and about ten Components rows are marked New. "Thin", "glue" and "Most" are unmeasured.
- **Rationale & Recommendation**: Replace with the actual list or a count (for example "N of 15 components are new"). Use "integration code" for "glue".

### K24. Absolute present-tense claims about controls that do not exist yet - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 46 (G2 title), 97 (CUJ 3), 232, 272, 297, 641
- **Discrepancy Description**: "Agents cannot escape their box", "none of these attempts succeeds", "A prompt that argues for merging does nothing", resume "is idempotent by construction", "so a prompt cannot" and "A hostile issue cannot change what merges" are stated as facts. The evidence will be a named red-team suite or conformance case that covers only the listed attempts. This also bears on K1.
- **Rationale & Recommendation**: Reword to what the suite covers, for example "the red-team suite covers these N attempts" and "the conformance case shows no duplicates".

### K25. Problem section uses subjective, uncited or speculative framing - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 27, 29, 31, 37, 39, 669
- **Discrepancy Description**: "AgentFlow's concepts are ahead of most frameworks in its space" has no evidence. "A regulated buyer's first audit would find this" is speculation. Line 31 lists 2025-2026 incidents (deleted production database, wiper prompt in an IDE extension, secrets stolen through agent CLIs, private repository leaked through a malicious issue) with no sources. Line 37 says "popular prompt packs" and "none targets regulated software delivery", repeated absolutely at line 669, and "the opening AgentFlow can occupy" is positioning. Line 39 says "the agents can merge anything inside it", which is hyperbole.
- **Rationale & Recommendation**: Drop the comparison and the speculation, or state the specific audit test. Cite each incident in `concepts_context.md` or reduce the line to the design's own requirements. Scope survey claims to "none of the N frameworks surveyed on <date>".

### K26. "Named reference stack" and the month-6 claim are never defined - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 19, G8 (line 52)
- **Discrepancy Description**: The headline month-6 claim relies on a "named reference stack" that the specification never lists. "The month-6 claim is narrow" is a subjective label for a claim spanning eight goals, and "works end to end" is not tied to G1-G8.
- **Rationale & Recommendation**: Name the stack in one sentence (`sbx`, Claude and Agy, GitHub, the Windows host with WSL2), drop "narrow", and tie "works end to end" to G1-G8.

### K27. The "about 1,150 lines of policy" figure has no stated basis - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 35, 651
- **Discrepancy Description**: The reading order in `AGENTS.md` (`AGENTS.md`, `docs/guiding-principles.md`, adapter file, `docs/agent-workflow.md`, `docs/issue-standards.md`) totals about 1,364 lines by the reviewer's count (about 1,318 without the adapter file). 1,150 matches neither. Line 21 says every fact about code "is cited with its file", but this figure is not. The synthesizer did not recount.
- **Rationale & Recommendation**: Name the files counted and the date, or correct the figure. It is the baseline the M5 docs work claims to shorten.

### K28. "Those three gaps" is followed by four numbered problems - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 27 and Problem items 1-4 (lines 29-35)
- **Discrepancy Description**: The count in the lead-in does not match the list.
- **Rationale & Recommendation**: Fix the count or merge two problems.

### K29. Process notes and a filler clause in the Overview - Severity: Nit

- **Reviewer Lens:** `egm-style`, `egm-structural`, `egm-design`
- **Affected Scope:** lines 21-24
- **Discrepancy Description**: "How to read the implementation plan" describes the plan, which is outside this section. "At the author's choice, this document lists files for every milestone" is unclear and reads as a leftover edit.
- **Rationale & Recommendation**: Move the reading note to the "Detailed Implementation Plan" heading and rewrite or delete the clause.

### K30. The `sbx` CVE count is vague and inconsistent - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 287, 644
- **Discrepancy Description**: Line 287 says "about six CVEs in 2026" while line 644 names a specific file-copy escape fixed in 0.51.0. "Monitored" names no mechanism.
- **Rationale & Recommendation**: State the count, the check date and the source, or drop "about". Say who watches advisories and how often.

### K31. Alternative D still uses "fencing" after item 12 retracts the word - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 345 (and rule at line 312)
- **Discrepancy Description**: Item 12 says "fencing" is retracted from prose and the live mechanism is renamed "writer generation", but Alternative D says "the writer-generation fencing in the run store". `lib/core/run-state.mjs` has no "fencing" occurrences. (Other uses, such as the `fencingToken` field name and Alternatives AB and AC, are covered by the rule or by being about the retracted module.)
- **Rationale & Recommendation**: Remove "fencing" from that phrase so the spec follows its own rule.

### K32. G5's final sentence is garbled - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** line 49
- **Discrepancy Description**: "The result does not change with every integration package and the network removed" does not parse.
- **Rationale & Recommendation**: Reword, for example "The result is the same with the network disabled and with integration packages removed."

### K33. "Kill switch" is used for three different things - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** G2 (killing a run), line 91 (halting the factory), line 272 (the coordinator's `killed` state)
- **Discrepancy Description**: One term covers a run kill, a factory halt and a state. Line 272 also does not name the resume command (`coordinator pause` and `kill` appear only at line 657).
- **Rationale & Recommendation**: Use a distinct term for each and name the commands.

### K34. Alternatives lead-in miscounts "program-level"; line 316 cites a rule without a reference - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 316, 321
- **Discrepancy Description**: The lead-in says the first seven alternatives (A-G) are "program-level", which does not fit all of them. The off-by-one comment at line 316 reads as a correction to an unreferenced standing rule.
- **Rationale & Recommendation**: Re-count or reword, and cite the rule or drop the comment.

### K35. Counts disagree across sections - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 259, 291, 296, 531
- **Discrepancy Description**: Alternative AI says "all three spikes run in week 0", while Known risks (line 291) lists four (`sbx`, baseline, digest and signing, vendor terms). The Human acts table says "nine in total" (line 259), Known risks says "about nine ... the program goal and eight milestones" (line 296), and the table row says "once per milestone".
- **Rationale & Recommendation**: Reconcile the spike and admission counts.

### K36. Bold run-in labels are used as sub-sections - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 209-217, 242-248, 266
- **Discrepancy Description**: "Configuration authority", "Releases" and "Contracts" are not headings, so they cannot be linked or appear in the outline. Line 242 refers to "Configuration authority" below, and the implementation plan cannot link to it.
- **Rationale & Recommendation**: Make them H4s under "Policy changes this design requires" and "Contracts".

### K37. Goals and CUJs are not cross-referenced - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** Goals (lines 43-52), CUJs 1-7
- **Discrepancy Description**: No mapping from G1-G8 to CUJ 1-7, and CUJ 5 and 6 have no stated goal check.
- **Rationale & Recommendation**: Add "Demonstrates: G..." to each CUJ.

### K38. "Status: Draft" conflicts with sections that record final decisions - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** document header
- **Discrepancy Description**: Many sections record decisions as final ("decided by the author, 2026-11-24"), while the header says Draft with no version or open-decision count.
- **Rationale & Recommendation**: Optionally add a version and open-decision count and keep a single decision log (see K2).

### K39. The Mermaid diagram omits elements the text relies on - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 129-162
- **Discrepancy Description**: The diagram omits the reviewer and tester lanes and the time-lock hold, has no edge from the control repository to the coordinator (which reads the pause flag), and the text equivalent omits the review attestation. The "Intent plane" subgraph holds the account settings, which connect to nothing.
- **Rationale & Recommendation**: Add the reviewer lane and the coordinator-to-control-repo edge, and align the text equivalent.

### K40. Undefined jargon at first use - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 11, 127, 171, 178, 187, 217, 256, 276
- **Discrepancy Description**: "Runs dark" (G3), "idle-only quota lane", "kill authority", "state ref", "lanes", "goal's agreed admission gate" and "reward comes from lagged post-merge outcomes" are not defined where first used. "Evidence envelope (C3)" and "decision D-A1" use inconsistent ID formats.
- **Rationale & Recommendation**: Define each once or add a glossary (see K19).

### K41. The line 272 paragraph packs too much and has an ungrammatical sentence - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 272
- **Discrepancy Description**: One block mixes the state machine, resume idempotence, gate sweeper, process supervisor and the week-0 gate. "With a configurable deadline for person gates and persisted state" is ungrammatical.
- **Rationale & Recommendation**: Split into short paragraphs and fix the sentence.

### K42. G8 is a compound criterion with an unnamed third party - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** G8 (line 52), line 19
- **Discrepancy Description**: G8 packs about ten deliverables into one bullet, and "a third party runs the demo from a clean machine" names no party or count.
- **Rationale & Recommendation**: Split it and say who the third party is and how many runs count.

### K43. Small wording and precision items - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 202, 291, 292, 315
- **Discrepancy Description**: Step 7 (line 202) cites the brief's quoted wording ("single-repo token with no push or merge right") beside "The agent never holds a push credential". "Week 0 is heavier" is relative and unmeasured. The surface counts ("about 14 CLI verbs and 6 schemas", "retires about 8 verbs") appear twice, and the freeze rule depends on them. "The first sign of drift is a PR body with no stated reason" is hard to parse.
- **Rationale & Recommendation**: Delete or reconcile the quote, state the planned week-0 effort, give exact counts or say none is committed, and say how drift is detected.

### K44. Subjective evaluations in the Alternatives pros and cons - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 321-322 and Alternatives A, B, K, T, AO, AP
- **Discrepancy Description**: "Far beyond what one maintainer can review", "Too much for one maintainer", "the most persuasive for a services offer" and "closest fit to a dark factory" are not tied to a measure. T's Pro "several are open source and some are widely used" and A's "familiar order" are filler.
- **Rationale & Recommendation**: Tie each to an estimate or drop it.

### K45. Scope has no effort estimate or critical path - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** Non-Goal 10 and line 660 ("If time slips")
- **Discrepancy Description**: Nine milestones, two substrates, an offline verifier, a GxP projection, a mock repository, an npm release, manuals and a website are planned in 26 weeks by one maintainer. Non-Goal 10 declines capacity planning, and the slip rule is not an evaluated alternative.
- **Rationale & Recommendation**: Add a short sizing table for the main risk items showing the plan is feasible (related to K9 and K13).
