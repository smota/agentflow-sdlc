# Consolidated Design Review: Governed Factory

**Target file:** `docs/designs/governed-factory.md` (916 lines; feature spec at lines 1-596, Detailed Implementation Plan at lines 597-916)

## Review stages

| Stage | Report                               | Reviewers                                                           | Scope reviewed     | Status                                                                       |
| ----- | ------------------------------------ | ------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| 5     | `zoom_out_report.md`                 | `egm-zoom-out`, `egm-inventive-catalyst`                            | lines 1-916        | both completed                                                               |
| 6     | `comprehension_report.md`            | `egm-comprehension` (naive reader)                                  | lines 1-916        | completed (the report has no status table; it states the full file was read) |
| 7     | `critic_report.md`                   | `egm-design`, `egm-structural`, `egm-style`                         | lines 1-596 only   | all completed, no retries                                                    |
| 8     | `intermediate_zoom_out_report.md`    | `egm-zoom-out`                                                      | lines 1-916        | completed; target unchanged since Stage 5, no earlier finding addressed      |
| 9     | `implementation_readiness_report.md` | `egm-implementation-readiness`, `egm-codebase-details`, `egm-style` | lines 597-916 only | all completed                                                                |

## Severity summary

| Severity   | Consolidated items | Raw (as each report counts them) | S5  | S6  | S7  | S8 (new only) | S9  |
| ---------- | ------------------ | -------------------------------- | --- | --- | --- | ------------- | --- |
| 🔴 Blocker | 12                 | 13                               | 2   | 1   | 1   | 0             | 9   |
| 🟡 Major   | 64                 | 93                               | 23  | 18  | 21  | 7             | 24  |
| 🟢 Nit     | 38                 | 54                               | 10  | 4   | 18  | 4             | 18  |
| **Total**  | **114**            | **160**                          | 35  | 23  | 40  | 11            | 51  |

Stage 5's own counts are after its internal deduplication. The Traceability Matrix lists Stage 5 at raw level (catalyst contradictions, F1-F19 and reuse notes as separate rows), so its matrix has 52 rows. See the reconciliation lines at the end.

## Overall verdict

Every stage that gives a verdict says the document is not ready: Stages 5 and 8 say it does not pass the zoom-out standard, and Stage 9 says the plan is "not ready to implement" because the build order is not buildable, file lists are incomplete, and some deletions would break `validate:release`. The reports agree the problem diagnosis is sound and the pinned-verifier and control-repository ideas are the right shape. What stops the design is that it overrides binding repository policy without saying so, and its central verifier and review-attestation paths have trust gaps. Several enforcement points also rest on a model session's behavior where a platform check would do.

---

## Blockers

### C-01 🔴 Design overrides binding review and merge policy without saying so, and overclaims "no person in the loop"

- **Scope:** Overview line 11, CUJ 1, G3, Alternative C (lines 301-305), W0-2 (line 679), M0-4 (lines 719-720); `AGENTS.md:69, 81-83, 90-93`; `docs/guiding-principles.md:43, 59`; `docs/steering-merge-authority.md:6-13, 54-60`.
- **Problem:** Repo policy requires human security and acceptance review for high-assurance work, an independent human merge approval, and a human decision for publication; the design's steward App merges `factory-core` and release with no human act, and only partly lists what it overrides. W0-2 cites the wrong `AGENTS.md` lines (62-64 is Branch discipline; the rule is line 69) and misses the same statement in `CLAUDE.md`, `AGY.md`, `CODEX.md`, `defaults/AGENTS.md`, `agent-workflow.md:587` and others. Line 11 promises no person in the loop while the design keeps many recurring human acts.
- **Action:** Add a "Policy changes required" table: each overridden sentence with file, line, replacement rule and who authorizes it, and how a signed delegation maps to the human-decision requirement (including the `requireHumanApproval` value). Replace line 11 with "no per-change human approval" and list the recurring human acts beside it. Finish before any factory-core work is admitted.
- **Sources:** S5 B1; S5 contradictions 5, 6; S7 Blocker "Design depends on agent merge" (K1); S9 "W0-2 cites the wrong `AGENTS.md` lines" (R16). S7 K5 also flags the line 11 overclaim.
- **Severity note:** S5 and S7 rate Blocker; S9 rates its W0-2 part Major.

### C-02 🔴 Pinned verifier runs candidate code while holding the control-repository credential, and its trigger is unresolved

- **Scope:** Trust boundaries table (lines 221-228), Components "Pinned verifier" (line 182), Open Questions (line 74), G4, M2-1 and M2-2 (lines 798-802).
- **Problem:** The holdout runner, no-op check and post-merge suite execute PR-controlled code in a hosted job that also holds the control-repo read credential, so candidate code can read or exfiltrate holdouts or the credential (the "pwn request" shape of `pull_request_target`). G4's negative test covers only the builder token. The `pull_request_target` versus org-level required workflow choice is left open, though it is really a job-separation decision.
- **Action:** State the separation at architecture level: a credential-less, network-less job runs candidate code and emits only artifacts and digests; a credentialed job never runs candidate code outside a network-less sandbox and emits only pass/fail; attestation runs apart from both. Pick the trigger mechanism before approval and add canon cases for reading holdouts or the token from CI.
- **Sources:** S5 B2; S5 F1; S6 #2; S7 "The verifier's placement is unresolved" (K12). S9 R5 also raises the open trigger choice (mapped to C-08).
- **Severity note:** The catalyst rated Blocker; the zoom-out lens (S5), S6 and S7 rated Major. S5 chose Blocker because the hole defeats G4.

### C-03 🔴 The review attestation has no defined path from reviewer sandbox to required check

- **Scope:** Lines 183, 203, 213, 221-228, 232, G4.
- **Problem:** The reviewer runs in a credential-less sandbox on the author's host, yet the signing seam says only hosted CI signs machine evidence. Nothing says who takes the attestation out, who signs and posts it, where it is stored, how the verifier and steward read it, or who holds the reviewer App token. The central merge gate ("bound to the candidate digest") therefore has an unwritten step.
- **Action:** Add the attestation path end to end, with trust-table rows for the reviewer App token holder and the poster. State which component's code the attestation's authenticity rests on.
- **Sources:** S6 #1; S7 "The reviewer is an injectable model gate, and its trust path is incomplete" (K16, trust-path part).
- **Severity note:** S6 rates Blocker; S7 rates Major.

### C-04 🔴 The plan's stated build order is false

- **Scope:** Line 599; M0-1 (709-710), M1-2/M1-3 (755-758), M1-4 (761), M1-5, M1-6, M1-7 (770), M1-12 (784-786), M2b-2/M2b-3 (825, 832).
- **Problem:** Line 599 says items are listed "in the order they can be built", but M1-2 needs M1-3's suite, M1-4 needs M1-5, M1-6, M1-7 and M1-12, and M2b-2 needs M2b-3. M0-1's "finds nothing" test goes red until M0-2 deletes three unexempted modules, so CI fails between them.
- **Action:** Reorder the items, or state each dependency with an interim stub. Exempt the three modules M0-2 deletes, or merge M0-1 and M0-2 into one PR.
- **Sources:** S9 "The stated build order is false" (R1); S6 #19.
- **Severity note:** S9 rates Blocker; S6 rates Major.

### C-05 🔴 M1 reads the control repository before the reader exists

- **Scope:** W0-15 (698), M1-8 (772-775), M1-10 (779), M1-13, M2-1 (797).
- **Problem:** M1-8 and M1-10 read the control-repo pause flag and check-ins, and the M1-exit gate re-runs against it, but `control-repo-reader.mjs` is M2-1, and verifying signed check-in tags needs the signing seam from M1-13. No interim read path, credential or fail-closed rule is given.
- **Action:** Move M2-1 ahead of M1-8, or specify the interim read path (command, credential, failure mode).
- **Sources:** S9 R2.

### C-06 🔴 The circuit breaker cannot write the pause flag or open a revert as specified

- **Scope:** M2b-4 (833-834); Open Questions text on the pause flag.
- **Problem:** The breaker "trips pause and kill", but the pause flag is author-writable only and no App has control-repo write access. A hosted `post-merge.yml` cannot open a revert "through the steward" because the steward App key is held on the host.
- **Action:** State both mechanisms, for example: the workflow reports the failure, and the host coordinator performs the revert and the local pause.
- **Sources:** S9 R3. Related: C-22 (revert path), C-24 (halt precedence).

### C-07 🔴 M1-14's demo depends on M3 and M4 components

