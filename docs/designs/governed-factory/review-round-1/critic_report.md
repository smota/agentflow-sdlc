# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (`lines 1-596`, the feature specification; the Detailed Implementation Plan from line 597 was not reviewed)

## Reviewer Status

| Reviewer         | Status    |
| ---------------- | --------- |
| `egm-design`     | completed |
| `egm-structural` | completed |
| `egm-style`      | completed |

No reviewer needed a retry. The reviewers read the feature-spec standard (design and structural lenses), `AGENTS.md`, `docs/guiding-principles.md` and `docs/modular-architecture.md`. `egm-design` also read `docs/steering-merge-authority.md`. Each reviewer found that its persona file lives under a different name than the one given (`design_critic.md`, `structural.md`, `style.md`) and used that file.

**Severity totals after deduplication:** 1 Blocker, 21 Major, 18 Nit.

**Code claims spot-checked and confirmed by the reviewers:** `local-cli.mjs` passes `HOME` and `USERPROFILE` and has a 120-second default timeout. `github-credential.mjs` falls back to `gh auth token`. `validateFourEyesIndependence` needs a builder receipt. The reachability audit's core-API scan covers `lib/core` and `lib/verification`. The doc's version and `"private": false` match. One claim is disputed (Major 6).

## Prioritized Findings (Blockers -> Major -> Nits)

### Design depends on agent merge, which the repo's binding policy forbids, and never says so - Severity: Blocker

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 11, 47, 185, 232, 301-305. Policy sources: `AGENTS.md` line 69, `docs/guiding-principles.md` Principles 2 and 3, `docs/steering-merge-authority.md` lines 6-13 and 54-60.
- **Discrepancy Description**: The repo's policy says high-assurance work needs human security and acceptance review on the open PR, and that self-review cannot satisfy it. It says the default merge policy needs an independent human approval (`is_bot: false`). It says publication needs an authenticated human decision bound to the exact head SHA and action. The design's steward is a GitHub App (a bot) that merges under a delegation. At L3 it merges `factory-core` and release changes with no human act (G3, Alternative C). The design does not say which card class `factory-core` or release changes fall into. It does not say whether a signed delegation counts as the "authenticated human decision". It does not say the policy must be amended, or what ledger status the affected `MUST` lines get under G1.
- **Rationale & Recommendation**: G1's headline promise is that every `MUST` line is backed or retracted, and the core flow contradicts several of them. A fresh reader cannot tell whether the design means to amend the policy or has missed it. Add a "Policy changes required" subsection. For each affected line, say whether it is amended, retracted or scoped, and who authorizes that. Say how a signed delegation maps to the human-decision requirement. State the `requireHumanApproval` setting the steward will use.

