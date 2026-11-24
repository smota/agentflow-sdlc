# Consolidated Review Report, Round 2: Governed Factory

**Target:** `docs/designs/governed-factory.md` (spec lines 1-684, plan lines 685-1016)
**Round-1 baseline:** `docs/designs/governed-factory/review-round-1/consolidated_review_report.md` (C-01..C-114)
**Edits between rounds:** C-01 (policy, opt-in delegation, Human acts table, "by default"), C-20 (the steward cuts `next`; `latest` and the verifier pin stay human), C-31 (the control repository is the sole owner of trust policy; the substrate becomes the `containment` facet).

## Stages

| Stage                       | Report                                              | Reviewers                                                                            | Status                                                                     |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| S5 Zoom-out                 | `review-round-2/zoom_out_report.md`                 | egm-zoom-out, egm-inventive-catalyst                                                 | Completed (22 findings)                                                    |
| S6 Comprehension            | `review-round-2/comprehension_report.md`            | egm-comprehension (no reviewer status table in the report)                           | Completed (28 findings)                                                    |
| S7 Critic                   | `review-round-2/critic_report.md`                   | egm-design, egm-structural, egm-style (scope lines 1-684)                            | Completed (45 findings)                                                    |
| S8 Intermediate zoom-out    | `review-round-2/intermediate_zoom_out_report.md`    | egm-zoom-out                                                                         | Completed (13 new findings plus smaller alternatives for earlier findings) |
| S9 Implementation readiness | `review-round-2/implementation_readiness_report.md` | egm-implementation-readiness, egm-codebase-details, egm-style (scope lines 685-1016) | Completed (44 findings)                                                    |

## Severity summary

| Severity                  | Raw (round 2) | Consolidated (round 2) | Round 1 consolidated |
| ------------------------- | ------------- | ---------------------- | -------------------- |
| 🔴 Blocker                | 9             | 9                      | 12                   |
| 🟡 Major                  | 90            | 73                     | 64                   |
| 🟢 Nit (includes 1 Minor) | 53            | 43                     | 38                   |
| Total                     | 152           | 125                    | 114                  |

**Verdict.** Not ready to build. The three edited areas (C-01, C-20, C-31) mostly landed, but they introduced new wording conflicts (R2-14, R2-17, R2-18, R2-68, R2-76), and the core round-1 trust Blockers remain open: verifier isolation (C-02), attestation provenance (C-03), plan ordering (C-05) and host-side merge control (C-13, C-14). Several round-1 Blockers persist as Majors (C-04, C-06, C-07, C-09, C-10, C-11, C-12), and S9 found four new plan Blockers in the build order and code facts.

## Consolidated items

Severity is the highest any source gave. Where sources disagree, a "Severity spread" line notes it. "S8 alternative" marks a smaller option proposed by S8.

### 🔴 Blockers

#### R2-01 Verifier runs candidate code beside the credential and the holdouts

- **Severity:** 🔴 Blocker. Severity spread: F1 Blocker (zoom-out) and Major (catalyst); S6 #7 and K3 Major.
- **Scope:** Spec, verifier execution model (`verify-pr.yml`, holdouts, attestation credential).
- **What is wrong:** The pinned verifier builds and tests the candidate in the same hosted job that holds the attestation credential and reads the holdout material, so candidate code can read holdouts or misuse the credential. The design does not explain the verifier's execution model clearly enough for a reader to see where the boundary is.
- **Recommended action:** Separate candidate execution from secrets and holdouts, and state the execution model explicitly. S8 alternative: two hosted jobs, a secretless job that builds and runs the candidate's own tests, and a second job that receives only the holdout material and the built artifact with no attestation or control-repository credential and returns pass/fail; document the residual egress. S8 notes the sbx port cannot run in hosted CI and Alternative V rejected a self-hosted runner.
- **Sources:** S5 F1, S6 #7, S7 K3, S8 (F1 alternative).

#### R2-02 Verifier trigger, merge_group, artifact format and first pin are unresolved

- **Severity:** 🔴 Blocker. Severity spread: R3 Blocker, F21 Nit.
- **Scope:** Plan M2-2; spec line 74 (open trigger question).
- **What is wrong:** M2-2 depends on the still-open choice between `pull_request_target` and an organization-required workflow, and does not specify `merge_group` handling, the artifact format, the digest, or how the first verifier pin is bootstrapped. S5 adds that `pull_request_target` does not fire on `merge_group` (a catalyst claim the report did not verify).
- **Recommended action:** Decide the trigger before M2-2 and specify merge-queue behavior, artifact format, digest and first-pin bootstrap. S8 alternative: check the ruleset-required workflow in the week-0 spike.
- **Sources:** S9 R3, S5 F21, S8 (F21 alternative).

#### R2-03 Merge controls rest on host-side model sessions

- **Severity:** 🔴 Blocker. Severity spread: K1 Blocker, F10 Major.
- **Scope:** Spec, steward and merge path.
- **What is wrong:** The merge conditions are checked and enforced by a model session running on the host, so the control that gates merges is the component least able to be trusted.
- **Recommended action:** Move enforcement into deterministic checks outside the model session. S8 alternative: run the deterministic `scripts/steer.mjs` (`verifyMergeGates`, `--match-head-commit`) from a scheduled task and drop the model steward session.
- **Sources:** S7 K1, S5 F10, S8 (F10 alternative).

#### R2-04 Bootstrap sequence is missing

- **Severity:** 🔴 Blocker.
- **Scope:** Spec and plan; first run of the factory.
- **What is wrong:** A reader cannot tell how the factory comes into existence: which keys, control-repository contents, pins and delegations must exist first, and who creates them in what order.
- **Recommended action:** Add an explicit bootstrap sequence naming each initial artifact, its owner and its order.
- **Sources:** S6 #1.

#### R2-05 Review attestation provenance is not established

- **Severity:** 🔴 Blocker.
- **Scope:** Spec, cross-family review and attestation.
- **What is wrong:** The design does not show how a review attestation is tied to the reviewer that produced it, so the verifier cannot tell a genuine cross-family review from one the author produced.
- **Recommended action:** Specify who signs a review attestation, with what identity, and how the verifier checks it.
- **Sources:** S6 #2.

#### R2-06 Rejections in the Alternatives section are not justified