- **Scope:** M1-14 (790), M5-6 (879-880), Verification Plan line 914.
- **Problem:** The demo runs to "an evidence bundle to a trace-matrix row", which are M3-1 and M4-1. M5-6 expects the demo to show a rejected tampered bundle, but no M3 or M4 row modifies `scripts/demo-skeleton.mjs`.
- **Action:** Scope M1-14 to what exists at M1, and add Modify rows for the demo script and test in M3-4 and M4-1.
- **Sources:** S9 R4.

### C-08 🔴 The pinned verifier's artifact, digest rule and validator refactors are undefined

- **Scope:** M2-2 (800-802), M1-12 (786), Open Questions line 74.
- **Problem:** `pin-verifier.mjs` "builds the release artifact and prints its digest" without saying what the artifact is, what is hashed or how `verifier.digest` is compared. `verify-pr.mjs` "imports the validators as functions", but only `validate-pr-manifest.mjs` gets an import-safety refactor; about 37 validators use `process.exit` or `process.argv`.
- **Action:** Define the artifact and digest rule, record the trigger decision (see C-02) here, count the validators the verifier needs, and list each pure-function refactor.
- **Sources:** S9 R5; S5 M7 (validator-refactor part).
- **Severity note:** S9 rates Blocker; S5 rates its part Major.

### C-09 🔴 M0-10's "fencing" wording rule cannot pass, and the row cites a false fact

- **Scope:** M0-10 (739-743), Verification Plan line 908.
- **Problem:** Line 742 cites "six 'fencing' mentions in `scripts/validate-docs.mjs`"; two reviewers found none. About 213 occurrences in 59 files exist, many outside the M0-10 list (for example `lib/core/role-collaboration.mjs`, `docs/agent-workflow.md`). The rule does not say whether it scans prose only or also code and tests, so `validate:claims` fails at M0 exit.
- **Action:** Define the scanned file set and how exempt categories are identified, list the missing prose files, and correct the `validate-docs.mjs` claim. Decide C-56 (whether to rename at all) first.
- **Sources:** S9 R6.

### C-10 🔴 M0-9's deletion has no usable path list and misses importers, config and CLI handlers

- **Scope:** M0-9 (731-738), plan header (599), line 23.
- **Problem:** Rows list families, not paths, and deleting them breaks `validate:release`: unlisted tests import deleted modules (`seat-table`, `quota-policy`, `three-mode-equivalence`, oracle tests), `agent-workflow.config.json` lists deleted files in `delivery.candidate.inputs` and `delivery.checks`, and four of seven `HOLD_COMMANDS` would import a deleted file. The `lib/bridge` row names modules that do not exist (`intake`, `status`, `start`, replay are functions in `bridge.mjs`; `slice-worktrees` lives in `lib/runtime/`), omits `memory-queue.mjs` and the `reconcile` verb.
- **Action:** Enumerate every path, importer and config entry as an explicit Modify or Delete row, give a keep-list for `bin/cli.mjs` handlers and bridge verbs, and correct the file names.
- **Sources:** S9 R7 (Blocker); S9 "M0-9 `lib/bridge` row names a nonexistent file" (R28, Major); S8 N-8 (Nit).
- **Severity note:** The three sources rate different parts Blocker, Major and Nit.

### C-11 🔴 M0-9's `agentflow/**` trim conflicts with the distribution generator and `validate-seats`

- **Scope:** M0-9 rows at 732 and 735.
- **Problem:** `generate-execution-distribution.mjs` rewrites the distribution paragraph into every bundle's `CULTURE.md` and fails on drift, so removing it by hand fails the gate; `agentflow-eval` is not in the generator's list. `validate-seats.mjs` fails if `CULTURE.md`, `README.md` or `OPENRIG.md` is missing, and the plan does not say they survive.
- **Action:** Name the kept files and specify the generator change.
- **Sources:** S9 R8.

### C-12 🔴 M2b-2's steering-bundle deletion leaves live references

- **Scope:** M2b-2 (828-830).
- **Problem:** Deleting `adapters/openrig/agentflow-steer/**` leaves references in `seat-table.test.mjs`, the generator, `agent-workflow.config.json:176-177` and the manifest `rigs` array; `OPENRIG_SESSION_NAME` appears in 29 files outside the bundle; `seats.json` and the shipped manifests are unlisted. Two Modify rows edit the same two `SKILL.md` files.
- **Action:** List every importer and config entry as a row, confirm which `OPENRIG_SESSION_NAME` uses M0-9 already covers, and merge the two `SKILL.md` rows.
- **Sources:** S9 R9.

---

## Majors

### C-13 🟡 Merge conditions are enforced by the steward's behavior, not by required checks

- **Scope:** Steward component, time-lock, G3, digest bump, merge rules.
- **Problem:** The time-lock and several merge preconditions exist only because the steward model session chooses to honor them; a confused or injected steward can merge early. The steward also gets discretion over when to bump the verifier digest.
- **Action:** Express each merge precondition as a required status check or ruleset the platform enforces; leave the steward only the merge click.
- **Sources:** S5 F2; S7 "Steward discretion and the digest bump" (K13, discretion part).

### C-14 🟡 Coordinator and steward are model sessions holding App tokens, with unclear identity and overlap with existing code

- **Scope:** Components (coordinator, steward, poller), Non-Goal line 61, trust table.
- **Problem:** The coordinator and steward are unattended model sessions on the host holding merge-capable tokens, which contradicts Non-Goal 61. The document does not say whether coordinator, steward and poller are one process or three, or which identity each uses. The coordinator duplicates `actuate-readiness` and `cockpit-coordinator`.
- **Action:** Make the coordinator deterministic code where possible, name one identity per component in the trust table, and extend `actuate-readiness` instead of adding a parallel component.
- **Sources:** S5 M10; S5 F3; S5 contradiction 1; S5 reuse note R-b; S6 #5.

### C-15 🟡 A host compromise reaches every merge-capable token and the intent plane

- **Scope:** Overview line 15, trust boundaries, hardware key.
- **Problem:** All App keys and intent-plane artifacts sit on the one host, so a host compromise gives an attacker merge and steering power, while the Overview says the intent plane is out of reach. The design assumes a hardware key but never checks one is present.
- **Action:** Add the host-compromise case to the threat model, state what it can and cannot reach, and verify the hardware key at launch.
- **Sources:** S7 "Host compromise" (K14); S5 contradiction 2.

### C-16 🟡 The Agy login sits inside the sandbox, and allowlisted hosts form an exfiltration channel

- **Scope:** Sandbox egress allowlist, Agy session login, Alternative S.
- **Problem:** The Agy login credential lives inside the sandbox the untrusted session runs in, and allowlisted hosts can carry data out. Alternative S is rejected on a reason that the chosen design also has.
- **Action:** Keep vendor logins outside the sandbox or scope them per run, state the exfiltration residual risk, and make Alternative S's rationale consistent.
- **Sources:** S5 F8; S7 "Alternative S versus the Agy login" (K22).

### C-17 🟡 The launcher runs git on attacker-writable `.git` metadata on the host

- **Scope:** Launcher, M1 launcher rows.
- **Problem:** After a session the launcher runs host git commands on a worktree whose `.git` config and hooks the sandboxed session could have written, giving code execution on the host.
- **Action:** Read results through a fresh clone or with hooks and config disabled, and add a canon case for planted git metadata.
- **Sources:** S8 N-1.

### C-18 🟡 Declared scope is read from a mutable issue (time-of-check to time-of-use)

- **Scope:** Declared-scope check, issue body, "ready" marking.
- **Problem:** The scope a change is checked against comes from an issue anyone with write access can edit between check and merge.
- **Action:** Snapshot the scope into the signed evidence at dispatch and check against the snapshot. Say who marks an issue ready (raised in S7 K16).
- **Sources:** S5 F13; S7 K16 ("who marks ready" part, cross-referenced).

### C-19 🟡 The WSL2 fallback has the weaknesses the design rejected, and its suite cannot pass honestly

- **Scope:** Substrate section, fallback, substrate isolation suite.
- **Problem:** WSL2 shares the kernel and filesystem bridges the design cites as reasons to reject other options, so the isolation suite either fails on it or is weakened to pass.
- **Action:** State the fallback's reduced guarantees and which autonomy level it allows, or drop it as a second implementation.
- **Sources:** S5 F9; S7 "Fallback substrate" (K11).

### C-20 🟡 Digest pin and npm release are human acts, against "unconditional agent merge including release"

- **Scope:** G3, release flow, `verifier.digest`.
- **Problem:** The design promises unconditional agent merge including release, yet the verifier digest pin and npm publish remain human acts, and who bumps the digest is unclear.
- **Action:** Pick one: list these as recurring human acts, or specify the automated path and its guard.
- **Sources:** S5 F10; S6 #6; S7 K15 (release part); S7 K13 (digest part).