### Rejection rationales are attributed to the author with no link, and the cited sources are untracked - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-structural`, `egm-style`
- **Affected Scope:** Alternatives Considered, lines 285-545 (about 42 occurrences of "Rejected by author"), especially 293, 299, 305, 311, 317, 323, 382, 388, 394, 406, 418.
- **Discrepancy Description**: The feature-spec standard forbids attributing a rejection to a maintainer without linking their issue, discussion or PR. The section has no links. Its pointers (D2, D5, D21, D26, "the council", "the reviewers") resolve to `concepts_brief.md` and `concepts_brief_history.md`, which are untracked in git and not in the PR. Several entries have almost no content beyond the attribution (AK, AL, AN, AO, AQ; T rests on "a research report built from search results"). Alternatives P, Q, R and V are rejected on first-person, self-declared unverified premises ("I believe... (unverified)", "my estimate, not measured", "my background knowledge, unchecked", "(unconfirmed)"). Alternatives AK and AL give identical reasons ("accept the 'state why' rule as drafted") with no referent for "as drafted". Alternative T lists a Pro with no content.
- **Rationale & Recommendation**: A reader cannot check the rejections. Commit the brief or inline the decision log, and link each decision. Restate each rejection as a technical or scope trade-off and drop "by author" and the repeated "Reason for Rejection: Rejected by author:" label. Verify the unverified premises or drop them. If a rejection rests on a claim that carries weight (V's claim about self-hosted runners), cite a source. Merge AK and AL.

### The spec is not self-contained: undefined decision, step and work-item codes - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 21, 56, 171, 213, 217, 265-284, 311, 431, 521, 578.
- **Discrepancy Description**: The spec uses D2, D3, D5, D11, D12, D17, D18, D21, D26, "decision D-A1", "C3", "Step 6", "W0-18", "M2-9", "M0-9", "the brief" and "the council" without defining them. The D-numbers resolve only to the untracked brief. The work-item IDs live only in the out-of-scope plan and are not referenced from the spec. "C3" appears with no C1, C2 or C4. The "Deviations from the brief" list (lines 265-284) is a reconciliation changelog for readers who hold the brief, and items 10-17 are written as history ("Resolved by the author (2026-11-24)").
- **Rationale & Recommendation**: A competent engineer new to the codebase cannot follow the reasoning. Define each code in place or add a short decision glossary. Add a forward pointer from line 23 to the "Detailed Implementation Plan" heading. Move the deviations list to the brief's history file, and define "council" on first use.

### Decision range is stated three ways - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 21, 578, 585, and the Deviations citing D28 and D29.
- **Discrepancy Description**: Line 21 says the source is `concepts_brief.md` "decisions D1-D22". Line 578 says D1-D26. Line 585 cites D26. The brief runs to D29, and the spec's Deviations cite D28 and D29.
- **Rationale & Recommendation**: The source of truth is stated inconsistently. Use one statement, or drop the range.

### Overview, Non-Goals and the architecture disagree on the substrate, and the Overview overclaims - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 11, 16, 61, 127, 181, 223, 267-272.
- **Discrepancy Description**: Line 16 describes execution "inside WSL2 substrates". The architecture makes `sbx` microVMs the reference substrate, and the assembled WSL2 stack is only the fallback and second implementation. Non-Goal line 61 ("No unattended runs on Windows native") still carries the old wording that Deviation 4 says to reword. Line 16 also says the sandboxes "cannot reach credentials, the network or files they were not given", while line 223 says Agy's login is "open" inside the sandbox and the network is reachable up to an allowlist. Line 11 says merge happens "without a person in the loop", but the design keeps an author veto in the time-lock (CUJ 7), a signed delegation, a pause flag and a dead-man check-in.
- **Rationale & Recommendation**: The headline contradicts the body, and the correction lives only in a deviation list. Fix lines 11, 16 and 61 to the current decision. Suggested wording: "without per-change human approval"; "cannot reach credentials other than their model login, or hosts outside the allowlist".

### Planned behavior is written as present fact - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 197-198, 222-228, 232, 240, 263, 553, 555.
- **Discrepancy Description**: "Idempotent by construction", "Pause is graceful and resume is one command", "The agent never holds a push credential", "Nothing reaches this from the factory" (line 228), "a prompt does nothing" (line 232), "a prompt cannot" (line 553) and "cannot change what merges" (line 263) describe an unbuilt system as if it works. Line 555 admits account compromise defeats the control repository, which contradicts line 228.
- **Rationale & Recommendation**: Unconditional claims about unbuilt behavior will be read as guarantees. Use "will" or "is required to" and point to the conformance case that tests each. Replace "idempotent by construction" with the mechanisms plus the test. Change line 228 to "the factory is granted no access to this". State that the evaluator's output is the gate by design, and cite the red-team case.

### Claim about today's code is too broad - Severity: Major

- **Reviewer Lens:** `egm-style` (the `egm-design` and `egm-structural` spot-checks accepted the claim)
- **Affected Scope:** line 29; "a regulated buyer's first audit would find this".
- **Discrepancy Description**: Line 29 says none of the six modules "has an importer in the product outside tests". `egm-style` found that `lib/runtime/lease-fencing.mjs` is imported by `lib/runtime/handover-protocol.mjs`, which is itself unreferenced outside tests. The other reviewers found no non-test importer for the six modules, apart from `lib/` files matched by name only. The reviewers disagree on the literal reading, so the claim needs a precise statement. `scripts/audit-reachability.mjs` scans `lib`, `scripts` and `bin` for imports, but only audits exports from `lib/core` and `lib/verification`. The sentence about a regulated buyer's audit is speculation with no reader decision attached.
- **Rationale & Recommendation**: Say "none is reachable from a CLI entry point" and state the audit's real scope. Drop the speculative sentence.

### "About 1,150 lines of policy" does not reproduce - Severity: Major

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 35, 563.
- **Discrepancy Description**: The reading order in `AGENTS.md` names `AGENTS.md`, `guiding-principles.md`, `agent-workflow.md` and `issue-standards.md`. They total 93 + 126 + 741 + 358 = 1,318 lines, before the adapter file and the active issue.
- **Rationale & Recommendation**: State which files and which counting method give 1,150. If a consumer's seeded policy differs from this repository's, say so.

### Thresholds that carry the goals are undefined - Severity: Major

- **Reviewer Lens:** `egm-style`, `egm-design`
- **Affected Scope:** lines 45-52, 69, 91, 103, 121, 234, 569.
- **Discrepancy Description**: "N reverts in the window" has no value for N and no window; this is the circuit-breaker trigger for G3 and CUJ 2. "Active hours" is defined only as an Open Question proposal (line 69), yet G3 and the ladder depend on it. G3 gives "48-72 active-hour soak of about 20 issues" as a pass criterion, which is a range and an approximation. "Dead-man pause" (line 103) is never defined.
- **Rationale & Recommendation**: Give default values, or mark them "to calibrate at M2" as line 121 does for the time-lock. Pin the soak to one number, or define the range as the exit condition. Define "dead-man pause".

### Risks are not a top-level section, and mitigations are uneven - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** lines 252-263, 551-572, 69, 77.
- **Discrepancy Description**: Risks sit in an H3 inside the Technical Plan, and the Security NFR repeats some of them. The standard asks for failure modes, security implications and scalability limits, each with a mitigation. "Surface growth" says no number is enforced, and Alternatives AK and AL rejected the budget options. "Admission gates stall the factory" only says it fails closed. The risks omit the host as a single point of failure (the brief's D18 names it), and loss of the author's key or account. Host downtime appears only as an Open Question (line 69) and goal G8. The watchdog (line 77) is not in the Components table (lines 175-192).
- **Rationale & Recommendation**: Promote this to an H2 "Risks & Mitigations" with consistent columns for risk, failure mode, impact and mitigation or accepted residual risk. Add the host single point of failure, key loss and recovery, and the watchdog component.

### The fallback substrate is the one the doc rejected - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 46, 213, 382, 388, 413, 562.
- **Discrepancy Description**: Alternatives P and Q are rejected because runs share one kernel and an agent with root can edit the in-distro egress control. Alternative U has the same shared-kernel weakness, plus CLI sandboxes that cover only shell commands and a hostname-only allowlist that can be fronted. U is still the fallback if `sbx` fails, and the second implementation behind G2's "two substrates pass the suite". Alternative R is rejected for competing with the author's own work for machine resources, but `sbx` has the same cost, and start time, disk use and concurrent-VM limits are unmeasured (line 562).
- **Rationale & Recommendation**: If a weaker second substrate passes the suite, the suite cannot see the shared-kernel risk. State the residual risk of the fallback. Either allow unattended operation on `sbx` only, or add suite cases that expose the shared-kernel weakness.

### The verifier's placement is unresolved, and holdouts can leak to candidate code - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 49-50 (G4), 74, 182, 226, 553.
- **Discrepancy Description**: Running the verifier from a workflow a PR cannot edit is the central control behind G4 and the merge conditions. It is left as an open question with no fallback. `pull_request_target` carries the well-known risk of running PR code with elevated credentials, and the design does not address it. The verifier runs the candidate's tests and the holdouts in hosted CI with the control-repository read credential in scope, so candidate code on that runner could read the holdouts or the credential. G4's negative test covers only the builder's token.
- **Rationale & Recommendation**: Pick the mechanism before approval. Say how candidate code runs without access to the holdouts and the control-repo credential (a separate job, a separate runner, or a credential-less test job). Extend G4's negative test to cover CI-time access.

### Merge-gate enforcement depends on the steward's discretion - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 121, 185, 215, 232.
- **Discrepancy Description**: The steward is an LLM session holding the merge App token. It evaluates readiness with a library, then merges. The design does not say whether evaluator approval, delegation in force and the 24-hour time-lock for `factory-core` are enforced outside the steward, for example as required checks in rulesets. If they are enforced only in the steward's own process, a hijacked or buggy steward can skip them. Nothing says who bumps the pinned verifier digest after an agent-released verifier, so a change merged under N-1 becomes the judge at N.
- **Rationale & Recommendation**: "A prompt does nothing, because the evaluator's output is the gate" holds only if GitHub refuses the merge without that output. Make each merge condition a required status or ruleset condition that the steward's token cannot satisfy or bypass, including time-lock expiry and delegation expiry or revocation. State who bumps the verifier digest.

### A host compromise hands an escaped agent every merge-capable credential - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 138, 223-228, 254-255, 556.
- **Discrepancy Description**: The host holds the builder App token (launcher) and the merge App token (steward). The design accepts roughly six `sbx` CVEs in 2026, including a file-copy escape. An escape from the microVM lands next to those tokens, and the trust table treats the sandbox boundary as the only barrier. The design gives no separation between launcher and steward (OS users, token storage, separate hosts) and no lifetime or storage for the one-hour tokens. The Agy login sits inside the guest, and the allowlist contents and the exfiltration channels left through allowed hosts (the model vendor, package registries) are not stated.
- **Rationale & Recommendation**: Add the sandbox-escape scenario to Known Risks with at least separate OS accounts or a credential broker. Alternatively run the steward on hosted infrastructure with no agent login, which the design already allows for jobs that carry none. State the allowlist and the residual exfiltration channels.

### Post-merge verification and revert have gaps - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 87-91, 121, 232-234, 257.
- **Discrepancy Description**: The full suite and canon run after merge, so bad code lands on the main branch by design, and no alternative considers running them pre-merge in the merge queue. Further merges can stack on a bad change before the revert, and the revert can conflict. L3 includes an agent-made release, and an npm publish cannot be undone by a git revert. The design does not say whether a revert PR for a `factory-core` change waits out the 24-hour time-lock, so CUJ 2 and CUJ 7 conflict. Repo history shows flaky tests (commit 693e4a2), so a flaky post-merge failure would cause a spurious auto-revert and count toward the circuit breaker. Nothing says who classifies a failure as "infrastructure" or how; if a model decides, it can suppress the breaker.
- **Rationale & Recommendation**: Add the pre-merge alternative with a rejection rationale. Define the flake policy and the classifier's owner and rules. Say how a revert interacts with the time-lock. Say how release is protected (a hold, or the human-signed release the council recommended).

### The reviewer is an injectable model gate, and its trust path is incomplete - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 183, 203, 221-228, 232, 553.
- **Discrepancy Description**: The cross-family attestation is a required merge condition. The reviewer reads builder-authored diffs and comments, and builder-to-reviewer prompt injection is not listed (issue-to-steward injection is). The trust table has no row for who holds the reviewer App token or who posts the attestation. If the launcher posts for the reviewer sandbox, the attestation's authenticity rests on host code the design has not described. Who may label an issue "ready" and set its declared scope is unstated, and the scope check compares against the issue's own declared scope.
- **Rationale & Recommendation**: Add the reviewer-injection threat. State which deterministic checks still bound a bad merge if the reviewer is fooled. Add trust-table rows for the reviewer App and attestation posting. State who may mark an issue ready.

### Quota, cost and the vendor-terms assumption are unquantified, and G3 and G4 depend on them - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** lines 11, 46-47, 72, 256, 258, 340, 561-563.
- **Discrepancy Description**: There is no subscription-quota budget across builder, reviewer, tester, steward, coordinator, post-merge and rework runs, and the roughly 20-issue soak is not costed. The coordinator is a model session on every tick, so it spends quota when idle; only API polling cost is discussed. Unattended use of subscription logins is "assumed permitted and unverified", and the doc's own evidence leans against it for Agy. Cross-family review needs both vendors; if Agy is attended-only, G3 and G4 have no degraded mode, since Codex is excluded from this build (D3). There is no go/no-go criterion for the week-0 check. No licensing or cost note covers `sbx`, the Docker account or the GitHub plan tier. The Overview and G3 state the dark-running result without the vendor-terms condition, and line 72 (about 170 words) mixes evidence, unsourced secondary reports ("secondary reports cite a ban") and speculation ("likelier vendor"), and says the Consumer Terms text "was not read".
- **Rationale & Recommendation**: Add a rough quota budget per issue and per soak. Say whether the coordinator tick is a model call or a deterministic script. State the decision rule and the degraded mode if Agy is unavailable (same-vendor different model, a human reviewer, or a lower autonomy level). Put one conditional sentence in the Overview and G3: "dark running depends on vendor terms; the fallback is attended-only". Shorten line 72 to the decision, and either read the Consumer Terms or label the point unverified.

### G5's timestamp and key claims are not backed by the signing design - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** lines 49-50, 107-109, 213, 588.
- **Discrepancy Description**: G5 and CUJ 5 require detecting a back-dated timestamp. The RFC 3161 timestamp is an "optional seam", and human acts are signed commits or tags whose dates the writer chooses. The doc does not say what timestamp source covers the delegation, the check-ins, the dead-man timer and the time-lock. G5 says verification works "without the author's keys", while CUJ 5 needs the author's public key. The offline verifier needs the `gh` CLI, which line 588 lists as a known limit. G5's last sentence ("does not change with every integration package and the network removed") is garbled. CUJ 5 and line 258 also rely on a Sigstore trusted root fetched out of band, which G5 never mentions.
- **Rationale & Recommendation**: Make the timestamp source mandatory for the acts that need it, or weaken the back-dating claim. Reword to "with the author's public key and no private key, and with no network access". State the `gh` dependency and the trusted-root fetch in G5.

### Merge queue and org-level features may be unavailable on this repository - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 73, 74, 132, 185; CUJ 1 and CUJ 2; G3.
- **Discrepancy Description**: `package.json` points to `github.com/smota/agentflow-sdlc`, which looks like a personal account. Merge queue, and the org-level required workflow offered at line 74, are generally organization features (the reviewer could not verify this). Merge-queue availability is not in the Open Questions, yet CUJ 1, CUJ 2 and G3 depend on it.
- **Rationale & Recommendation**: Verify availability now, add it to the Open Questions, and give a fallback.

### Idempotent resume is asserted, and the conditional append is not shown to be possible - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 51 (G7), 197, 240.
- **Discrepancy Description**: The claim ledger is a log entry in the source system, and GitHub issue comments have no append-if-unchanged precondition. The design promises "an append conditional on the log revision" without saying where the log lives or how the condition is enforced.
- **Rationale & Recommendation**: Name the log's home. A git ref with an expected-old-SHA is feasible; issue comments are not. State the mechanism or drop the claim.

### No schedule or critical path in the specification - Severity: Major

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** lines 11, 19, 259, 490, 572.
- **Discrepancy Description**: The spec commits one maintainer to about 26 weeks covering a launcher, two substrates, a verifier, two lanes, a signed-evidence path, a GxP projection, a mock repository, an npm release, a website, manuals and a case study. It gives no per-milestone timing, effort or dependency chain; the only duration is "weeks 0-8" at line 490. The cut list never defers L3, the riskiest goal. The spec does not say when the agent-built plan starts running unattended (after M2).
- **Rationale & Recommendation**: Add a milestone table with target weeks, entry and exit criteria and the critical path. Say what happens to G3's L3 target if M2 slips.

### Alternative S's rejection conflicts with the chosen design - Severity: Major

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** line 400 against line 223.
- **Discrepancy Description**: Microsandbox (Alternative S) is rejected because "a subscription token would sit in the guest". The trust-boundaries table says Agy's login is "open" inside the builder sandbox, which is the same exposure.
- **Rationale & Recommendation**: Either list the Agy exposure as a known risk with a mitigation, or soften the Alternative S rationale.

### Watchdog and morning digest are used but never defined - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-structural`
- **Affected Scope:** lines 77, 262, 175-192.
- **Discrepancy Description**: The watchdog appears in an Open Question and the risks but is not in the component table, the diagram or the flow. The "morning digest" is the same.
- **Rationale & Recommendation**: Add both to the Components table, or define them where first used.

### Kill-switch latency is ambiguous - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** G2, line 196.
- **Discrepancy Description**: G2's "under 10 seconds" fits a local kill. A remote pause flag is read only on each tick, so remote latency is unstated.
- **Rationale & Recommendation**: Say which path G2 measures and state the remote path's latency.

### Soak statistics are weak and escape detection is unspecified - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** G3.
- **Discrepancy Description**: "Zero escapes" over about 20 issues and 48-72 active hours has little statistical power. Egress logs cover only network escapes.
- **Rationale & Recommendation**: Say how escapes are detected and what the soak can and cannot show.

### Line 23 commits the spec to edits during execution - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-style`
- **Affected Scope:** line 23.
- **Discrepancy Description**: "At the author's choice, this document lists files for every milestone" has no reader consequence. It also says each milestone's changes are recorded "in this document", which makes the spec change during execution.
- **Rationale & Recommendation**: Drop "At the author's choice". Say why the file lists are here and where recorded changes go.

### Unsourced or unreproducible facts and figures - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-structural`, `egm-style`
- **Affected Scope:** lines 31, 35, 255, 292, 436, 556, 563.
- **Discrepancy Description**: The "published incidents of 2025-2026" list (a deleted production database, a wiper prompt, stolen secrets, a leaked private repository) has no references. "About six CVEs" and staff-opinion material rest on secondary or search-derived sources. Line 292's "24-37 focused weeks" for the original roadmap has no basis. Line 436's "about 3,100 lines have no caller outside tests" appears to come from the brief's audit and is not cited.
- **Rationale & Recommendation**: Cite each with a date, or drop it. The controls stand without the incident list.

### Subjective or unprovable wording - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 19, 27, 37, 296, 399, 535-538, 581.
- **Discrepancy Description**: "Concepts are ahead of most frameworks", "popular prompt packs", "credible basis", "the most persuasive for a services offer", "about 9k stars" and "Familiar order" are evaluative or unsupported. Line 37's "none targets regulated software delivery" differs from line 581's "None addresses regulated delivery with signed evidence".
- **Rationale & Recommendation**: Drop the evaluative words or give a count or citation. Make lines 37 and 581 say the same thing.

### "Three gaps" versus four numbered problems - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 27 against lines 29-35.
- **Discrepancy Description**: Line 27 names three gaps, and the section lists four problems.
- **Rationale & Recommendation**: Reconcile the count.

### G5 wording is garbled - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 50, 108.
- **Discrepancy Description**: "Does not change with every integration package and the network removed" is unclear. The key wording is covered under the G5 Major finding above.
- **Rationale & Recommendation**: Rewrite the sentence plainly, for example "gives the same result with no integration packages installed and no network".

### The spec breaks its own ledger rule - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 19, 50, 57 against line 45.
- **Discrepancy Description**: G1 makes CI fail on any document that says "supports X" without an `implemented` ledger row. This document uses "supports" at lines 19 and 57, and line 50 uses it as the permitted wording.
- **Rationale & Recommendation**: State that the rule applies to product claims, or add ledger rows for these lines.

### Filler and forward references - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 19, 21.
- **Discrepancy Description**: "Facts about today's code were checked during the brainstorm" is process narrative. Line 19 says "named reference stack" before the stack is named.
- **Rationale & Recommendation**: Drop the narrative. Name the stack in line 19 or point to where it is named.

### Same facts stated several times - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** lines 197/209/240 (duplicate-event, one-claim rule); 254/555 (single root of trust); 255/556 (`sbx` CVE count); 236/568 and 234/569 (autonomy ladder, rollback and revert); 72/256 (vendor terms).
- **Discrepancy Description**: Each of these facts appears in two or three places.
- **Rationale & Recommendation**: State each once and cross-reference.

### Alternatives section structure and labels - Severity: Nit

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 287, 311, 409-413, 289-545 (Alternatives AG-AQ).
- **Discrepancy Description**: Alternative U carries a "Reason for Rejection" label but says "Not rejected" (it is the fallback). The intro says "The first seven alternatives are program-level", which is not verifiable against the A-AQ list. Alternative D says "as the default" without explanation. Alternatives AG-AQ record review-round decisions, not design alternatives.
- **Rationale & Recommendation**: Rename U's field or move U into the Architecture section. Check where the program-level split falls. Move the review-round items to the brief.

### "Fencing" is used after it was retracted - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 311 against line 278 (Deviation 12).
- **Discrepancy Description**: Deviation 12 retracts the word, but line 311 still says "the writer-generation fencing in the run store is live".
- **Rationale & Recommendation**: Write "writer generation".

### `role-flow-span` is both "retired" and "re-pointed" - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 250.
- **Discrepancy Description**: It is not clear whether the module is deleted or kept.
- **Rationale & Recommendation**: Say which, and which claim is retracted.

### Formatting inconsistencies - Severity: Nit

- **Reviewer Lens:** `egm-structural`, `egm-style`
- **Affected Scope:** lines 7, 184, 302-303, 435-545, 547, 553, 574, 595.
- **Discrepancy Description**: Alternatives A-X use `-` bullets, and Alternatives Y-AQ, the NFR, Resources and Future Improvements sections use `*   `. Horizontal rules vary (`---` at line 7, long dashed lines at 547, 574 and 595). Line 184's table row is unpadded compared with the others.
- **Rationale & Recommendation**: Normalize with the formatter.

### Headings do not use the standard's names - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** section headings "The Problem", "Technical Plan (Architecture)", and the Goals and Non-Goals sections.
- **Discrepancy Description**: The standard expects "Problem Statement", "Goals & Non-Goals" and "Proposed Architecture". The content is present under different names.
- **Rationale & Recommendation**: Use the standard's names or note the mapping.

### Trust-boundaries table omits the reviewer's model login - Severity: Nit

- **Reviewer Lens:** `egm-style`
- **Affected Scope:** line 225.
- **Discrepancy Description**: The reviewer sandbox row lists only a read-only working copy. The reviewer also needs a model login, which the builder row mentions.
- **Rationale & Recommendation**: Add the login, or say it matches the builder's.

### Terms defined only inline or not at all - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** line 52 ("case A / case B"), lines 258 and CUJ 5 (trusted root).
- **Discrepancy Description**: "Case A / case B" is defined only inline, though G8 glosses it. Several brainstorm facts are not cited (line 21 says each is cited with its file).
- **Rationale & Recommendation**: Define terms at first use and either cite each fact or soften line 21.

## Notes for the Elephant

- The three reviewers agreed on two themes: the undocumented dependence on the untracked brief (rejections and decision codes) and unconditional claims about an unbuilt system. The only direct disagreement is over line 29's "no importer outside tests" claim (Major 6). Check it against `lib/runtime/handover-protocol.mjs`.
- `egm-design` did not review style, and `egm-style` did not read the feature-spec standard. Any finding that depends on the standard comes from the design and structural lenses only.