- **Severity:** 🔴 Blocker. Severity spread: K2 Blocker, F17 Nit.
- **Scope:** Spec, Alternatives.
- **What is wrong:** Rejected alternatives are dismissed by reference to decisions or IDs rather than reasons, and some rejections are attributed to the author rather than argued, so a reviewer cannot check them.
- **Recommended action:** Give each rejection a reason a reader can check. S8 alternative (for the D-ID part, S6 #4): inline a one-line reason per rejection (F17).
- **Sources:** S7 K2, S5 F17, S8 (C4 alternative).

#### R2-07 Control-repository reader and trust-policy loader are used before they are built

- **Severity:** 🔴 Blocker.
- **Scope:** Plan W0-15, M1-8, M1-10, M1-13, M2-1, M3-3, X-1.
- **What is wrong:** The control-repository reader (M2-1) and the trust-policy loader (M3-3) are consumed by W0-15, M1-8, M1-10 and M1-13, and the control repository itself (X-1) is listed last.
- **Recommended action:** Move X-1 into week 0 and the reader and loader into M1 or earlier, ahead of their first consumer.
- **Sources:** S9 R1.

#### R2-08 Launcher has no interface, and M1-4 deletes `guarded-run`

- **Severity:** 🔴 Blocker.
- **Scope:** Plan M1-4, lines 785-786.
- **What is wrong:** The launcher has no specified interface or verb, M1-4 deletes `guarded-run` before a replacement exists, and lines 785 and 786 conflict about what runs in the meantime.
- **Recommended action:** Specify the launcher interface and verb, and keep `guarded-run` until the replacement passes its gate.
- **Sources:** S9 R2.

#### R2-09 M0-11 breaks the `subscription-balanced-v1` distribution profile

- **Severity:** 🔴 Blocker.
- **Scope:** Plan M0-11.
- **What is wrong:** M0-11 edits `ROUTES`, which breaks `subscription-balanced-v1` through `validateOptions` and its digest pins.
- **Recommended action:** Include the profile, its validation and its digest pins in M0-11's change set, or version the profile.
- **Sources:** S9 R4.

### 🟡 Majors: trust, merge and policy

#### R2-10 Agy login and host credential extraction

- **Severity:** 🟡 Major. Severity spread: F9 Major (catalyst) and Nit (zoom-out); K5 Major. **Scope:** Spec, cross-family review with Agy.
- **What is wrong:** The Agy reviewer depends on an interactive login whose credential lives on the host and can be extracted, which weakens the cross-family review guarantee.
- **Recommended action:** State how the Agy credential is held and what extraction would allow. S8 alternative: record the residual risk plus a spike check.
- **Sources:** S5 F9, S7 K5, S8 (F9 alternative).

#### R2-11 Host receipts are self-asserted; evidence proves only what CI saw

- **Severity:** 🟡 Major. **Scope:** Spec, evidence envelope.
- **What is wrong:** Host-side fields in the evidence are asserted by the host itself, so the envelope proves what CI saw, not what happened on the host.
- **Recommended action:** Say plainly what the evidence proves. S8 alternative: label host fields as self-reported, digest the sbx logs, and make the timestamp seam default-on for G5 only.
- **Sources:** S5 F12, S7 K4, S8 (F12 alternative).

#### R2-12 Timestamp source is unclear

- **Severity:** 🟡 Major. **Scope:** Spec, signing seam and RFC 3161 option.
- **What is wrong:** A reader cannot tell which time source the evidence relies on, given that RFC 3161 timestamps are optional.
- **Recommended action:** Name the default time source. S8 alternative: default to the GitHub attestation time plus the record chain, with RFC 3161 optional.
- **Sources:** S6 #17, S8 (C17 alternative).

#### R2-13 Trust table omits actors; coordinator and steward identity unclear

- **Severity:** 🟡 Major. **Scope:** Spec, trust table.
- **What is wrong:** The trust table leaves out actors that hold authority, and the identities under which the coordinator and the steward act are not stated.
- **Recommended action:** List every actor with its identity, credential and authority.
- **Sources:** S7 K20, S6 #10.

#### R2-14 Control-repository pointer is not protected

- **Severity:** 🟡 Major. **Scope:** Spec, control repository (introduced by the C-31 edit).
- **What is wrong:** With the control repository now the sole owner of trust policy, the file in the product repository that points to it becomes a single point that a candidate change could redirect.
- **Recommended action:** Protect the pointer. S8 alternative: classify the pointer file as `factory-core` and have `validate:authority` check it.
- **Sources:** S5 F11, S8 (F11 alternative).

#### R2-15 Plan tier and repository visibility are not stated

- **Severity:** 🟡 Major. **Scope:** Spec, GitHub features relied on.
- **What is wrong:** Several controls depend on GitHub features whose availability depends on plan tier and repository visibility, and the design does not state which tier and visibility it assumes.
- **Recommended action:** State the required tier and visibility and the fallback if a feature is unavailable.
- **Sources:** S7 K12.

#### R2-16 Recovery path: revert, kill and pause ordering

- **Severity:** 🟡 Major. **Scope:** Spec recovery; plan M2b.
- **What is wrong:** The 24-hour time-lock can delay a revert, revert and prerelease ordering is unspecified, and the circuit-breaker credential, kill propagation, `taskkill` use and revert authority are not defined.
- **Recommended action:** Specify revert authority, kill propagation and ordering. S8 alternative: waive the time-lock when the revert tree digest equals the last attested tree.
- **Sources:** S5 F13, S7 K8, S9 R16, S8 (F13 alternative).

#### R2-17 "Dark" running versus human veto; Human acts table incomplete

- **Severity:** 🟡 Major. **Scope:** Spec, Human acts table (C-01) and pin rules (C-20).
- **What is wrong:** The claim of dark running conflicts with the human veto and pin acts, and the Human acts table does not list every act a human must perform.
- **Recommended action:** Complete the Human acts table and reconcile it with the dark-running claim. S8 alternative: the extending lock reuses `checkins/` tags, with no auto-pin, since auto-pin would reverse AX.
- **Sources:** S5 F14, S6 #18, S8 (F14 alternative).

#### R2-18 Delegation described as "narrow" while opt-in covers all classes; "and releases"

- **Severity:** 🟡 Major. **Scope:** Spec, delegation (C-01, C-20 edits).
- **What is wrong:** The delegation is called narrow, yet opt-in is available for all change classes, and the delegation wording says "and releases" although `latest` stays human.
- **Recommended action:** Make the delegation wording match the opt-in scope and the release split.
- **Sources:** S7 K10, S6 #21.

#### R2-19 CUJ 1 claims "no human action"

- **Severity:** 🟡 Major. **Scope:** Spec, CUJ 1.
- **What is wrong:** CUJ 1 says the flow needs no human action, which conflicts with the opt-in and Human acts rules.
- **Recommended action:** Reword CUJ 1 to name the human acts it depends on.
- **Sources:** S7 K22.

#### R2-20 Thresholds and parameters are scattered or unset

- **Severity:** 🟡 Major. **Scope:** Spec and plan.
- **What is wrong:** Thresholds such as N reverts, the dead-man period, time-lock length and run limits are spread through the text, some without values.
- **Recommended action:** Add one parameters table with each value, its owner and where it is enforced.
- **Sources:** S6 #22, S7 K11, S9 R10.

#### R2-21 No degraded mode; reviewer injection

- **Severity:** 🟡 Major. **Scope:** Spec, operations.
- **What is wrong:** The design has no degraded mode when a vendor or reviewer is unavailable, and does not address injection into reviewer input.
- **Recommended action:** Define the degraded mode. S8 alternative: state the attended-only fallback and stop (S8 notes this conflicts with D3).
- **Sources:** S5 F15, S7 K7, S8 (F15 alternative).

#### R2-22 Vendor terms have no go/no-go

- **Severity:** 🟡 Major. **Scope:** Spec, subscription CLIs.
- **What is wrong:** Running unattended agents on subscription CLIs depends on vendor terms, and the design has no go/no-go check for them.
- **Recommended action:** Add a vendor-terms check with a go/no-go before building.
- **Sources:** S7 K6.

#### R2-23 Cost, quota and single-host failure

- **Severity:** 🟡 Major. **Scope:** Spec, operations.
- **What is wrong:** Cost and quota exposure are not estimated, and the single Windows host is a single point of failure.
- **Recommended action:** Estimate cost and quota, and state the host-failure behavior.
- **Sources:** S7 K9.

### 🟡 Majors: flow, terms and scope

#### R2-24 Holdouts: authorship, refresh and access

- **Severity:** 🟡 Major. **Scope:** Spec, holdouts.
- **What is wrong:** A reader cannot tell who writes holdouts, how often they change, or how they stay hidden from the candidate.
- **Recommended action:** Specify the holdout life cycle. S8 alternative: generic holdouts authored once and refreshed.
- **Sources:** S6 #6, S8 (C6 alternative).

#### R2-25 Ready label: who applies it and what it means

- **Severity:** 🟡 Major. **Scope:** Spec, admission.
- **What is wrong:** The ready label's meaning and who may apply it are unclear.
- **Recommended action:** Define the label and its authority. S8 alternative: a single human admission act.
- **Sources:** S6 #8, S8 (C8 alternative).

#### R2-26 Rework paths are not described

- **Severity:** 🟡 Major. **Scope:** Spec, flow.
- **What is wrong:** The design does not say what happens when review, the verifier or canon rejects a change.
- **Recommended action:** Describe each rejection's rework path.
- **Sources:** S6 #9.

#### R2-27 Milestones are not explained; no effort estimate

- **Severity:** 🟡 Major. Severity spread: S6 #5 Major, K45 Nit. **Scope:** Spec and plan.
- **What is wrong:** The spec refers to milestones a reader cannot place, and there is no effort estimate.
- **Recommended action:** Summarize the milestones and estimate effort. S8 alternative: link the `goals/gf-*/goal.json` files.
- **Sources:** S6 #5, S7 K45, S8 (C5 alternative).

#### R2-28 Open versus settled decisions are mixed

- **Severity:** 🟡 Major. Severity spread: S6 #20 Major, F16 Nit. **Scope:** Spec.
- **What is wrong:** The text does not separate decided points from open questions.
- **Recommended action:** Mark open questions in one list.
- **Sources:** S6 #20, S5 F16.

#### R2-29 G8 is a compound criterion that does not match its milestone

- **Severity:** 🟡 Major. Severity spread: S6 #19 Major, K42 Nit. **Scope:** Spec, Goals.
- **What is wrong:** G8 combines several criteria and does not match the plan's evidence for it.
- **Recommended action:** Split or reword G8. S8 alternative: reword G8 to "first local evidence".
- **Sources:** S6 #19, S7 K42, S8 (C19 alternative).

#### R2-30 Document is not self-contained

- **Severity:** 🟡 Major. Severity spread: K19 and S6 #4 Major, S6 #23 Minor. **Scope:** Spec.
- **What is wrong:** The spec relies on D-IDs, process references and earlier documents a reader does not have.
- **Recommended action:** Inline the needed context or link it.
- **Sources:** S7 K19, S6 #4, S6 #23.

#### R2-31 Vocabulary and jargon

- **Severity:** 🟡 Major. Severity spread: S6 #11 Major, K40 Nit. **Scope:** Spec.
- **What is wrong:** Many terms are used without definition.
- **Recommended action:** Define terms. S8 alternative: link `docs/glossary.md` and add only missing terms.
- **Sources:** S6 #11, S7 K40, S8 (C11 alternative).

#### R2-32 Candidate digest is undefined

- **Severity:** 🟡 Major. **Scope:** Spec, verifier.
- **What is wrong:** The candidate digest is used but not defined: what it covers and who computes it.
- **Recommended action:** Define the digest inputs and producer.
- **Sources:** S6 #12.

#### R2-33 `factory-core` is undefined

- **Severity:** 🟡 Major. **Scope:** Spec, path classes.
- **What is wrong:** The `factory-core` class drives the time-lock but its membership is not defined in the text.
- **Recommended action:** Define the class and where its path list lives.
- **Sources:** S6 #13.

#### R2-34 "Lane" is unclear

- **Severity:** 🟡 Major. **Scope:** Spec.
- **What is wrong:** "Lane" is used in several senses without a definition.
- **Recommended action:** Define it once.
- **Sources:** S6 #14.

#### R2-35 Evaluator is unclear

- **Severity:** 🟡 Major. **Scope:** Spec.
- **What is wrong:** The evaluator's role and relation to the verifier are unclear.
- **Recommended action:** Define the evaluator and its inputs and outputs.
- **Sources:** S6 #15.

#### R2-36 OpenRig is unexplained

- **Severity:** 🟡 Major. **Scope:** Spec.
- **What is wrong:** OpenRig appears without explanation.
- **Recommended action:** Explain it. S8 alternative: resolve N-1 (R2-42) instead.
- **Sources:** S6 #16, S8 (C16 alternative).

#### R2-37 Unconditional agent merge drives the largest costs

- **Severity:** 🟡 Major. **Scope:** Problem item 3, G3, Alternative C, policy changes (lines 238-248), W0-20, M2b, "If time slips".
- **What is wrong:** Agent merge is not needed for the stated root problem, yet it drives the steward, the time-lock, the delegation and the W0-20 policy rewrite, and every week-0 milestone assumes the rewrite lands before the first unattended run.
- **Recommended action:** Commit M0, M1, M2 (L1/L2 with human merge) and M3, which deliver G1, G2, G4 and G5, and treat M2b, L3 and the W0-20 rewrite as a later decision. This is a scope option for the author (see Updated recommendation).
- **Sources:** S5 F2.

#### R2-38 Learning pipeline is scope no goal requires

- **Severity:** 🟡 Major. **Scope:** Components "Learning pipeline", "Learning boundary", W0-3, M4-3.
- **What is wrong:** G1-G8 do not mention learning, yet M4-3 adds three libraries, a seat, three CLI verbs and a refinement-engine rework, on input the design admits is agent-writable with no reward yet.
- **Recommended action:** Retract the `refinement-engine` claim or mark it `planned`, and drop M4-3, W0-3 and the boundary section until a goal needs them.
- **Sources:** S5 F3.

#### R2-39 Modules are wired to satisfy the audit, not a goal

- **Severity:** 🟡 Major. **Scope:** M1-9, M2-10 and the tester lane, Alternatives AE and AF.
- **What is wrong:** M1-9 rebuilds the process supervisor and gate sweeper mainly to give them product callers, and the QA contract verifier is kept by adding a tester lane, while the launcher and substrate already own process-tree kill and orphan cleanup.
- **Recommended action:** Retract the supervisor and QA-verifier claims or defer wiring until a goal depends on them, and remove the tester lane from M2.
- **Sources:** S5 F4.

#### R2-40 Design deletes existing code, then builds equivalents

- **Severity:** 🟡 Major. **Scope:** M0-9, M1-1, M1-4, M1-10; the containment overlap from C-31.
- **What is wrong:** M0-9 deletes worktree and bridge code that already provides create, inspect, remove, sweep, claim and intake, and M1-4 and M1-10 then build equivalents as new code. S5 says M0-9 deletes `lib/runtime/slice-worktrees.mjs`; S9 (R6) says that file is outside the `lib/bridge/**` glob and would be left orphaned (see Disagreements).
- **Recommended action:** Reuse the existing worktree and bridge code in M1-4 and M1-10, or justify each rewrite.
- **Sources:** S5 F5.

#### R2-41 A second substrate is built to justify "pluggable"

- **Severity:** 🟡 Major. **Scope:** G2, Components "Substrate port", M2-7, Alternative U, Deviation 5.
- **What is wrong:** G2 requires a second implementation (the assembled WSL2 stack) only so that "pluggable" can be claimed, though Alternative U lists its own weaknesses and the weak-adapter negative test already shows the suite discriminates.
- **Recommended action:** Drop "pluggable" and defer M2-7 until `sbx` fails its spike or a prospect asks; keep the containment port and one reference implementation.
- **Sources:** S5 F6.

#### R2-42 OpenRig trim has no goal

- **Severity:** 🟡 Major. **Scope:** Plan OpenRig items.
- **What is wrong:** The OpenRig trim is planned work that no goal requires.
- **Recommended action:** Tie the trim to a goal or defer it.
- **Sources:** S8 N-1.

#### R2-43 Two run-limit mechanisms; M2-5 quota change incomplete

- **Severity:** 🟡 Major. **Scope:** Plan W0 run cap, M2-5.
- **What is wrong:** S8 finds two mechanisms limiting runs and recommends dropping the M2-5 quota change; S9 finds M2-5 incomplete and the phrase "no window" unclear.
- **Recommended action:** Keep one run-limit mechanism. The sources conflict: S8 says drop the M2-5 quota change, S9 says complete it; the author chooses.
- **Sources:** S8 N-2, S9 R26.

#### R2-44 Codex provider copies

- **Severity:** 🟡 Major. **Scope:** Plan, provider configuration.
- **What is wrong:** Codex provider definitions are copied in several places.
- **Recommended action:** Use a single providers array in configuration.
- **Sources:** S8 N-4.

#### R2-45 Week 0 is overloaded

- **Severity:** 🟡 Major. **Scope:** W0-1 to W0-20, "Known risks: Week 0 is heavier".
- **What is wrong:** Week 0 has 20 items, including ADRs for M1 and M4 work and items that feed M3 rather than the gate.
- **Recommended action:** Limit week 0 to the containment floor, the vendor-terms check, the `sbx` spike and the control repository, and move the rest to the milestone that needs it.
- **Sources:** S5 F8.

### 🟡 Majors: structure and accuracy

#### R2-46 Plan is an implementation backlog at the wrong altitude

- **Severity:** 🟡 Major. **Scope:** "Detailed Implementation Plan" (lines 685-1014), "Key shapes" pseudocode.
- **What is wrong:** M1-M5 rows are speculative by the document's own account (line 23) and will rot, and the same decisions live in the brief, the design, ten new ADRs and milestone goals.
- **Recommended action:** Keep file-level lists for week 0 and M0 only, move M1 onward into milestone goals, keep interface contracts, cut pseudocode, and decide which document is canonical per decision. This is in tension with R2-60 (see Disagreements).
- **Sources:** S5 F7.

#### R2-47 Alternatives section is 31% of the file and duplicates the ADRs

- **Severity:** 🟡 Major (S8 labels it "Major (altitude)"). **Scope:** Spec, Alternatives.
- **What is wrong:** The Alternatives section takes about 31% of the file and repeats content that W0-1 to W0-11 put into ADRs.
- **Recommended action:** Move the detailed alternatives to the ADRs and keep a short summary.
- **Sources:** S8 N-3.

#### R2-48 No deviations change log

- **Severity:** 🟡 Major. **Scope:** Spec, Deviations.
- **What is wrong:** Deviations from the brief are listed without a change log a reader can follow across revisions.
- **Recommended action:** Add a change log for deviations.
- **Sources:** S7 K18.

#### R2-49 No Risks section

- **Severity:** 🟡 Major. **Scope:** Spec structure.
- **What is wrong:** Risks are scattered and there is no dedicated Risks section.
- **Recommended action:** Add a Risks section with owner and mitigation per risk.
- **Sources:** S7 K15.

#### R2-50 Headings nested under Non-Functional Requirements

- **Severity:** 🟡 Major. **Scope:** Spec structure.
- **What is wrong:** Sections that are not requirements sit under the NFR heading.
- **Recommended action:** Promote them to their own headings.
- **Sources:** S7 K16.

#### R2-51 Alternatives premises, boundary and missing options

- **Severity:** 🟡 Major. **Scope:** Spec, Alternatives (including the AW/AX boundary after C-20).
- **What is wrong:** Some alternatives rest on unstated premises, the boundary between related alternatives is unclear, and some options are missing.
- **Recommended action:** State the premises, fix the boundaries and add the missing options.
- **Sources:** S7 K13.

#### R2-52 Alternative U is not rejected

- **Severity:** 🟡 Major. **Scope:** Spec, Alternative U.
- **What is wrong:** Alternative U is described with its weaknesses but has no decision.
- **Recommended action:** Record a decision and reason for Alternative U.
- **Sources:** S7 K14.

#### R2-53 Overview and Non-Goals disagree with the substrate plan

- **Severity:** 🟡 Major. **Scope:** Spec, Overview and Non-Goals.
- **What is wrong:** The Overview and Non-Goals do not match the substrate plan, including WSL2's role.
- **Recommended action:** Align the Overview and Non-Goals with the substrate decisions.
- **Sources:** S6 #3, S7 K17.

#### R2-54 Reachability scope is inconsistent

- **Severity:** 🟡 Major. **Scope:** Spec line 29; plan reachability rule.
- **What is wrong:** The reachability claim at line 29 does not match `SCAN_ROOTS` (lib, scripts, bin) and the control-export rule, and the plan's rule is inconsistent and does not scan adapters.
- **Recommended action:** State the scan roots and the rule once and include or exclude adapters explicitly.
- **Sources:** S7 K21, S9 R31.

#### R2-55 "Thin launcher" understates the launcher

- **Severity:** 🟡 Major. **Scope:** Spec.
- **What is wrong:** The launcher is called thin while it carries substantial responsibilities.
- **Recommended action:** Describe the launcher by its responsibilities.
- **Sources:** S7 K23.

#### R2-56 Absolute present tense for unbuilt behavior

- **Severity:** 🟡 Major. **Scope:** Spec.
- **What is wrong:** Planned behavior is written in present tense as if it exists.
- **Recommended action:** Separate current behavior from planned behavior in tense.
- **Sources:** S7 K24.

#### R2-57 Problem framing

- **Severity:** 🟡 Major. **Scope:** Spec, Problem section.
- **What is wrong:** The Problem section does not frame the problem in a way that leads to the goals.
- **Recommended action:** Reframe the problem so each goal traces to it.
- **Sources:** S7 K25.

#### R2-58 Named reference stack

- **Severity:** 🟡 Major. **Scope:** Spec.
- **What is wrong:** The design names a reference stack in a way that ties claims to specific products.
- **Recommended action:** Separate the reference stack from the design's claims.
- **Sources:** S7 K26.

#### R2-59 "About 1,150 lines" is inaccurate

- **Severity:** 🟡 Major. **Scope:** Spec and plan line 975.
- **What is wrong:** The reviewer counts about 1,364 lines (about 1,318 without the adapter file), not about 1,150; the S7 synthesizer did not recount.
- **Recommended action:** Recount and correct the figure.
- **Sources:** S7 K27.

### 🟡 Majors: plan readiness

All items in this group come from S9 (plan lines 685-1016) unless noted.

#### R2-60 File globs and deferred paths

- **Severity:** 🟡 Major. **Scope:** Plan rows that name globs or defer file lists.
- **What is wrong:** Rows use globs and deferred paths, so an implementer cannot tell which files change.
- **Recommended action:** Enumerate files, or make each milestone's re-verification an item that produces the exact list (this reconciles with R2-46).
- **Sources:** S9 R5.

#### R2-61 M0-9 deletion details are wrong or incomplete

- **Severity:** 🟡 Major. **Scope:** M0-9.
- **What is wrong:** M0-9 misses `HOLD_COMMANDS` at `bin/cli.mjs:1050`, names wrong manifests, omits tests and workflow YAML, leaves broken links and an orphaned `slice-worktrees`, and relies on approximations.
- **Recommended action:** Rewrite M0-9 with the exact file, test, manifest, link and workflow list.
- **Sources:** S9 R6.

#### R2-62 Items too large

- **Severity:** 🟡 Major. **Scope:** W0-20 (about 26 files), M0-9 (about 18k lines), M2b-2, M1-2 (contains wsl2).
- **What is wrong:** Several items are too large for one reviewable change.
- **Recommended action:** Split them into reviewable items.
- **Sources:** S9 R7.

#### R2-63 Ordering inversions

- **Severity:** 🟡 Major. **Scope:** Box gate, M1-14 demo, W0-12 delegation, M0-1/M0-2, M0-6 trust policy, M2b-2 vs M2b-3, M5 order, X items, sweeper.
- **What is wrong:** Several items depend on work scheduled after them.
- **Recommended action:** Add a dependency column and re-sequence.
- **Sources:** S9 R8.

#### R2-64 Tests are thin; fixtures and gate extensions unowned

- **Severity:** 🟡 Major. **Scope:** Verification Plan and item test columns.
- **What is wrong:** Test coverage per item is thin, and fixtures and gate extensions have no owning item.
- **Recommended action:** Name tests per item and assign fixtures and gate extensions to items.
- **Sources:** S9 R9.

#### R2-65 `.agentflow` state not ignored; PM seats may write it

- **Severity:** 🟡 Major. **Scope:** Runtime state files.
- **What is wrong:** `.agentflow` state is not git-ignored and PM seats may write it.
- **Recommended action:** Ignore the state and restrict writers.
- **Sources:** S9 R11.

#### R2-66 Digest change invalidates sealed records; `lib/sparring.mjs` path

- **Severity:** 🟡 Major. **Scope:** M1-5 and evidence records.
- **What is wrong:** Changing the digest function invalidates records already sealed, and the plan cites `lib/sparring.mjs`, which does not exist (the file is `lib/core/sparring.mjs`).
- **Recommended action:** Version the digest and fix the path.
- **Sources:** S9 R12.

#### R2-67 Intent-only modules

- **Severity:** 🟡 Major. **Scope:** M0-3, M1-10, M2-1, M2-3, M1-1/M1-3, M4-3.
- **What is wrong:** These items state intent without interfaces or behavior an implementer can build to.
- **Recommended action:** Give each an interface and acceptance tests.
- **Sources:** S9 R13.

#### R2-68 W0-20 policy wording is missing

- **Severity:** 🟡 Major. **Scope:** W0-20, line 792 (C-01 edit).
- **What is wrong:** W0-20 changes policy but does not give the new wording, and the history at line 792 is unclear.
- **Recommended action:** Include the exact policy wording in W0-20.
- **Sources:** S9 R14.

#### R2-69 Admission gates versus person-gates per change class

- **Severity:** 🟡 Major. **Scope:** Plan admission and change classes.
- **What is wrong:** The plan does not say which gates are automatic and which require a person for each change class.
- **Recommended action:** Add a table of gates per change class.
- **Sources:** S9 R15.

#### R2-70 Evidence transport from host to CI

- **Severity:** 🟡 Major. **Scope:** Evidence; line 941.
- **What is wrong:** How evidence moves from the host to CI is unspecified, the `gh` requirement is unstated, and line 941 leaves a choice open.
- **Recommended action:** Specify the transport and settle the line 941 choice.
- **Sources:** S9 R17.

#### R2-71 M2b-2 is an investigation; two merge APIs; duplicated W0-20 edits

- **Severity:** 🟡 Major. **Scope:** M2b-2 (row 927), W0-20.
- **What is wrong:** Row 927 is an investigation rather than a build item, two merge APIs are mentioned, and W0-20 edits are duplicated.
- **Recommended action:** Split the investigation out, pick one merge API and remove the duplicate edits.
- **Sources:** S9 R18.

#### R2-72 M1-7 removes the `gh` fallback

- **Severity:** 🟡 Major. **Scope:** M1-7.
- **What is wrong:** Removing the `gh` fallback is not accounted for in callers and tests.
- **Recommended action:** List the affected callers and tests.
- **Sources:** S9 R19.

#### R2-73 Exemptions and claim kinds

- **Severity:** 🟡 Major. **Scope:** Claims ledger.
- **What is wrong:** Exemptions are unspecified, there is no `planned` kind, and context-sanitizer, refinement-engine and the empty `lib/audit` are unaccounted for.
- **Recommended action:** Add the `planned` kind and classify each module.
- **Sources:** S9 R20.

#### R2-74 `validate:npm` claim is wrong

- **Severity:** 🟡 Major. **Scope:** Plan citation of `validate:npm`.
- **What is wrong:** The plan misstates what `validate:npm` does.
- **Recommended action:** Correct the statement.
- **Sources:** S9 R21.

#### R2-75 M0-6 cites wrong lines and an unworkable mechanism

- **Severity:** 🟡 Major. **Scope:** M0-6 (line 819).
- **What is wrong:** M0-6 cites the wrong code lines (62-85) and a `startsWith`-based mechanism that does not work, and it does not say where shipped conformance suites live.
- **Recommended action:** Choose the mechanism, fix the line numbers, decide where conformance suites live, and name the "provenance and tag" checks.
- **Sources:** S9 R22.

#### R2-76 Containment facet schema enums and docs

- **Severity:** 🟡 Major. **Scope:** `containment` facet (C-31 edit).
- **What is wrong:** The new facet's schema enums and documentation are not specified.
- **Recommended action:** Define the enums and the docs to update.
- **Sources:** S9 R23.

#### R2-77 `modelFamily` already maps gemini

- **Severity:** 🟡 Major. **Scope:** Plan item adding gemini mapping.
- **What is wrong:** The plan adds a mapping that `modelFamily` already has.
- **Recommended action:** Remove or restate the item.
- **Sources:** S9 R24.

#### R2-78 M1-12 breaks issue validation

- **Severity:** 🟡 Major. **Scope:** M1-12.
- **What is wrong:** M1-12's change breaks existing issue validation.
- **Recommended action:** Include the validator change and its tests.
- **Sources:** S9 R25.

#### R2-79 Fencing citations are stale

- **Severity:** 🟡 Major. Severity spread: R27 Major, N-8 Nit. **Scope:** Line 813 vs 1008; validate-docs.
- **What is wrong:** validate-docs has no fencing mentions, the fencing lives in code files (S8: `steer.mjs` has 9 and `process-pilot` 1), and line 813 conflicts with line 1008.
- **Recommended action:** Correct the citation and reconcile lines 813 and 1008.
- **Sources:** S9 R27, S8 N-8.

#### R2-80 Week-0 gate allowlist does not exist

- **Severity:** 🟡 Major. **Scope:** Week-0 gate.
- **What is wrong:** The gate relies on an allowlist that does not exist.
- **Recommended action:** Add an item that creates it.
- **Sources:** S9 R28.

#### R2-81 Unmeasurable criteria

- **Severity:** 🟡 Major. **Scope:** Lines 902, 975, 996, 997, 999, 1007.
- **What is wrong:** These criteria cannot be measured as written.
- **Recommended action:** Restate each with a threshold and a check.
- **Sources:** S9 R29.

#### R2-82 No rollback or checkpoints

- **Severity:** 🟡 Major. **Scope:** Plan.
- **What is wrong:** The plan has no rollback steps or checkpoints between milestones.
- **Recommended action:** Add rollback and checkpoint criteria per milestone.
- **Sources:** S9 R30.

### 🟢 Nits

Format: severity, scope, what is wrong, recommended action, sources.

#### R2-83 Orphan digest and alert

- 🟢 Nit (S8: "close to Major"). Scope: spec digest and alert outputs. Wrong: a digest and an alert are produced with no consumer. Action: name the consumer or drop them. Sources: S8 N-5.

#### R2-84 Two event channels

- 🟢 Nit. Scope: spec events. Wrong: two channels carry events. Action: keep one or state why both exist. Sources: S8 N-6.

#### R2-85 Claims-ledger prose linting

- 🟢 Nit. Scope: M0-3 wording rules (line 808). Wrong: linting prose such as "by default" as a standing rule adds cost. Action: S8 alternative, treat "by default" as a one-time W0-20 review (conflicts with the C-01 edit, see Disagreements). Sources: S8 N-7.

#### R2-86 Speculative seams

- 🟢 Nit. Scope: spec seams with no current user. Wrong: seams are added before any consumer needs them. Action: defer them. Sources: S8 N-9.

#### R2-87 Circuit-breaker name collision

- 🟢 Nit. Scope: recovery terms. Wrong: "circuit breaker" names two different things. Action: rename one. Sources: S8 N-10.

#### R2-88 Factory pause versus run pause

- 🟢 Nit. Scope: coordinator states (line 272), `pause.json`. Wrong: factory pause and run pause are not distinguished. Action: define both. Sources: S8 N-11.

#### R2-89 GxP scope

- 🟢 Nit. Scope: GxP packaging. Wrong: GxP scope is not needed for any goal. Action: defer or bound it. Sources: S8 N-12.

#### R2-90 Demo and website

- 🟢 Nit. Scope: demo recording and website items. Wrong: these are not needed for any goal. Action: defer them. Sources: S8 N-13.

#### R2-91 Speculative additions inside justified items

- 🟢 Nit. Scope: M1-5 (`canonicalJson` in `lib/sparring.mjs`), M2-5 `daily` window, "13 surface counts". Wrong: opportunistic cleanups and a counter whose need depends on the soak. Action: defer each until it blocks a milestone exit. Sources: S5 F18.

#### R2-92 Surface growth bounded only by convention

- 🟢 Nit. Scope: Deviation 15, Alternative AK, Risk "Surface growth". Wrong: about 14 verbs, 6 schemas and 10 ADRs are added with only a convention as the check. Action: give the check one owner or keep the deliverable small; S8 alternative: keep the convention. Sources: S5 F19, S8 (F19 alternative).

#### R2-93 Polling cost accepted as a growth law

- 🟢 Nit. Scope: lines 196, 457, 649. Wrong: `listWorkItems` fetches comments per issue per tick, so cost grows with open issues. Action: label-filtered query, cursor or ETag caching, plus a periodic full sweep; S8 alternative: measure first and add the periodic sweep later. Sources: S5 F20, S8 (F20 alternative).

#### R2-94 "The factory builds itself" overstates

- 🟢 Nit. Scope: lines 11, 272, 291, 863, 326, 52. Wrong: the core is human-built or attended until M2b, so the Overview claim overstates. Action: tag each item human-built, attended or dark; S8 alternative: reword the Overview sentence. Sources: S5 F22, S8 (F22 alternative).

#### R2-95 Three gaps versus four problems

- 🟢 Nit (downgraded from Major by the S7 synthesizer). Scope: Problem and Overview. Wrong: the text lists three gaps and four problems. Action: make the counts match. Sources: S7 K28.

#### R2-96 Process notes in the Overview

- 🟢 Nit (downgraded from Major). Scope: Overview. Wrong: process notes sit in the Overview. Action: move them out. Sources: S7 K29.

#### R2-97 CVE count

- 🟢 Nit (downgraded from Major). Scope: Problem framing. Wrong: the CVE count is unsupported. Action: cite or remove it. Sources: S7 K30.

#### R2-98 Alternative D "fencing"

- 🟢 Nit. Scope: Alternative D. Wrong: "fencing" is used loosely. Action: define or replace the term. Sources: S7 K31.

#### R2-99 G5 wording garbled; private keys; `gh`

- 🟢 Nit. Scope: G5. Wrong: G5 is garbled and its references to private keys and `gh` are unclear. Action: rewrite G5. Sources: S7 K32, S6 #26.

#### R2-100 Kill switch has three meanings

- 🟢 Nit. Scope: spec and plan. Wrong: "kill switch" means three things. Action: give each its own name. Sources: S7 K33.

#### R2-101 Alternatives lead-in (line 316)

- 🟢 Nit. Scope: line 316. Wrong: the lead-in does not introduce the section accurately. Action: rewrite it. Sources: S7 K34.

#### R2-102 Counts disagree; numbering, M5 order, spike counts

- 🟢 Nit. Scope: spec and plan counts. Wrong: counts disagree across sections, numbering and M5 order are inconsistent, spike counts differ, and some terms are unexplained. Action: reconcile the counts and numbering. Sources: S7 K35, S6 #27.

#### R2-103 Bold run-in labels

- 🟢 Nit. Scope: spec formatting. Wrong: bold run-in labels replace headings. Action: use headings or plain text. Sources: S7 K36.

#### R2-104 Goals and CUJs not cross-referenced

- 🟢 Nit. Scope: Goals, CUJs. Wrong: no mapping between goals and CUJs. Action: add cross-references. Sources: S7 K37.

#### R2-105 Status "Draft"

- 🟢 Nit. Scope: header. Wrong: the status line does not reflect the review state. Action: update the status. Sources: S7 K38.

#### R2-106 Mermaid omissions

- 🟢 Nit. Scope: diagrams. Wrong: diagrams omit components the text names. Action: add them. Sources: S7 K39.

#### R2-107 Line 272 paragraph

- 🟢 Nit. Scope: line 272. Wrong: one paragraph carries coordinator states, resume, sweeper, `taskkill` and the guarded runner. Action: split it. Sources: S7 K41.

#### R2-108 Small wording items

- 🟢 Nit. Scope: spec. Wrong: assorted small wording issues. Action: apply the listed edits. Sources: S7 K43.

#### R2-109 Subjective pros and cons

- 🟢 Nit. Scope: Alternatives. Wrong: pros and cons are subjective. Action: state them as checkable facts. Sources: S7 K44.

#### R2-110 Agy is unexplained

- 🟢 Nit. Scope: spec. Wrong: Agy appears without explanation. Action: define it on first use. Sources: S6 #24.

#### R2-111 GxP terms unexplained

- 🟢 Nit. Scope: spec. Wrong: GxP terms are used without definition. Action: define them. Sources: S6 #25.

#### R2-112 "Dark" and "unconditional"

- 🟢 Nit. Scope: spec (C-20 area). Wrong: "dark" and "unconditional" are unclear given the human acts that remain. Action: define or replace them. Sources: S6 #28.

#### R2-113 "(human)" marker

- 🟢 Nit. Scope: plan rows. Wrong: the "(human)" marker is used inconsistently. Action: apply it consistently. Sources: S9 R32.

#### R2-114 Stale lines; `rig whoami` claim wrong

- 🟢 Nit. Scope: plan citations, lines 924 and 926. Wrong: some line citations are stale, the `rig whoami` claim at line 924 is wrong, and line 926 contradicts it. Action: fix the citations and the claim. Sources: S9 R33.

#### R2-115 vitest reason

- 🟢 Nit. Scope: plan test tooling. Wrong: the reason given for vitest is unclear. Action: state it. Sources: S9 R34.

#### R2-116 `lib` imports `scripts`; coordinator vs cockpit; `D-<n>` collision

- 🟢 Nit. Scope: plan. Wrong: a `lib` module imports from `scripts`, coordinator and cockpit are used interchangeably, and `D-<n>` collides with another ID scheme. Action: fix the import direction and the names. Sources: S9 R35.

#### R2-117 Verification Plan formatting

- 🟢 Nit. Scope: Verification Plan. Wrong: inconsistent formatting. Action: normalize it. Sources: S9 R36.

#### R2-118 Count and label mismatches

- 🟢 Nit. Scope: plan (24 vs 22, 63/31, line 815 mapping, line 1012 label). Wrong: counts, a mapping and a label disagree. Action: reconcile them. Sources: S9 R37.

#### R2-119 Overclaims at line 778 versus 777

- 🟢 Nit. Scope: lines 777-778. Wrong: line 778 claims more than line 777 supports. Action: align them. Sources: S9 R38.

#### R2-120 Hedges

- 🟢 Nit. Scope: lines 788, 849, 941, 988. Wrong: hedged wording leaves choices open. Action: decide or mark as open. Sources: S9 R39.

#### R2-121 Wording and undefined terms

- 🟢 Nit. Scope: plan. Wrong: assorted wording issues and undefined terms. Action: fix them. Sources: S9 R40.

#### R2-122 Local path

- 🟢 Nit. Scope: plan (for example `~/.local/bin/rig` at line 781). Wrong: a local machine path appears in the plan. Action: replace it with a portable reference. Sources: S9 R41.

#### R2-123 Overlong table cells

- 🟢 Nit. Scope: plan tables. Wrong: cells are too long to read. Action: move detail out of cells. Sources: S9 R42.

#### R2-124 Row gaps

- 🟢 Nit. Scope: plan tables. Wrong: some rows have empty columns. Action: fill or mark them. Sources: S9 R43.

#### R2-125 Restated conventions

- 🟢 Nit. Scope: plan. Wrong: conventions are restated instead of referenced. Action: reference them once. Sources: S9 R44.

## Round-1 comparison

Statuses: **Resolved** (fixed and confirmed), **Partly resolved** (edited, with a residual issue in round 2), **Still open** (re-raised in round 2), **Not re-raised, visibly fixed** (no stage raised it and the design text shows the fix), **Not re-raised, unmentioned** (no stage raised it and the design text is unchanged; line numbers refer to `docs/designs/governed-factory.md`).

| C-ID  | Status                       | R2 item or evidence                                                                   |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------- |
| C-01  | Partly resolved              | Lines 11, 238-264 edited; residual R2-18, R2-19, R2-68                                |
| C-02  | Still open                   | R2-01                                                                                 |
| C-03  | Still open                   | R2-05                                                                                 |
| C-04  | Still open                   | R2-63                                                                                 |
| C-05  | Still open                   | R2-07                                                                                 |
| C-06  | Still open                   | R2-16                                                                                 |
| C-07  | Still open                   | R2-63                                                                                 |
| C-08  | Still open                   | R2-02                                                                                 |
| C-09  | Still open                   | R2-79                                                                                 |
| C-10  | Still open                   | R2-61, R2-60                                                                          |
| C-11  | Still open                   | R2-61                                                                                 |
| C-12  | Still open                   | R2-71                                                                                 |
| C-13  | Still open                   | R2-03                                                                                 |
| C-14  | Still open                   | R2-03, R2-13                                                                          |
| C-15  | Partly resolved              | Line 286 (hardware keys); residual R2-23                                              |
| C-16  | Still open                   | R2-10                                                                                 |
| C-17  | Still open                   | R2-10                                                                                 |
| C-18  | Still open                   | R2-25                                                                                 |
| C-19  | Still open                   | R2-41                                                                                 |
| C-20  | Partly resolved              | Lines 236, 264, 266 edited; residual R2-18, R2-112                                    |
| C-21  | Not re-raised, unmentioned   | Line 234 still runs canon and the full suite post-merge only                          |
| C-22  | Still open                   | R2-16                                                                                 |
| C-23  | Still open                   | R2-20                                                                                 |
| C-24  | Still open                   | R2-87                                                                                 |
| C-25  | Still open                   | R2-24                                                                                 |
| C-26  | Not re-raised, unmentioned   | Line 808 now requires a non-test importer and a test                                  |
| C-27  | Still open                   | R2-73, R2-54                                                                          |
| C-28  | Still open                   | R2-73                                                                                 |
| C-29  | Still open                   | R2-83, R2-23                                                                          |
| C-30  | Partly resolved              | Line 272 coordinator states; residual R2-88, R2-16                                    |
| C-31  | Resolved                     | Lines 248, 894, 928; new concern R2-14                                                |
| C-32  | Still open                   | R2-22, R2-21, R2-23                                                                   |
| C-33  | Still open                   | R2-11, R2-12, R2-99                                                                   |
| C-34  | Still open                   | R2-15                                                                                 |
| C-35  | Not re-raised, visibly fixed | Line 45                                                                               |
| C-36  | Resolved                     | Lines 181, 213; S7 lists it among points checked                                      |
| C-37  | Still open                   | R2-27 (and R2-37 to R2-45)                                                            |
| C-38  | Still open                   | R2-46, R2-47, R2-48                                                                   |
| C-39  | Still open                   | R2-30                                                                                 |
| C-40  | Still open                   | R2-06, R2-51                                                                          |
| C-41  | Still open                   | R2-45                                                                                 |
| C-42  | Still open                   | R2-27                                                                                 |
| C-43  | Still open                   | R2-04 (also R2-94)                                                                    |
| C-44  | Still open                   | R2-33                                                                                 |
| C-45  | Still open                   | R2-53                                                                                 |
| C-46  | Still open                   | R2-56                                                                                 |
| C-47  | Still open                   | R2-54                                                                                 |
| C-48  | Still open                   | R2-59                                                                                 |
| C-49  | Still open                   | R2-20                                                                                 |
| C-50  | Still open                   | R2-49                                                                                 |
| C-51  | Still open                   | R2-35                                                                                 |
| C-52  | Partly resolved              | Line 198; residual R2-34                                                              |
| C-53  | Still open                   | R2-31, R2-69                                                                          |
| C-54  | Still open                   | R2-36                                                                                 |
| C-55  | Still open                   | R2-31                                                                                 |
| C-56  | Still open                   | R2-79                                                                                 |
| C-57  | Still open                   | R2-42                                                                                 |
| C-58  | Still open                   | R2-116                                                                                |
| C-59  | Still open                   | R2-64                                                                                 |
| C-60  | Still open                   | R2-120                                                                                |
| C-61  | Still open                   | R2-66                                                                                 |
| C-62  | Still open                   | R2-67                                                                                 |
| C-63  | Still open                   | R2-78                                                                                 |
| C-64  | Still open                   | R2-74                                                                                 |
| C-65  | Still open                   | R2-20, R2-71                                                                          |
| C-66  | Still open                   | R2-63, R2-08                                                                          |
| C-67  | Still open                   | R2-66                                                                                 |
| C-68  | Still open                   | R2-09                                                                                 |
| C-69  | Still open                   | R2-40, R2-88                                                                          |
| C-70  | Partly resolved              | Line 790; residual R2-69                                                              |
| C-71  | Resolved                     | Line 869; S9 confirms the seat-lease citation                                         |
| C-72  | Still open                   | R2-62, R2-63, R2-64                                                                   |
| C-73  | Still open                   | R2-122                                                                                |
| C-74  | Partly resolved              | Lines 813-815 now name files; residual R2-118                                         |
| C-75  | Still open                   | R2-118                                                                                |
| C-76  | Still open                   | R2-81                                                                                 |
| C-77  | Still open                   | R2-85                                                                                 |
| C-78  | Not re-raised, unmentioned   | No stage refers to it                                                                 |
| C-79  | Still open                   | R2-63, R2-102                                                                         |
| C-80  | Still open                   | R2-105, R2-96                                                                         |
| C-81  | Still open                   | R2-20                                                                                 |
| C-82  | Still open                   | R2-100                                                                                |
| C-83  | Still open                   | R2-102                                                                                |
| C-84  | Not re-raised, unmentioned   | No stage refers to it                                                                 |
| C-85  | Still open                   | R2-121                                                                                |
| C-86  | Still open                   | R2-83                                                                                 |
| C-87  | Not re-raised, unmentioned   | No remote-pause latency is stated anywhere                                            |
| C-88  | Still open                   | R2-57, R2-97                                                                          |
| C-89  | Still open                   | R2-57, R2-109                                                                         |
| C-90  | Still open                   | R2-95                                                                                 |
| C-91  | Still open                   | R2-99                                                                                 |
| C-92  | Resolved                     | S7 keeps the "supports" wording at lines 50 and 115                                   |
| C-93  | Still open                   | R2-58, R2-96                                                                          |
| C-94  | Still open                   | R2-49                                                                                 |
| C-95  | Still open                   | R2-52, R2-101                                                                         |
| C-96  | Still open                   | R2-98                                                                                 |
| C-97  | Not re-raised, unmentioned   | Line 282 still lists `role-flow-span` as both retired and re-pointed                  |
| C-98  | Still open                   | R2-117, R2-123                                                                        |
| C-99  | Not re-raised, unmentioned   | Headings still read "The Problem" and "Technical Plan (Architecture)"                 |
| C-100 | Not re-raised, unmentioned   | Line 759 heading still omits Delete                                                   |
| C-101 | Still open                   | R2-13                                                                                 |
| C-102 | Still open                   | R2-114                                                                                |
| C-103 | Not re-raised, unmentioned   | Lines 786 and 871 unchanged                                                           |
| C-104 | Not re-raised, visibly fixed | Line 810 adds `sdlc validate-claims`                                                  |
| C-105 | Still open                   | R2-77                                                                                 |
| C-106 | Not re-raised, visibly fixed | Lines 783, 819, 880                                                                   |
| C-107 | Not re-raised, visibly fixed | "deliberately" and "actually" no longer appear in the plan (only at lines 46 and 314) |
| C-108 | Still open                   | R2-43                                                                                 |
| C-109 | Still open                   | R2-81                                                                                 |
| C-110 | Still open                   | R2-60                                                                                 |
| C-111 | Still open                   | R2-81, R2-61                                                                          |
| C-112 | Not re-raised, visibly fixed | Lines 769, 997                                                                        |
| C-113 | Not re-raised, unmentioned   | Line 978 "short recording" still has no length bound                                  |
| C-114 | Still open                   | R2-29                                                                                 |

**Counts:** Resolved 4; Partly resolved 7; Still open 88; Not re-raised 15 (visibly fixed 5, unmentioned 10). Total 114.

## New in round 2

40 consolidated items have no round-1 counterpart. For each, the cause is classified from the design text and the stage reports.

**Introduced by the round-2 edits (7)**

| R2    | Edit          | How                                                                                                                                 |
| ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| R2-14 | C-31          | Making the control repository the sole trust-policy owner turns the in-repo pointer into a redirect target                          |
| R2-17 | C-20, C-01    | The human-only `latest` and verifier pin, plus the new Human acts table, conflict with the dark-running claim                       |
| R2-18 | C-01, C-20    | Opt-in for all classes contradicts "narrow"; "and releases" contradicts `latest` staying human (also the residual of C-01 and C-20) |
| R2-19 | C-01 (partly) | The Human acts table makes CUJ 1's "no human action" untrue                                                                         |
| R2-37 | C-01 (partly) | The W0-20 policy rewrite makes agent merge a week-0 dependency                                                                      |
| R2-68 | C-01          | W0-20 now changes policy without giving the wording                                                                                 |
| R2-76 | C-31          | The new `containment` facet has no schema enums or docs                                                                             |

**Origin uncertain (1)**

- R2-75: the M0-6 trust-policy check may come from the C-20 edit; the reports do not say.

**Pre-existing and missed in round 1 (32)**
R2-26, R2-28, R2-32, R2-38, R2-39, R2-44, R2-50, R2-55, R2-65, R2-70, R2-72, R2-80, R2-82, R2-84, R2-86, R2-89, R2-90, R2-91, R2-92, R2-93, R2-103, R2-104, R2-106, R2-107, R2-108, R2-110, R2-111, R2-113, R2-115, R2-119, R2-124, R2-125. (C-37 raised scope in general; R2-38 and R2-39 are new specific findings.)

**New parts inside items that have a round-1 counterpart**

- R2-71: the duplicated W0-20 edits come from the C-01 rewrite.
- R2-40: the overlap with the new `containment` facet comes from C-31.
- R2-51: the AW/AX boundary question comes from C-20.

## Traceability matrix

Every raw round-2 finding maps to exactly one R2 item. S8's list of carried-over earlier findings and its smaller alternatives are not raw findings; the alternatives are folded into the actions of the R2 items they address.

| Stage | Original ID | Original severity                     | R2     |
| ----- | ----------- | ------------------------------------- | ------ |
| S5    | F1          | Blocker (zoom-out) / Major (catalyst) | R2-01  |
| S5    | F2          | Major                                 | R2-37  |
| S5    | F3          | Major                                 | R2-38  |
| S5    | F4          | Major                                 | R2-39  |
| S5    | F5          | Major                                 | R2-40  |
| S5    | F6          | Major                                 | R2-41  |
| S5    | F7          | Major                                 | R2-46  |
| S5    | F8          | Major                                 | R2-45  |
| S5    | F9          | Major (catalyst) / Nit (zoom-out)     | R2-10  |
| S5    | F10         | Major                                 | R2-03  |
| S5    | F11         | Major                                 | R2-14  |
| S5    | F12         | Major                                 | R2-11  |
| S5    | F13         | Major                                 | R2-16  |
| S5    | F14         | Major                                 | R2-17  |
| S5    | F15         | Major                                 | R2-21  |
| S5    | F16         | Nit                                   | R2-28  |
| S5    | F17         | Nit                                   | R2-06  |
| S5    | F18         | Nit                                   | R2-91  |
| S5    | F19         | Nit                                   | R2-92  |
| S5    | F20         | Nit                                   | R2-93  |
| S5    | F21         | Nit                                   | R2-02  |
| S5    | F22         | Nit                                   | R2-94  |
| S6    | #1          | Blocker                               | R2-04  |
| S6    | #2          | Blocker                               | R2-05  |
| S6    | #3          | Major                                 | R2-53  |
| S6    | #4          | Major                                 | R2-30  |
| S6    | #5          | Major                                 | R2-27  |
| S6    | #6          | Major                                 | R2-24  |
| S6    | #7          | Major                                 | R2-01  |
| S6    | #8          | Major                                 | R2-25  |
| S6    | #9          | Major                                 | R2-26  |
| S6    | #10         | Major                                 | R2-13  |
| S6    | #11         | Major                                 | R2-31  |
| S6    | #12         | Major                                 | R2-32  |
| S6    | #13         | Major                                 | R2-33  |
| S6    | #14         | Major                                 | R2-34  |
| S6    | #15         | Major                                 | R2-35  |
| S6    | #16         | Major                                 | R2-36  |
| S6    | #17         | Major                                 | R2-12  |
| S6    | #18         | Major                                 | R2-17  |
| S6    | #19         | Major                                 | R2-29  |
| S6    | #20         | Major                                 | R2-28  |
| S6    | #21         | Major                                 | R2-18  |
| S6    | #22         | Major                                 | R2-20  |
| S6    | #23         | Minor                                 | R2-30  |
| S6    | #24         | Nit                                   | R2-110 |
| S6    | #25         | Nit                                   | R2-111 |
| S6    | #26         | Nit                                   | R2-99  |
| S6    | #27         | Nit                                   | R2-102 |
| S6    | #28         | Nit                                   | R2-112 |
| S7    | K1          | Blocker                               | R2-03  |
| S7    | K2          | Blocker                               | R2-06  |
| S7    | K3          | Major                                 | R2-01  |
| S7    | K4          | Major                                 | R2-11  |
| S7    | K5          | Major                                 | R2-10  |
| S7    | K6          | Major                                 | R2-22  |
| S7    | K7          | Major                                 | R2-21  |
| S7    | K8          | Major                                 | R2-16  |
| S7    | K9          | Major                                 | R2-23  |
| S7    | K10         | Major                                 | R2-18  |
| S7    | K11         | Major                                 | R2-20  |
| S7    | K12         | Major                                 | R2-15  |
| S7    | K13         | Major                                 | R2-51  |
| S7    | K14         | Major                                 | R2-52  |
| S7    | K15         | Major                                 | R2-49  |
| S7    | K16         | Major                                 | R2-50  |
| S7    | K17         | Major                                 | R2-53  |
| S7    | K18         | Major                                 | R2-48  |
| S7    | K19         | Major                                 | R2-30  |
| S7    | K20         | Major                                 | R2-13  |
| S7    | K21         | Major                                 | R2-54  |
| S7    | K22         | Major                                 | R2-19  |
| S7    | K23         | Major                                 | R2-55  |
| S7    | K24         | Major                                 | R2-56  |
| S7    | K25         | Major                                 | R2-57  |
| S7    | K26         | Major                                 | R2-58  |
| S7    | K27         | Major                                 | R2-59  |
| S7    | K28         | Nit (downgraded from Major)           | R2-95  |
| S7    | K29         | Nit (downgraded from Major)           | R2-96  |
| S7    | K30         | Nit (downgraded from Major)           | R2-97  |
| S7    | K31         | Nit                                   | R2-98  |
| S7    | K32         | Nit                                   | R2-99  |
| S7    | K33         | Nit                                   | R2-100 |
| S7    | K34         | Nit                                   | R2-101 |
| S7    | K35         | Nit                                   | R2-102 |
| S7    | K36         | Nit                                   | R2-103 |
| S7    | K37         | Nit                                   | R2-104 |
| S7    | K38         | Nit                                   | R2-105 |
| S7    | K39         | Nit                                   | R2-106 |
| S7    | K40         | Nit                                   | R2-31  |
| S7    | K41         | Nit                                   | R2-107 |
| S7    | K42         | Nit                                   | R2-29  |
| S7    | K43         | Nit                                   | R2-108 |
| S7    | K44         | Nit                                   | R2-109 |
| S7    | K45         | Nit                                   | R2-27  |
| S8    | N-1         | Major                                 | R2-42  |
| S8    | N-2         | Major                                 | R2-43  |
| S8    | N-3         | Major (altitude)                      | R2-47  |
| S8    | N-4         | Major                                 | R2-44  |
| S8    | N-5         | Nit (close to Major)                  | R2-83  |
| S8    | N-6         | Nit                                   | R2-84  |
| S8    | N-7         | Nit                                   | R2-85  |
| S8    | N-8         | Nit                                   | R2-79  |
| S8    | N-9         | Nit                                   | R2-86  |
| S8    | N-10        | Nit                                   | R2-87  |
| S8    | N-11        | Nit                                   | R2-88  |
| S8    | N-12        | Nit                                   | R2-89  |
| S8    | N-13        | Nit                                   | R2-90  |
| S9    | R1          | Blocker                               | R2-07  |
| S9    | R2          | Blocker                               | R2-08  |
| S9    | R3          | Blocker                               | R2-02  |
| S9    | R4          | Blocker                               | R2-09  |
| S9    | R5          | Major                                 | R2-60  |
| S9    | R6          | Major                                 | R2-61  |
| S9    | R7          | Major                                 | R2-62  |
| S9    | R8          | Major                                 | R2-63  |
| S9    | R9          | Major                                 | R2-64  |
| S9    | R10         | Major                                 | R2-20  |
| S9    | R11         | Major                                 | R2-65  |
| S9    | R12         | Major                                 | R2-66  |
| S9    | R13         | Major                                 | R2-67  |
| S9    | R14         | Major                                 | R2-68  |
| S9    | R15         | Major                                 | R2-69  |
| S9    | R16         | Major                                 | R2-16  |
| S9    | R17         | Major                                 | R2-70  |
| S9    | R18         | Major                                 | R2-71  |
| S9    | R19         | Major                                 | R2-72  |
| S9    | R20         | Major                                 | R2-73  |
| S9    | R21         | Major                                 | R2-74  |
| S9    | R22         | Major                                 | R2-75  |
| S9    | R23         | Major                                 | R2-76  |
| S9    | R24         | Major                                 | R2-77  |
| S9    | R25         | Major                                 | R2-78  |
| S9    | R26         | Major                                 | R2-43  |
| S9    | R27         | Major                                 | R2-79  |
| S9    | R28         | Major                                 | R2-80  |
| S9    | R29         | Major                                 | R2-81  |
| S9    | R30         | Major                                 | R2-82  |
| S9    | R31         | Major                                 | R2-54  |
| S9    | R32         | Nit                                   | R2-113 |
| S9    | R33         | Nit                                   | R2-114 |
| S9    | R34         | Nit                                   | R2-115 |
| S9    | R35         | Nit                                   | R2-116 |
| S9    | R36         | Nit                                   | R2-117 |
| S9    | R37         | Nit                                   | R2-118 |
| S9    | R38         | Nit                                   | R2-119 |
| S9    | R39         | Nit                                   | R2-120 |
| S9    | R40         | Nit                                   | R2-121 |
| S9    | R41         | Nit                                   | R2-122 |
| S9    | R42         | Nit                                   | R2-123 |
| S9    | R43         | Nit                                   | R2-124 |
| S9    | R44         | Nit                                   | R2-125 |

**Reconciliation**

- S5: 22 raw (1 Blocker, 14 Major, 7 Nit), 22 rows. Matches.
- S6: 28 raw (2 Blocker, 20 Major, 1 Minor, 5 Nit), 28 rows. Matches.
- S7: 45 raw (2 Blocker, 25 Major, 18 Nit), 45 rows. Matches.
- S8: 13 raw (4 Major, 9 Nit), 13 rows. Matches; carried-over findings and smaller alternatives excluded.
- S9: 44 raw (4 Blocker, 27 Major, 13 Nit), 44 rows. Matches.
- Total: 152 raw, 152 rows, 125 consolidated items. No finding is unmapped.

## Disagreements and report errors

**Severity disagreements inside a stage**

- S5 F1: zoom-out Blocker, catalyst Major; merged in the S5 report. R2-01 takes Blocker.
- S5 F9: catalyst Major, zoom-out Nit; merged in the S5 report. R2-10 takes Major.
- S7 K28, K29, K30: Major under the style lens, downgraded to Nit by the S7 synthesizer. R2 keeps the synthesizer's Nit.
- S7 K21: the design and style lenses disagreed; the synthesizer settled it from `SCAN_ROOTS` in `scripts/audit-reachability.mjs` (line 208) and the control-export rule (line 575). S9 R31 independently found that adapters are not scanned.
- S8 qualifiers: N-5 is "Nit, close to Major" and N-3 is "Major (altitude)"; R2 records them as Nit and Major.

**Severity spreads across stages (highest wins)**

| R2    | Spread                              |
| ----- | ----------------------------------- |
| R2-01 | F1 Blocker vs K3 and S6 #7 Major    |
| R2-02 | R3 Blocker vs F21 Nit               |
| R2-03 | K1 Blocker vs F10 Major             |
| R2-06 | K2 Blocker vs F17 Nit               |
| R2-27 | S6 #5 Major vs K45 Nit              |
| R2-28 | S6 #20 Major vs F16 Nit             |
| R2-29 | S6 #19 Major vs K42 Nit             |
| R2-30 | K19 and S6 #4 Major vs S6 #23 Minor |
| R2-31 | S6 #11 Major vs K40 Nit             |
| R2-79 | R27 Major vs N-8 Nit                |

**Conflicting recommendations**

- R2-43: S8 N-2 says drop the M2-5 quota change; S9 R26 says complete it.
- R2-85: S8 N-7 says treat "by default" as a one-time W0-20 review; the C-01 edit made it a standing wording rule at line 808.
- R2-46 vs R2-60: S5 F7 says cut file lists for M1 onward; S9 R5 says enumerate every file now. S9's own option reconciles them: make each milestone's re-verification an item that produces the exact list.
- R2-40 vs R2-61: S5 F5 says M0-9 deletes `lib/runtime/slice-worktrees.mjs`; S9 R6 says that file is outside the `lib/bridge/**` glob and would be left orphaned and unlisted.
- R2-21: S8's attended-only fallback conflicts with D3, as S8 itself notes.

**Report conventions and gaps**

- S8 refers to S6 findings as "C-n" (for example C4, C17), which collides with the round-1 C-IDs. This report maps them to S6 numbers.
- S6 has no reviewer status table.
- S5's catalyst GitHub claims are not verified, including that `pull_request_target` does not fire on `merge_group` (F21).
- S7's K27 line count (about 1,364, or about 1,318 without the adapter file) was not recounted by the synthesizer.

**Errors in the design found by reviewers**

- Line 924: the `rig whoami` claim is wrong, and line 926 contradicts it (R33).
- The "fencing mentions" cited in validate-docs do not exist; the fencing lives in code files (R27, N-8).
- `modelFamily` already maps gemini (R24).
- `lib/sparring.mjs` does not exist; the file is `lib/core/sparring.mjs` (R12; line 861 still cites the wrong path).
- The `validate:npm` statement is wrong (R21).
- M0-6 cites wrong code lines (R22).
- Line 975 still says "about 1,150 lines" (K27).

## Updated recommendation

**(a) Ready?** No. Minimum set before building: the nine Blockers (R2-01 to R2-09), plus R2-22 (vendor-terms go/no-go), R2-63 (ordering inversions), R2-20 (parameters table) and R2-13 (trust table and identities). Week 0 and most of M0 are close once R2-07 and R2-09 are fixed.

**(b) Scope options for the author** (each removes items but gives something up):

- Defer agent merge, stopping at L2 with human merge (R2-37, R2-51). Removes the steward, time-lock, delegation and the revert class of findings (much of R2-03, R2-16, R2-17, R2-18); loses G3's dark-running claim.
- Defer the OpenRig trim (R2-42). Removes R2-61 and R2-36; keeps dead code, so the claims must be marked retracted or `planned`.
- Drop the second substrate and the word "pluggable" (R2-41). Removes M2-7; G2 must be reworded.
- Defer the learning pipeline, tester lane, GxP packaging and demo recording (R2-38, R2-39, R2-89, R2-90). Smaller programme; those claims move to `planned`.
- Trim week 0 to the containment floor, vendor terms, `sbx` spike and control repository (R2-45). Faster gate; ADR work moves later.
- Move M1-onward detail and Alternatives K-AZ into milestone goals and ADRs (R2-46, R2-47). Shorter, less stale design; in tension with R2-60 unless re-verification items produce the file lists.

**(c) Order of work**

1. Vendor-terms go/no-go and the degraded-mode fallback (R2-22, R2-21). No dependency.
2. Verifier topology and trigger, plus plan tier (R2-01, R2-02, R2-15). After 1.
3. Merge-control enforcement split, trust table, attestation provenance and pointer protection (R2-03, R2-13, R2-05, R2-14). After 2.
4. Author's scope decisions from (b). After 1-3, since they change what remains.
5. Bootstrap sequence, milestone summary and parameters table (R2-04, R2-27, R2-20). After 4.
6. Spec text fixes for the edited areas and scope claims (R2-53, R2-54, R2-18, R2-19, R2-68). After 4.
7. Re-sequence the plan with a dependency column: X-1 into week 0, the reader and loader into M1, the launcher interface (R2-07, R2-08, R2-63). After 3 and 5.
8. M0 code-fact fixes (R2-09, R2-61, R2-74 to R2-79). After 7.
9. Recovery and evidence design before M2b (R2-16, R2-11, R2-12, R2-70). After 3; skip if agent merge is deferred.
10. Tests, file lists and rollback (R2-64, R2-60, R2-82), then the Nits. After 7 and 8.