### C-21 🟡 The pre-merge gate omits canon and the full suite

- **Scope:** Pre-merge gate, post-merge suite.
- **Problem:** Canon cases and the full suite run only after merge, so a change that breaks them lands first and must be reverted.
- **Action:** Run canon and the full suite in the merge queue before merge, or justify the split with a cost figure.
- **Sources:** S5 F5; S7 K15 (pre-merge part).

### C-22 🟡 The revert path is unspecified

- **Scope:** Post-merge failure handling, time-lock, steering identity.
- **Problem:** A revert must pass the same time-lock, the steering identity cannot author commits, and stacked or conflicting merges are not handled.
- **Action:** Specify who authors the revert, whether it bypasses the time-lock, and what happens with stacked merges and conflicts.
- **Sources:** S5 F4; S7 K15 (revert and stacking part). Related: C-06.

### C-23 🟡 Infrastructure-versus-change failure classification can be gamed, and there is no flake policy

- **Scope:** Failure classifier, retries.
- **Problem:** A change that makes its failure look like infrastructure gets retried instead of rejected, and flaky tests have no rule.
- **Action:** Define the classifier's inputs outside the candidate's control, bound retries, and add a flake quarantine rule.
- **Sources:** S5 F6; S7 K15 (classifier and flake part).

### C-24 🟡 The new circuit breaker is not reconciled with the existing breaker, freeze and pause

- **Scope:** Halt controls; existing breaker and freeze code; two pause authorities.
- **Problem:** The design adds a breaker, pause flag and kill switch beside existing breaker and freeze mechanisms without stating which wins or how they map, and two components can pause.
- **Action:** Add a halt-precedence table and reuse or retire the existing mechanisms.
- **Sources:** S8 N-6; S5 F18.
- **Severity note:** S8 rates Major; S5 rates its part Nit.

### C-25 🟡 Nobody is assigned to write holdouts and canon

- **Scope:** Control repository, holdouts, canon.
- **Problem:** The design depends on holdouts and canon the builder cannot see, but does not say who writes them, how often, or how they stay out of model sessions.
- **Action:** Name the author role, cadence and storage rule.
- **Sources:** S5 F7.

### C-26 🟡 The "implemented" ledger bar checks reachability, not effect

- **Scope:** Claims ledger, reachability audit.
- **Problem:** A claim counts as implemented when code is reachable from a core API, which does not show the code does what the claim says.
- **Action:** Require a named test per claim that exercises the behavior.
- **Sources:** S5 F11.

### C-27 🟡 The audit extension misses new directories, and M0-1's blast radius is understated

- **Scope:** M0-1, `CORE_API_PREFIXES`, `adapters/**`.
- **Problem:** The extended reachability audit does not cover the new directories or `adapters/**`, and M0-1 changes more callers than the plan says; the plan also contradicts itself on whether test callers count.
- **Action:** List the covered prefixes and every affected caller, and state the test-caller rule once.
- **Sources:** S8 N-3; S9 R22.

### C-28 🟡 Deleting `handover-protocol.test` strands `context-sanitizer`

- **Scope:** M0-2 deletion rows.
- **Problem:** `context-sanitizer` loses its only test when `handover-protocol.test` is deleted, so coverage drops silently.
- **Action:** Move the relevant cases into a `context-sanitizer` test, or delete the module too.
- **Sources:** S9 R21.

### C-29 🟡 The watchdog runs on the host it monitors, and its alert channel is unchosen

- **Scope:** Dead-man check-in, watchdog.
- **Problem:** If the host dies, its watchdog dies with it, and no alert channel is chosen.
- **Action:** Run the dead-man check from hosted CI on a schedule and pick the alert channel.
- **Sources:** S5 F12.

### C-30 🟡 Pause and resume are undefined after a checkpoint retraction

- **Scope:** CUJ 4, checkpoints, issue-comment state.
- **Problem:** CUJ 4 says a checkpoint can be retracted, but resume behavior is undefined, and "conditional append" to issue comments is not something GitHub supports.
- **Action:** Define resume semantics and store state where a conditional write exists (for example a ref or the control repo).
- **Sources:** S5 F14; S5 contradiction 7; S7 "Idempotent resume and conditional append" (K20).

### C-31 🟡 Config authority is fragmented against `modular-architecture` and `validate:authority`

- **Scope:** Control-repo config, path classes, delegation.
- **Problem:** New config lives in several places, against the single-authority rule that `validate:authority` enforces.
- **Action:** Name one authority per setting and show how `validate:authority` checks it.
- **Sources:** S5 F15.

### C-32 🟡 Vendor terms have no named fallback, and quota and cost are unquantified

- **Scope:** Vendor sessions, terms-of-service risk, quota.
- **Problem:** Unattended use of subscription CLIs may breach vendor terms, and no fallback or no-go rule is named; run quota and cost are not estimated.
- **Action:** Name the fallback per vendor and the condition that triggers it, and give a cost and quota estimate per run and per month. Settle before the M1 launcher.
- **Sources:** S5 M5; S6 #16; S7 "Quota, cost and vendor terms" (K17).

### C-33 🟡 G5 offline verification is not backed by the design

- **Scope:** G5, signing seam, line 49.
- **Problem:** G5 promises offline, back-dating-proof verification without the author's keys, but RFC 3161 timestamps are optional, GitHub attestation verification is online, and the `gh` dependency and trusted root are unstated.
- **Action:** Make the timestamp mandatory or weaken G5, and state the verifier's offline inputs and trusted root.
- **Sources:** S5 contradictions 3, 4; S5 M6 (`gh` part); S6 #15; S7 "G5 timestamp and keys" (K18). The garbled G5 sentence is C-91.

### C-34 🟡 Platform availability and defaults are assumed

- **Scope:** Public `calibration-logbook`, attestations, merge queue.
- **Problem:** The logbook defaults to public, private-repo attestations need GitHub Enterprise, and merge queue may not be available on a personal account (S7 could not verify this last point).
- **Action:** Confirm each feature for the actual account type and name the fallback; make the logbook private by default.
- **Sources:** S5 M6 (open questions and public logbook part); S7 "Merge queue and org features" (K19).

### C-35 🟡 G1's website enforcement is optional

- **Scope:** G1, website check.
- **Problem:** G1 claims enforcement, but the website check is marked optional.
- **Action:** Make the check required or narrow G1.
- **Sources:** S8 N-4.

### C-36 🟡 "Two implementations per port" is false for signing

- **Scope:** Ports, signing seam, conformance claim.
- **Problem:** The design claims each port has two implementations that pass conformance, but the signing seam has one.
- **Action:** Add the second implementation or drop the claim for signing.
- **Sources:** S6 #8; S8 N-5.

### C-37 🟡 Scope far exceeds the month-6 claim

- **Scope:** Whole document; Goals, milestones M0-M5.
- **Problem:** The design bundles substrate, verifier, control repo, ledger, signing, halt controls and autonomy ladder into one effort that S5 judges well beyond what fits the stated six months.
- **Action:** Split into tiers: a minimum governed loop first, later tiers gated on its evidence.
- **Sources:** S5 M1.

### C-38 🟡 The plan, 43 alternatives and deviation history are embedded in the spec

- **Scope:** Alternatives section, deviations history, plan at lines 597-916.
- **Problem:** The spec carries the full implementation plan, 43 alternatives and a change history, which buries the decisions a reviewer must approve.
- **Action:** Move the plan and history to separate files and keep only the alternatives that shaped a decision.
- **Sources:** S5 M2.

### C-39 🟡 The brief is untracked, codes are undefined, and the decision range is stated three ways

- **Scope:** Header, decision references (D-codes), line 23.
- **Problem:** The design cites a brief that is not in the repo, uses codes it never defines, and gives the decision range as D22, D26 and D29 in different places.
- **Action:** Commit or summarize the brief, define every code on first use, and state one decision range.
- **Sources:** S5 M3; S5 contradiction 8 (D-range part); S5 F19 (part); S6 #12; S7 "Undefined codes" (K3); S7 "Decision range stated three ways" (K4).

### C-40 🟡 Rejection rationales are attributed to the author on unverified premises

- **Scope:** Alternatives ("Rejected by author", about 42 entries; Alternatives P, T, V).
- **Problem:** Many alternatives are closed as "Rejected by author" with no reason, and some reasons rest on facts nobody checked.
- **Action:** Give each rejection a technical reason, and verify or mark as unverified the premises in P, T and V.
- **Sources:** S7 "Rejection rationales" (K2); S5 Z-N5.
- **Severity note:** S7 rates Major; S5 rates its part Nit.

### C-41 🟡 Week 0 is overloaded and front-loads throwaway work

- **Scope:** Week 0 (W0-1 to W0-19), ADRs, run cap.
- **Problem:** Week 0 holds about 19 items including throwaway code and ADRs written before the spikes that should inform them; it is not time-boxed; a new run cap duplicates the existing quota mechanism.
- **Action:** Time-box Week 0, run spikes before ADRs, and reuse the existing quota for the run cap.
- **Sources:** S5 M4; S5 F16; S5 reuse note R-a.
- **Severity note:** S5 rates M4 Major and F16 Nit.

### C-42 🟡 Milestones are not defined, and there is no schedule or critical path

- **Scope:** Spec references to M0-M5; timeline.
- **Problem:** The spec uses milestone names before defining them, and gives no dates, durations or critical path.
- **Action:** Define milestones in the spec with exit criteria and a rough schedule.
- **Sources:** S6 #11; S7 "No schedule" (K21); S5 Z-N4.
- **Severity note:** S6 and S7 rate Major; S5 rates the timeline part Nit.

### C-43 🟡 The self-build and bootstrap sequence is unspecified

- **Scope:** "N-1 governs N", first verifier digest, M2.
- **Problem:** The factory is meant to build itself, but the document never says how the first verifier digest is produced or which work runs before the factory governs itself.
- **Action:** Add a bootstrap section: who produces digest zero, and the point at which self-governance starts.
- **Sources:** S6 #3; S8 N-7.

### C-44 🟡 `factory-core` and the path-class terms are undefined

- **Scope:** Path classes, `factory-core`, M0-4.
- **Problem:** Rules depend on `factory-core` and other path classes, but no file list or glob defines them, and class names are used inconsistently.
- **Action:** Define each class with its globs in one table.
- **Sources:** S8 N-2; S6 #14.

### C-45 🟡 Overview and Non-Goals are stale

- **Scope:** Overview lines 11-16 (WSL2 at line 16), Non-Goal line 61, credential claim.
- **Problem:** The Overview still names WSL2 as the substrate and says no credentials reach the host session; Non-Goal 61 contradicts the body.
- **Action:** Rewrite the Overview and Non-Goals after the body settles.
- **Sources:** S6 #7; S7 "Overview, Non-Goals and substrate overclaim" (K5). The line 11 part of K5 is under C-01.

### C-46 🟡 Planned behavior is written as present fact

- **Scope:** Spec body (examples cited in S7).
- **Problem:** Many sentences describe components that do not exist yet in the present tense, so readers cannot tell what exists today.
- **Action:** Use future tense or a "planned" marker for unbuilt behavior.
- **Sources:** S7 "Planned behavior as present fact" (K6).

### C-47 🟡 The line-29 claim about today's code is too broad

- **Scope:** Line 29.
- **Problem:** The claim about what the current code does overstates it, per S7's check.
- **Action:** Narrow the claim to what was verified, with file references.
- **Sources:** S7 "Today's-code claim too broad" (K7). See the `lease-fencing` disagreement below.

### C-48 🟡 "About 1,150 lines" does not reproduce

- **Scope:** The deletion-size claim.
- **Problem:** S7 counted 1,318 lines for the same set.
- **Action:** Recount and state the command used.
- **Sources:** S7 "1,150 lines" (K8).

### C-49 🟡 Thresholds and limits are undefined

- **Scope:** Breaker thresholds, soak limits, time-lock duration, run limits.
- **Problem:** Numbers the controls depend on are left blank or "to calibrate", including the time-lock.
- **Action:** Give starting values and the calibration rule for each.
- **Sources:** S6 #13; S7 "Thresholds" (K9); S5 Z-N7.
- **Severity note:** S6 and S7 rate Major; S5 rates the time-lock part Nit.

### C-50 🟡 Risks are not a top-level section, and key risks are missing

- **Scope:** Document structure.
- **Problem:** Risks are scattered, and the host as single point of failure and loss of the signing or App keys are not covered.
- **Action:** Add a Risks section with these two and the mitigations.
- **Sources:** S7 "Risks section" (K10).

### C-51 🟡 "Evaluator" is never defined

- **Scope:** Uses of "evaluator".
- **Problem:** The term appears without saying whether it is the verifier, the reviewer or something else.
- **Action:** Define it or replace it with the component name.
- **Sources:** S6 #4.

### C-52 🟡 "Lane" has three meanings

- **Scope:** Uses of "lane".
- **Problem:** "Lane" means a work queue, an autonomy level and a vendor route in different places.
- **Action:** Keep one meaning and rename the others.
- **Sources:** S6 #9.

### C-53 🟡 Goal and gate terms are ambiguous

- **Scope:** "Goal", `goal.json`, gates.
- **Problem:** "Goal" refers both to the design's G-goals and to a per-run goal file, and gate terms overlap.
- **Action:** Rename one and define each once.
- **Sources:** S6 #10.

### C-54 🟡 OpenRig is never introduced

- **Scope:** OpenRig mentions, M0-9.
- **Problem:** A reader new to the repo cannot tell what OpenRig is or why trimming it matters.
- **Action:** Add a one-paragraph introduction.
- **Sources:** S6 #17.

### C-55 🟡 AgentFlow vocabulary is used without definition

- **Scope:** Role pass, seat, steering and similar terms; informal terms in the plan.
- **Problem:** The spec assumes the reader knows AgentFlow terms; the plan adds informal ones.
- **Action:** Add a short glossary or link the repo's definitions.
- **Sources:** S6 #18; S9 R43.
- **Severity note:** S6 rates Major; S9 rates its plan part Nit.

### C-56 🟡 The fencing rename is high churn for low value

- **Scope:** M0-10.
- **Problem:** Renaming "fencing" touches hundreds of occurrences for a naming gain, competing with the critical path.
- **Action:** Drop the rename or defer it past M0. Decide before fixing C-09.
- **Sources:** S5 M8.

### C-57 🟡 The OpenRig trim sits on the critical path

- **Scope:** M0-9, M2b-2.
- **Problem:** A large deletion blocks the new work though nothing in M1 needs it.
- **Action:** Move the trim off the critical path or run it in parallel.
- **Sources:** S5 M9.

### C-58 🟡 New `lib` code imports from `scripts` (`matchOwnedPath`)

- **Scope:** Declared-scope check, `matchOwnedPath`, layering.
- **Problem:** The plan has `lib` modules depend on a helper in `scripts/`, reversing the layering, and leaves the declared-scope dependency unstated.
- **Action:** Move `matchOwnedPath` into `lib` and state the dependency in the row.
- **Sources:** S5 M7 (layering part); S9 R18; S5 reuse note R-c.

### C-59 🟡 The test plan names files, not cases

- **Scope:** All plan tables, lines 677-891.
- **Problem:** Most rows give only a test file name, and some (`post-merge.yml`, `attest-evidence.yml`, `verify-pr.yml`, `publish.yml`, `egress-allowlist.json` and others) have no test at all.
- **Action:** Add happy-path and edge cases per item, at least for launcher, poller, steward and verifier items.
- **Sources:** S9 R10.

### C-60 🟡 The substrate adapter manifest convention does not exist

- **Scope:** Lines 753, 755, 757.
- **Problem:** Existing adapter manifests use a `harness` key, and `validatePluginManifests` requires harness fields from a closed set; the plan gives no shape for a `kind: substrate` manifest or how it passes validation. Row 757 cites the wrong line.
- **Action:** Give the manifest JSON shape, say how validation treats it, and fix the line reference.
- **Sources:** S9 R11.

### C-61 🟡 Existing digests change with no migration

- **Scope:** Lines 765, 767, 849 (M1-5, M3-5).
- **Problem:** M1-5 changes `providerDigest` and `canonicalJson`, and M3-5 normalizes line endings in oracle and review digests, which invalidates stored and signed digests; five `providerDigest` callers are unlisted. The plan's own Alternative AI names this ordering problem but schedules the fix after M1-13.
- **Action:** State a dual-read or version-tag strategy, list the callers, or move the line-ending fix before M1-13.
- **Sources:** S9 R12.

### C-62 🟡 Receipt and schema changes lack field definitions

- **Scope:** Lines 648-653, 766, 788-789, 850; `lib/core/gate.mjs`.
- **Problem:** The `evaluator` block, attestation schema bump, `trust-policy.schema.json` and `signed-human-act.schema.json` have no field lists or version values. `gate.mjs` must stay pure, and the plan does not say how `satisfyGate` receives the verified signature result.
- **Action:** Add field tables, version values and the injection signature for `satisfyGate`.
- **Sources:** S9 R13; S8 N-11 (core injection seam).
- **Severity note:** S9 rates Major; S8 rates the injection-seam part Nit.

### C-63 🟡 M1-12 breaks existing consumers without listing them

- **Scope:** Lines 784-786.
- **Problem:** Requiring `## Declared scope` in issue validation touches about ten files (issue template, `validate-spec.mjs`, cockpit modules, delivery policy, docs, fixtures), none listed; whether the rule is profile-gated is unsaid.
- **Action:** List every touched file and state the profile-gating and warn-versus-fail rule.
- **Sources:** S9 R14.

### C-64 🟡 New docs, manifests and ADRs are not all registered

- **Scope:** Lines 610-611, 688, 693, Create rows.
- **Problem:** About 14 new docs are never linked from `docs/index.md`, so `validate:docs` fails; ADR 027 is created but never registered; most new shipped `lib` files are not in the npm or payload manifests. Line 610 overstates what `validate:npm` checks.
- **Action:** Add a registration row per milestone and correct line 610.
- **Sources:** S9 R15. S6 #21 (ADR 027 counting part) cross-referenced.

### C-65 🟡 Design values are left to the implementer

- **Scope:** Lines 700-878 (launcher, M1-6, M1-8 to M1-10, M2-6, M2b-2, M3-2/3, M4-2/3, M5-3, W0-17, W0-19, M0-3).
- **Problem:** Under the Zero-Decision Rule the plan still leaves timeouts, budgets, config keys, schemas, host lists, predicate URIs, clause mappings and version values open, and M2b-2 gives an investigation instead of an instruction.
- **Action:** Decide each value in the plan, or mark the item spike-first with its output recorded before it opens.
- **Sources:** S9 R17.

### C-66 🟡 The `box` verb is registered before it exists, and M1-4 breaks the Week-0 gate

- **Scope:** Lines 689-691, 698, 764.
- **Problem:** W0-12 registers `box gate` though its script arrives in W0-15, and no dispatcher is named. M1-4 deletes `guarded-run.mjs`, which the Week-0 gate re-run at M1 exit depends on, without listing the gate script.
- **Action:** Move the registration to W0-15, name the dispatcher, and add the gate script and test to M1-4.
- **Sources:** S9 R19.

### C-67 🟡 `lib/sparring.mjs` does not exist

- **Scope:** Line 767 (M1-5).
- **Problem:** The file is `lib/core/sparring.mjs`; the wrong path would fail the write allowlist.
- **Action:** Correct the path and add its test.
- **Sources:** S9 R20.

### C-68 🟡 M0-11's model routing cannot work as written

- **Scope:** Lines 744-745, 909; `lib/config/execution-distribution.mjs`.
- **Problem:** The loader takes one module-level profile and rejects other models and profiles, so a Claude-and-Agy profile fails; the Gemini replacement tuple and Agy and Pi routes are not given, and the drift check is ambiguous.
- **Action:** Specify the loader change, the replacement tuple, the Agy and Pi routes, and the drift check.
- **Sources:** S9 R23; S8 N-9 (Pi, Gemini and Grok routing).
- **Severity note:** S9 rates Major; S8 rates its part Nit.

### C-69 🟡 W0-14 and M1-10 re-implement code that already exists

- **Scope:** Lines 694-697, 779.
- **Problem:** `guarded-run.mjs` re-implements process-tree kill that `lib/qa/process-supervisor.mjs` already provides; `run-cap` exports become unreachable; "coordinator" and `run pause`/`resume` collide with existing names. M1-10's intake poll duplicates `bridge.mjs`'s ready-predicate and claim logic.
- **Action:** Reuse `killProcessTree` and `callSourceCapability`, add a CLI path or exemption for `run-cap`, and resolve the name collisions.
- **Sources:** S9 R24; S9 R25.

### C-70 🟡 W0-19 misdescribes `goal.json`

- **Scope:** Line 702.
- **Problem:** `goal.json` holds only version, title, body and created date; `kind`, `parent` and `change-class` are command flags, not goal fields.
- **Action:** Say where each value is recorded.
- **Sources:** S9 R26.

### C-71 🟡 The M1-8 `seat-lease.mjs` row has no action and a wrong line reference

- **Scope:** Line 775.
- **Problem:** `claimSeatLease` already accepts `allowSupervisory` and the guard is at lines 50-54, not 48-52; the row names no change.
- **Action:** Specify the change and how the coordinator proves supervisory authority.
- **Sources:** S9 R27.

### C-72 🟡 The plan header's claims are not true of the tables

- **Scope:** Line 599 (rows 731-738, 761-764, 767, 774-775, 802, 833); line 23.
- **Problem:** "Each lists its tests in the same row" and "each is one focused PR" are false for several rows (M0-9 deletes about 3,100 lines); "Paths were checked" conflicts with wrong paths elsewhere.
- **Action:** Reword to what is true, add the missing tests, and split M0-9 or mark it as an exception.
- **Sources:** S9 R29; S5 contradiction 8 ("Paths were checked" part); S5 Z-N3 ("order they can be built" part).

### C-73 🟡 A local workstation path is published in the document

- **Scope:** Line 889 (X-3); milder case at line 693.
- **Problem:** Line 889 contains a drive letter, user name and local layout, against the repo's "Never Leak Local State" principle; line 693 names a home-relative install path.
- **Action:** Name the repository by role and say only "installed in WSL" at line 693.
- **Sources:** S9 R30; S5 contradiction 9; S5 F19 (local-path part).

### C-74 🟡 M0-4 findings are not attributed to files

- **Scope:** Line 721.
- **Problem:** One row lists three files and then line numbers without saying which belongs to which.
- **Action:** Split the row or prefix each finding with its file (S9 gives the mapping).
- **Sources:** S9 R31.

### C-75 🟡 The "24 MUST or INVARIANT lines" count is disputed and load-bearing

- **Scope:** Line 713, ledger rule at 714.
- **Problem:** Two S9 reviewers count 22 in the cited ranges; a third says 24 is verified. The ledger validator requires one row per keyword line, so the number matters.
- **Action:** Recount with a script and cite the full line set.
- **Sources:** S9 R32; S9 R51 (residual conflicting citation).
- **Severity note:** S9 rates R32 Major and R51 Nit.

### C-76 🟡 Pass and decision criteria cannot be measured

- **Scope:** Lines 806, 876, 898.
- **Problem:** "Performs acceptably" drives the substrate go/fallback decision with no metric; M2-4 and M5-3 likewise name no measure or target.
- **Action:** Name the measure and limit for each, or drop the clause.
- **Sources:** S9 R33.

---

## Nits

All 🟢 Nit. Each row gives the problem and the fix in one cell.

| ID    | Title                                        | Scope                                                                     | Problem and action                                                                                                                                                                                         | Sources                                                                   |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| C-77  | Claims ledger keyed by line number           | G1, ledger                                                                | Rows keyed by line break on every edit; key by claim ID instead.                                                                                                                                           | S5 Z-N1                                                                   |
| C-78  | Directory sprawl                             | New `lib/*` directories                                                   | Many new top-level directories for small modules; group them.                                                                                                                                              | S5 Z-N2                                                                   |
| C-79  | Duplicate IDs and M5 order                   | Lines 677, 879-881                                                        | W0-1 and W0-14 appear twice; M5-6 precedes M5-4 and M5-5 is missing. Renumber and reorder.                                                                                                                 | S5 Z-N3 (IDs part); S9 R34; S5 contradiction 8 (M5-5 part); S5 F19 (part) |
| C-80  | Draft status and line 23                     | Header, line 23                                                           | Status still "Draft"; line 23 says files are listed "at the author's choice" and that milestone changes are recorded in the spec, so it changes during execution. Set status and record changes elsewhere. | S5 Z-N6; S7 "Line 23 commits the spec to edits" (K26)                     |
| C-81  | Soak statistics are weak                     | G3, soak                                                                  | "Zero escapes" over about 20 issues has little power, and egress logs see only network escapes. State the confidence and other escape detectors.                                                           | S5 F17; S7 "Soak statistics" (K25)                                        |
| C-82  | Check-in and kill terms                      | Halt controls                                                             | Check-in and kill terms are used loosely; define each once.                                                                                                                                                | S6 #20                                                                    |
| C-83  | Counts disagree                              | Spikes, tamper cases, ADRs                                                | Spikes counted as 3 and 4, tamper cases as 4 and 5, ADR 027 range mismatch. Fix the counts.                                                                                                                | S6 #21 (ADR 027 registration is C-64)                                     |
| C-84  | "Launcher" has two meanings                  | Launcher mentions                                                         | Used for both the host process and the CLI verb; rename one.                                                                                                                                               | S6 #22                                                                    |
| C-85  | Small terms undefined or defined only inline | "Case A / case B" (line 52), trusted root (258, CUJ 5), other small items | Define in a glossary or on first use.                                                                                                                                                                      | S6 #23; S7 "Terms defined only inline" (K40)                              |
| C-86  | Watchdog and morning digest never defined    | Lines 77, 262, 175-192                                                    | Absent from component table, diagram and flow; add them.                                                                                                                                                   | S7 K23                                                                    |
| C-87  | Kill-switch latency ambiguous                | G2, line 196                                                              | "Under 10 seconds" fits a local kill; remote pause latency is tick-bound and unstated. State both.                                                                                                         | S7 K24                                                                    |
| C-88  | Unsourced facts and figures                  | Lines 31, 35, 255, 292, 436, 556, 563                                     | Incident list, CVE count, "24-37 weeks" and "3,100 lines" lack sources; cite or remove.                                                                                                                    | S7 K27                                                                    |
| C-89  | Subjective wording                           | Lines 19, 27, 37, 296, 399, 535-538, 581                                  | Evaluative claims and inconsistent "none targets" wording; make them factual.                                                                                                                              | S7 K28                                                                    |
| C-90  | "Three gaps" versus four problems            | Line 27 vs 29-35                                                          | Make the count match.                                                                                                                                                                                      | S7 K29                                                                    |
| C-91  | G5 sentence garbled                          | Lines 49-50, 108                                                          | "Does not change with every integration package and the network removed" is unclear; rewrite.                                                                                                              | S7 K30 (S6 #15 notes the same sentence at line 49)                        |
| C-92  | Spec breaks its own "supports" rule          | Lines 19, 50, 57 vs 45                                                    | Uses "supports" without ledger rows; reword.                                                                                                                                                               | S7 K31                                                                    |
| C-93  | Filler and forward references                | Lines 19, 21                                                              | Process narrative and "named reference stack" before naming it; cut or reorder.                                                                                                                            | S7 K32                                                                    |
| C-94  | Same facts repeated                          | Lines 197/209/240, 254/555, 255/556, 236/568, 234/569, 72/256             | State each fact once and refer back.                                                                                                                                                                       | S7 K33                                                                    |
| C-95  | Alternatives structure and labels            | Lines 287, 311, 409-413, 289-545                                          | Alternative U labelled rejected but not rejected; unverifiable "first seven" intro; AG-AQ are review decisions. Fix labels and move AG-AQ.                                                                 | S7 K34                                                                    |
| C-96  | "Fencing" used after retraction              | Line 311 vs 278                                                           | Remove the retracted word.                                                                                                                                                                                 | S7 K35                                                                    |
| C-97  | `role-flow-span` both retired and re-pointed | Line 250                                                                  | Say whether it is deleted or kept (S5 reuse note R-e says retire it).                                                                                                                                      | S7 K36                                                                    |
| C-98  | Formatting inconsistencies                   | Lines 7, 184, 302-303, 435-547, 894-914; plan table rows                  | Mixed `-` and `*` bullets, varying rules, unpadded rows. Run Prettier and use one marker.                                                                                                                  | S7 K37; S9 R40; S9 R41; S5 Z-N3 (bullet part)                             |
| C-99  | Headings differ from the standard            | "The Problem", "Technical Plan", Goals sections                           | Rename to the standard's headings.                                                                                                                                                                         | S7 K38                                                                    |
| C-100 | Heading at line 670 omits Delete rows        | Line 670                                                                  | Rename to "Files to create, modify or delete".                                                                                                                                                             | S9 R42                                                                    |
| C-101 | Trust table omits reviewer's model login     | Line 225                                                                  | Add it to the reviewer sandbox row.                                                                                                                                                                        | S7 K39                                                                    |
| C-102 | Line-number drift                            | Lines 604, 710, 735, 775, 779 and others                                  | About 15 references off by a few lines; update or anchor on names.                                                                                                                                         | S9 R35                                                                    |
| C-103 | `.agentflow/gates/` path collision           | W0-15, M1-9                                                               | Two features share the directory; separate them.                                                                                                                                                           | S9 R36                                                                    |
| C-104 | `sdlc validate-claims` needs a handler       | Line 716                                                                  | Add the `handleSdlc` branch to the row.                                                                                                                                                                    | S9 R37                                                                    |
| C-105 | M2-3 restates an existing mapping            | Line 805                                                                  | `modelFamily` already maps Gemini to Google; state the real change.                                                                                                                                        | S9 R38                                                                    |
| C-106 | Rows mix Create and Modify                   | Lines 723, 725, 823                                                       | Split the rows.                                                                                                                                                                                            | S9 R39                                                                    |
| C-107 | Filler words in the plan                     | Lines 697, 759, 804                                                       | Cut "deliberately" and "actually".                                                                                                                                                                         | S9 R44                                                                    |
| C-108 | Unclear sentence                             | Line 807                                                                  | "And no window" is unclear; say what is missing.                                                                                                                                                           | S9 R45                                                                    |
| C-109 | First person                                 | Line 897                                                                  | Rewrite in third person.                                                                                                                                                                                   | S9 R46                                                                    |
| C-110 | Re-verify rule repeated                      | Lines 599, 702, 733, 740                                                  | Keep it once; drop the repeat at 733 (conflicts with C-10).                                                                                                                                                | S9 R47                                                                    |
| C-111 | Size targets not stated as limits            | Lines 697, 732                                                            | Say whether "about 100" and "about 900 lines" are limits.                                                                                                                                                  | S9 R48                                                                    |
| C-112 | `sbx` spike has no output path               | Line 898                                                                  | Add a script or notes path.                                                                                                                                                                                | S9 R49                                                                    |
| C-113 | Unbounded evidence phrases                   | Lines 723, 914                                                            | Bound the recording length; record the `agy` version.                                                                                                                                                      | S9 R50                                                                    |
| C-114 | G8 metric undefined                          | G8                                                                        | Give G8 a measurable metric.                                                                                                                                                                               | S8 N-10                                                                   |

---

## Disagreements and known report errors

**Severity disagreements** are noted under each item (C-01, C-02, C-03, C-04, C-10, C-24, C-40, C-41, C-42, C-49, C-55, C-62, C-68, C-75).

**Reviewer disagreements on facts**

- `lease-fencing` importer: S7 `egm-style` (K7) says `handover-protocol` imports it; the S5 zoom-out lens and the S7 design and structural lenses found no non-test importer. Recheck before rewriting line 29 (C-47).
- MUST/INVARIANT count: S9 style and implementation-readiness count 22; S9 codebase-details says 24 is verified (C-75).
- `vitest.config.mjs:7` (line 604): S9 codebase-details says the line is 8; S9 style says it matches (C-102).
- ADR 016 "section 9": S9 found no such heading, then a later S9 check found ADR 016 decision 9 exists (C-01).
- G5 garbled sentence: S6 cites line 49; S7 cites lines 50 and 108 (C-91).
- "Rejected by author": S7 counts about 42; S5 counts 43 alternatives (C-38, C-40).

**Claims a reviewer could not verify**

- Merge queue and org-only features on a personal account (S7 K19, C-34).
- Premises behind Alternatives P, T and V (S5 Z-N5, C-40).

**Internal errors the reports state about themselves**

- S5: the catalyst's severity scale caps at Major, yet it rated F1 Blocker; the zoom-out lens rated the same defect Major.
- S5: M10 cites a "consolidated item C3 in Section 4" that does not exist.
- S5: B2 says the zoom-out lens raised it as "M1", but zoom-out M1 is the scope finding.
- S5: IDs M11 and M12 are intentionally unused; Section 4 aliases (M13-M25, N1-N10) restate earlier items and are not counted as separate rows.
- S7 and S8: persona file names did not match the reviewer names used.
- S7: reviewed lines 1-596 only, and `egm-style` did not read the feature-spec standard.
- S6: no reviewer status table.
- S8: re-reviewed an unchanged file; its carried-over items are not new findings.
- S9: R47 states its own conflict with the R7 Blocker; R51 is a residual note with no separate action.

---

## Suggested order of work

1. **C-01**: write the policy-changes table and get the human decision; it gates all `factory-core` work.
2. **C-02, C-08, C-03, C-13**: settle the verifier job split, trigger, attestation path and platform-enforced merge checks (after 1).
3. **C-14 to C-18**: fix trust boundaries for coordinator, steward, host, sandbox logins, launcher git and declared scope (after 2).
4. **C-32, C-34**: confirm vendor terms, quota and platform features before any M1 launcher work.
5. **C-37 to C-40, C-56, C-57**: tier the scope, move the plan and history out, and decide the fencing rename and OpenRig trim timing.
6. **C-43, C-44, C-42**: define bootstrap, path classes and milestones (after 5).
7. **C-19 to C-31**: close the fallback, release, pre-merge, revert, classifier, halt, holdout, ledger, watchdog, resume and config gaps (after 2 and 6).
8. **C-04 to C-07**: reorder the plan and stub dependencies so each item builds in sequence (after 5-7).
9. **C-09 to C-12**: enumerate M0 allowlists, importers and config entries; re-run `validate:release` against them (after 5 and 8).
10. **C-58 to C-76**: fill the plan's file lists, schemas, values, tests and line references.
11. **C-33, C-35, C-36, C-45 to C-55**: align goals, Overview and vocabulary with the settled body.
12. **C-77 to C-114**: Nits, then run Prettier on the file.

---

## Traceability Matrix

One row per raw finding. Stage 7 findings have no IDs in the source, so they are numbered K1-K40 here in report order (Blocker, Majors, Nits). Stage 9 findings are numbered R1-R51 in report order. A row with two consolidated IDs was split across items.

### Stage 5 (`zoom_out_report.md`)

| Stage | Original ID / title                                                | Original severity | Consolidated                           |
| ----- | ------------------------------------------------------------------ | ----------------- | -------------------------------------- |
| S5    | B1 Governing docs contradicted                                     | Blocker           | C-01                                   |
| S5    | B2 Verifier runs candidate code with credential                    | Blocker           | C-02                                   |
| S5    | M1 Scope beyond month-6 claim                                      | Major             | C-37                                   |
| S5    | M2 Embedded plan and history                                       | Major             | C-38                                   |
| S5    | M3 Brief untracked, D-range                                        | Major             | C-39                                   |
| S5    | M4 Week 0 overloaded                                               | Major             | C-41                                   |
| S5    | M5 Vendor terms fallback                                           | Major             | C-32                                   |
| S5    | M6 Open questions, public logbook, `gh`                            | Major             | C-34, C-33                             |
| S5    | M7 Layering and validator refactors                                | Major             | C-58, C-08                             |
| S5    | M8 Fencing rename churn                                            | Major             | C-56                                   |
| S5    | M9 OpenRig trim on critical path                                   | Major             | C-57                                   |
| S5    | M10 Coordinator as model session                                   | Major             | C-14                                   |
| S5    | Z-N1 Ledger keyed by line                                          | Nit               | C-77                                   |
| S5    | Z-N2 Directory sprawl                                              | Nit               | C-78                                   |
| S5    | Z-N3 Duplicate IDs, M5 gap, bullet switch                          | Nit               | C-79, C-98, C-72                       |
| S5    | Z-N4 Timeline                                                      | Nit               | C-42                                   |
| S5    | Z-N5 Unverified premises in Alternatives P, T, V                   | Nit               | C-40                                   |
| S5    | Z-N6 Draft status                                                  | Nit               | C-80                                   |
| S5    | Z-N7 Time-lock calibration                                         | Nit               | C-49                                   |
| S5    | Contradiction 1: Non-Goal 61 vs unattended sessions                | unrated           | C-14                                   |
| S5    | Contradiction 2: Overview 15 vs intent plane on host; hardware key | unrated           | C-15                                   |
| S5    | Contradiction 3: G5 offline vs online verification                 | unrated           | C-33                                   |
| S5    | Contradiction 4: G5 back-dating vs optional RFC 3161               | unrated           | C-33                                   |
| S5    | Contradiction 5: `guiding-principles` 43/59                        | unrated           | C-01                                   |
| S5    | Contradiction 6: W0-2 wrong lines, `AGENTS` 81-83                  | unrated           | C-01                                   |
| S5    | Contradiction 7: CUJ 4 checkpoint vs retraction                    | unrated           | C-30                                   |
| S5    | Contradiction 8: clerical (D22/D26, "Paths were checked", M5-5)    | unrated           | C-39, C-72, C-79                       |
| S5    | Contradiction 9: local paths                                       | unrated           | C-73                                   |
| S5    | F1 Verifier credential exposure                                    | Blocker           | C-02                                   |
| S5    | F2 Steward-enforced time-lock                                      | Major             | C-13                                   |
| S5    | F3 Steward and coordinator as model sessions                       | Major             | C-14                                   |
| S5    | F4 Revert path                                                     | Major             | C-22                                   |
| S5    | F5 Pre-merge omits canon                                           | Major             | C-21                                   |
| S5    | F6 Failure classification                                          | Major             | C-23                                   |
| S5    | F7 Holdout authorship                                              | Major             | C-25                                   |
| S5    | F8 Agy login and exfiltration                                      | Major             | C-16                                   |
| S5    | F9 Fallback substrate                                              | Major             | C-19                                   |
| S5    | F10 Digest and release are human acts                              | Major             | C-20                                   |
| S5    | F11 Ledger bar                                                     | Major             | C-26                                   |
| S5    | F12 Watchdog                                                       | Major             | C-29                                   |
| S5    | F13 Scope TOCTOU                                                   | Major             | C-18                                   |
| S5    | F14 Pause and resume                                               | Major             | C-30                                   |
| S5    | F15 Config authority                                               | Major             | C-31                                   |
| S5    | F16 Week 0 not time-boxed                                          | Nit               | C-41                                   |
| S5    | F17 Soak                                                           | Nit               | C-81                                   |
| S5    | F18 Two pause authorities                                          | Nit               | C-24                                   |
| S5    | F19 Clerical                                                       | Nit               | C-39, C-79, C-73                       |
| S5    | R-a Run cap duplicates quota                                       | info              | C-41                                   |
| S5    | R-b Extend `actuate-readiness`                                     | info              | C-14                                   |
| S5    | R-c Relocate `matchOwnedPath`                                      | info              | C-58                                   |
| S5    | R-d Keep the claim logic                                           | info              | unmapped (confirmation, no action)     |
| S5    | R-e Retire `role-flow-span`                                        | info              | unmapped (confirmation; noted at C-97) |

### Stage 6 (`comprehension_report.md`)

| Stage | Original ID / title                      | Original severity | Consolidated |
| ----- | ---------------------------------------- | ----------------- | ------------ |
| S6    | #1 Attestation trust path                | Blocker           | C-03         |
| S6    | #2 Holdouts in a credentialed job        | Major             | C-02         |
| S6    | #3 Self-build never sequenced            | Major             | C-43         |
| S6    | #4 Evaluator undefined                   | Major             | C-51         |
| S6    | #5 Coordinator, steward, poller identity | Major             | C-14         |
| S6    | #6 Release vs unconditional merge        | Major             | C-20         |
| S6    | #7 Stale Overview and Non-Goals          | Major             | C-45         |
| S6    | #8 Two implementations per port          | Major             | C-36         |
| S6    | #9 Lane                                  | Major             | C-52         |
| S6    | #10 Goal                                 | Major             | C-53         |
| S6    | #11 Milestones not defined               | Major             | C-42         |
| S6    | #12 Decision IDs                         | Major             | C-39         |
| S6    | #13 Limits                               | Major             | C-49         |
| S6    | #14 Class terms                          | Major             | C-44         |
| S6    | #15 Evidence inputs, garbled line 49     | Major             | C-33         |
| S6    | #16 Vendor no-go                         | Major             | C-32         |
| S6    | #17 OpenRig not introduced               | Major             | C-54         |
| S6    | #18 AgentFlow vocabulary                 | Major             | C-55         |
| S6    | #19 Build order                          | Major             | C-04         |
| S6    | #20 Check-in and kill terms              | Nit               | C-82         |
| S6    | #21 Counting                             | Nit               | C-83         |
| S6    | #22 Two meanings of "launcher"           | Nit               | C-84         |
| S6    | #23 Small undefined items                | Nit               | C-85         |

### Stage 7 (`critic_report.md`)

| Stage | Original ID / title                                      | Original severity | Consolidated           |
| ----- | -------------------------------------------------------- | ----------------- | ---------------------- |
| S7    | K1 Design depends on agent merge, against binding policy | Blocker           | C-01                   |
| S7    | K2 Rejection rationales                                  | Major             | C-40                   |
| S7    | K3 Undefined codes                                       | Major             | C-39                   |
| S7    | K4 Decision range stated three ways                      | Major             | C-39                   |
| S7    | K5 Overview, Non-Goals, substrate overclaim              | Major             | C-45, C-01             |
| S7    | K6 Planned behavior as present fact                      | Major             | C-46                   |
| S7    | K7 Today's-code claim too broad                          | Major             | C-47                   |
| S7    | K8 "About 1,150 lines"                                   | Major             | C-48                   |
| S7    | K9 Thresholds                                            | Major             | C-49                   |
| S7    | K10 Risks section                                        | Major             | C-50                   |
| S7    | K11 Fallback substrate                                   | Major             | C-19                   |
| S7    | K12 Verifier placement unresolved                        | Major             | C-02, C-08             |
| S7    | K13 Steward discretion and digest bump                   | Major             | C-13, C-20             |
| S7    | K14 Host compromise                                      | Major             | C-15                   |
| S7    | K15 Post-merge, revert, release, classifier gaps         | Major             | C-21, C-22, C-23, C-20 |
| S7    | K16 Reviewer injection and trust path                    | Major             | C-03, C-18             |
| S7    | K17 Quota, cost and vendor terms                         | Major             | C-32                   |
| S7    | K18 G5 timestamp and keys                                | Major             | C-33                   |
| S7    | K19 Merge queue and org features                         | Major             | C-34                   |
| S7    | K20 Idempotent resume and conditional append             | Major             | C-30                   |
| S7    | K21 No schedule                                          | Major             | C-42                   |
| S7    | K22 Alternative S vs Agy login                           | Major             | C-16                   |
| S7    | K23 Watchdog and morning digest                          | Nit               | C-86                   |
| S7    | K24 Kill-switch latency                                  | Nit               | C-87                   |
| S7    | K25 Soak statistics                                      | Nit               | C-81                   |
| S7    | K26 Line 23                                              | Nit               | C-80                   |
| S7    | K27 Unsourced facts                                      | Nit               | C-88                   |
| S7    | K28 Subjective wording                                   | Nit               | C-89                   |
| S7    | K29 Three gaps vs four                                   | Nit               | C-90                   |
| S7    | K30 G5 garbled                                           | Nit               | C-91                   |
| S7    | K31 Spec breaks its ledger rule                          | Nit               | C-92                   |
| S7    | K32 Filler and forward references                        | Nit               | C-93                   |
| S7    | K33 Same facts stated several times                      | Nit               | C-94                   |
| S7    | K34 Alternatives structure and labels                    | Nit               | C-95                   |
| S7    | K35 "Fencing" after retraction                           | Nit               | C-96                   |
| S7    | K36 `role-flow-span` retired and re-pointed              | Nit               | C-97                   |
| S7    | K37 Formatting inconsistencies                           | Nit               | C-98                   |
| S7    | K38 Headings differ from standard                        | Nit               | C-99                   |
| S7    | K39 Trust table omits reviewer login                     | Nit               | C-101                  |
| S7    | K40 Terms defined only inline                            | Nit               | C-85                   |

### Stage 8 (`intermediate_zoom_out_report.md`, new findings only)

| Stage | Original ID / title                   | Original severity | Consolidated |
| ----- | ------------------------------------- | ----------------- | ------------ |
| S8    | N-1 Launcher git on writable metadata | Major             | C-17         |
| S8    | N-2 `factory-core` undefined          | Major             | C-44         |
| S8    | N-3 Audit coverage                    | Major             | C-27         |
| S8    | N-4 Website check optional            | Major             | C-35         |
| S8    | N-5 Conformance claim                 | Major             | C-36         |
| S8    | N-6 Circuit breaker not reconciled    | Major             | C-24         |
| S8    | N-7 Bootstrap                         | Major             | C-43         |
| S8    | N-8 M0-9 file list                    | Nit               | C-10         |
| S8    | N-9 Pi, Gemini, Grok routing          | Nit               | C-68         |
| S8    | N-10 G8 metric                        | Nit               | C-114        |
| S8    | N-11 Core injection seam              | Nit               | C-62         |

### Stage 9 (`implementation_readiness_report.md`)

| Stage | Original ID / title                             | Original severity | Consolidated |
| ----- | ----------------------------------------------- | ----------------- | ------------ |
| S9    | R1 Stated build order is false                  | Blocker           | C-04         |
| S9    | R2 M1 reads control repo before reader          | Blocker           | C-05         |
| S9    | R3 Breaker vs pause write authority             | Blocker           | C-06         |
| S9    | R4 M1-14 demo needs M3/M4                       | Blocker           | C-07         |
| S9    | R5 M2-2 decision open, verifier under-specified | Blocker           | C-08, C-02   |
| S9    | R6 M0-10 wording rule                           | Blocker           | C-09         |
| S9    | R7 M0-9 allowlist, importers, config            | Blocker           | C-10         |
| S9    | R8 `agentflow/**` trim vs generator             | Blocker           | C-11         |
| S9    | R9 M2b-2 steering bundle references             | Blocker           | C-12         |
| S9    | R10 Test plan gives file names                  | Major             | C-59         |
| S9    | R11 Substrate manifest convention               | Major             | C-60         |
| S9    | R12 Digests change with no migration            | Major             | C-61         |
| S9    | R13 Field definitions                           | Major             | C-62         |
| S9    | R14 M1-12 consumers                             | Major             | C-63         |
| S9    | R15 Registration                                | Major             | C-64         |
| S9    | R16 W0-2 wrong lines                            | Major             | C-01         |
| S9    | R17 Design values left to implementer           | Major             | C-65         |
| S9    | R18 `declared-scope.mjs` dependency             | Major             | C-58         |
| S9    | R19 `box` verb and `guarded-run`                | Major             | C-66         |
| S9    | R20 `lib/sparring.mjs` missing                  | Major             | C-67         |
| S9    | R21 `context-sanitizer` stranded                | Major             | C-28         |
| S9    | R22 M0-1 blast radius                           | Major             | C-27         |
| S9    | R23 M0-11                                       | Major             | C-68         |
| S9    | R24 M1-10 duplicates intake                     | Major             | C-69         |
| S9    | R25 W0-14 reuse and naming                      | Major             | C-69         |
| S9    | R26 W0-19 `goal.json`                           | Major             | C-70         |
| S9    | R27 `seat-lease.mjs` row                        | Major             | C-71         |
| S9    | R28 `lib/bridge` row                            | Major             | C-10         |
| S9    | R29 Line 599 claims                             | Major             | C-72         |
| S9    | R30 Line 889 local path                         | Major             | C-73         |
| S9    | R31 M0-4 attribution                            | Major             | C-74         |
| S9    | R32 "24 MUST" count                             | Major             | C-75         |
| S9    | R33 Unmeasurable criteria                       | Major             | C-76         |
| S9    | R34 Duplicate IDs and M5                        | Nit               | C-79         |
| S9    | R35 Line-number drift                           | Nit               | C-102        |
| S9    | R36 `.agentflow/gates/` collision               | Nit               | C-103        |
| S9    | R37 `validate-claims` handler                   | Nit               | C-104        |
| S9    | R38 M2-3 mapping                                | Nit               | C-105        |
| S9    | R39 Create/Modify mix                           | Nit               | C-106        |
| S9    | R40 List markers                                | Nit               | C-98         |
| S9    | R41 Table padding                               | Nit               | C-98         |
| S9    | R42 Heading at line 670                         | Nit               | C-100        |
| S9    | R43 Informal terms                              | Nit               | C-55         |
| S9    | R44 Filler words                                | Nit               | C-107        |
| S9    | R45 Line 807                                    | Nit               | C-108        |
| S9    | R46 Line 897 first person                       | Nit               | C-109        |
| S9    | R47 Re-verify rule repeated                     | Nit               | C-110        |
| S9    | R48 Size targets                                | Nit               | C-111        |
| S9    | R49 `sbx` spike path                            | Nit               | C-112        |
| S9    | R50 Unbounded phrases                           | Nit               | C-113        |
| S9    | R51 Residual conflicting citation               | Nit               | C-75         |

### Reconciliation

- **Stage 5:** the report states 35 findings after its own deduplication (2 Blockers, 23 Majors, 10 Nits). The matrix has 52 rows: 2 B, 10 M and 7 Z-N items, 9 catalyst contradictions, F1-F19 and 5 reuse notes, listed separately as instructed. Section 4 aliases (M13-M25, N1-N10) are restatements and get no rows. 50 rows mapped; R-d and R-e unmapped.
- **Stage 6:** 23 raw findings, 23 rows, all mapped.
- **Stage 7:** 40 raw findings, 40 rows, all mapped.
- **Stage 8:** 11 new findings, 11 rows, all mapped. Carried-over items restate Stage 5 and get no rows.
- **Stage 9:** 51 raw findings, 51 rows, all mapped.
- **Total:** 177 rows; 175 mapped to 114 consolidated items, 2 unmapped.
