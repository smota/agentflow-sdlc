# Goldfish Review Report (Intermediate Zoom-Out Pass)

**Target:** `docs/designs/governed-factory.md` (`lines 1-916`)

**Earlier report:** `zoom_out_report.md`

## Reviewer Status

| Reviewer       | Status    |
| -------------- | --------- |
| `egm-zoom-out` | completed |

## Change check against the earlier report

The target has not changed since the earlier report. The reviewer tested these citations and each still sits on its original line:

- Overview line 11, line 21 ("D1-D22") and line 578 ("D1-D26").
- W0-2 at line 679, with the wrong `AGENTS.md` "lines 62-64".
- M0-4 at lines 719-720, Alternative C at lines 301-305, and the plan header at line 599.
- The `-` to `*` bullet switch at line 907, and the M5 numbering that skips M5-5.
- Alternatives A to AQ (43), 17 deviations, and the Draft status line.

None of the earlier findings was addressed by an edit. The reviewer also re-verified two code claims from the earlier report. `AGENTS.md` lines 60-64 are "Branch discipline", with the human-review rule at line 69. `CORE_API_PREFIXES` is at `scripts/audit-reachability.mjs:575`.

Note: the reviewer persona file was found at `agents/zoom_out.md`. The path `agents/egm-zoom-out.md` does not exist.

## Prioritized Findings (Blockers -> Major -> Nits)

No new Blockers. The two Blockers from the earlier report (B1, B2) still stand.

### Launcher handles untrusted git state on the host while holding the builder token - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** "How a unit of work flows" steps 4, 6 and 7 (lines 199-202); M1-4 (line 761); working-copy Open Question (line 75)
- **Discrepancy Description**: The launcher creates the working copy and the sandbox mounts it. The launcher then takes the commits out of the sandbox, checks scope, and pushes with the builder App token. A candidate that can write the working copy can also write its `.git` metadata. That includes hooks, config values such as `core.fsmonitor` and `core.sshCommand`, filters, and attributes. The launcher's own `git` calls on the host, which holds the App token and the Windows login, would then run attacker-chosen code. G2's red-team list covers only "write outside its worktree". It does not cover writes to git metadata inside the worktree. The Substrate contract's suite list (line 211) does not either.
- **Rationale & Recommendation**: This is a separate escape route from the credentialed-verifier hole in B2, and it sits on the execution plane. State the collect step as an architecture rule. Export only a patch or git bundle from the sandbox. Apply it in a fresh host-side clone with hooks and config overrides disabled. Push from that clone. Add a canon case in which the candidate plants a hook or `core.fsmonitor` value and the host must not run it.

### `factory-core` is never defined - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Components row "Control repository" (line 177); autonomy ladder (line 236); CUJ 7; W0-5 (line 682); M1-6 (line 769)
- **Discrepancy Description**: The autonomy ladder, the 24-hour time-lock and the "human-built" labels all depend on `factory-core`. The text says path classes live in the control repository "as globs" and that ADR 021 will record them, but no design-level rule says what belongs in `factory-core`. M1-6 calls `lib/providers/registry.mjs` and its neighbours "`factory-core` and human-built". M2b-1 and M1-13 change `lib/core/gate.mjs`, `delegation-grant.mjs` and `review-attestation.mjs`, which are plainly trust-bearing. Overview line 11 says agents carry out the work. The L2/L3 boundary and the time-lock are therefore undefined, and which files the factory may merge unattended is left to an ADR written in week 0.
- **Rationale & Recommendation**: State the membership rule in the design: anything that judges, signs, contains, or decides a merge, or that edits the verifier, the control-repository reader, the workflows, `manifests/`, or the governing documents. List the initial globs. Say which plan items are human-built, so "the factory builds itself" can be measured. The case study's case A and case B labels depend on it.

### Reachability audit extension misses the directories the plan creates - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** G1 (line 45); Conventions bullet (line 612); M0-1 (line 709); M1-2 (line 756)
- **Discrepancy Description**: The audit reports exported functions only for `VALIDATOR_NAME_RE` names and `CORE_API_PREFIXES` (`scripts/audit-reachability.mjs:575-604`), and its own comment says flagging all of `lib/` "would be far too broad". M0-1 adds only `lib/audit/`, `lib/gates/`, `lib/qa/` and `lib/runtime/`. The plan then creates `lib/substrate/`, `lib/signing/`, `lib/evidence/`, `lib/gxp/` and `lib/learning/`, plus top-level `lib/claims-ledger.mjs`, none of which is covered. The Conventions bullet says new library code "needs a caller reachable from `bin/cli.mjs`" (`audit-reachability`), which is true only for validator-shaped names and the listed prefixes. `SCAN_ROOTS` (line 208) is `lib`, `scripts` and `bin`, so `adapters/**` is not scanned, and M1-2's "the suite counts as the adapter's caller" has no effect on the audit.
- **Rationale & Recommendation**: The design diagnoses "an unwired module passes CI because the audit scans too little" as its root failure, then builds about 40 new modules outside the scanned set. Add the new prefixes to `CORE_API_PREFIXES` in the same PR that creates each directory. Or state a different mechanism, such as a ledger rule that every `implemented` row's importer is checked. Correct the Conventions sentence.

### G1 promises CI enforcement on public product pages, but website checking is optional - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** G1 (line 45); M0-3 `validate-claims-ledger.mjs` (line 715); X-3 (lines 889-890)
- **Discrepancy Description**: G1 says CI fails on a new `MUST` or `INVARIANT` line "in ... the public product pages" without a ledger row. The website is a different repository. The validator checks it only with an optional `--external-root` flag, and `validate:release` runs without it. The false read-only claim that started this work (Problem 1) lives on those pages.
- **Rationale & Recommendation**: "Anyone can rerun the check" does not hold for that part of G1. Either narrow G1 to this repository and state that the website is checked by `npm run validate` in the other repository with a ledger-derived banned list. Or add a scheduled or release-time job that checks out both repositories.

### Headline conformance claim contradicts the signing-seam statement - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Overview line 19; M5-1 (line 874); lines 213 and 588
- **Discrepancy Description**: Line 19 says "two implementations passing each port's suite". The signing seam has one implementation, and the design refuses to call it pluggable until a second one passes (the second is deferred to Future Improvements). The evidence-verify and GxP components also have no second implementation. "Each port" is therefore false as written, and the design's own rule (line 45) forbids "supports X" without a passing run.
- **Rationale & Recommendation**: Name the ports the report covers. The substrate port is the one with two implementations, and the source port may also qualify. State that signing is reported as a single implementation. Fix line 19 and M5-1 to match.

### A new "circuit breaker" is not reconciled with existing breaker, freeze and pause states - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M2b-4 `lib/runtime/circuit-breaker.mjs` (line 834); CUJ 2; W0-14; M1-8
- **Discrepancy Description**: A code search found existing concepts. `lib/core/decision-policy.mjs` has a `circuit-breaker-exhausted` rule and a `ledger.frozen` escalation. `lib/runtime/dispatch.mjs:105` has `trip_circuit_breaker` targeting `steer.lead`. `docs/agent-workflow.md` §13.4 is titled "Deterministic Ledger Circuit Breaker". `frozen` also appears in `lib/core/run-state.mjs`, `run-service.mjs` and `scripts/steer.mjs`. The plan adds a module of the same name with different semantics (reverts in a time window). It also adds a third halt authority beside local `coordinator.json` and control-repository `pause.json`; the earlier report's N9 covered only the first two. The design neither reuses the existing trip-to-`steer.lead` path nor says how the breakers relate, nor whether a ledger freeze should stop the coordinator.
- **Rationale & Recommendation**: Rename the new module (for example `revert-budget`). Decide whether the revert trip routes through the existing `trip_circuit_breaker` dispatch to `steer.lead`. State one halt-precedence rule covering ledger freeze, coordinator state and `pause.json`.

### Self-build and bootstrap sequence is unspecified - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Overview line 11; line 240 (week-0 gate); Known risks lines 259 and 262; "release N-1 governs release N" (lines 121 and 569); milestone tables
- **Discrepancy Description**: The Overview says the work is "carried out by agents through AgentFlow", yet the factory's containment, merge path and verifier do not exist until M1, M2 and M2b. The design says only that week-0 and M0 work "continues attended". Nothing says which milestones are built attended and which by the factory, or when self-hosting begins. "N-1 governs N" has no first term: the first pinned verifier has no earlier release, nothing says who produces it, and M2-2 makes writing its digest a human act. Z-N4 (no timeline) covers duration, not this ordering.
- **Rationale & Recommendation**: Add a short bootstrap subsection covering which milestones attended agents build and which the factory builds, the point at which the factory starts building its own changes, how the first verifier digest is produced and trusted, and how the case study separates attended work from dark work.

### M0-9 file list does not match the tree despite "Paths were checked" - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M0-9 (lines 731-734); plan header (line 599)
- **Discrepancy Description**: The row says to keep `intake`, `evidence`, `status`, `config`, `queue-port`, `queue-id` and `intake-body` in `lib/bridge`, and to delete `start`, replay, `escalate`, `cleanup`, `worktrees-port` and `slice-worktrees`. `lib/bridge/` actually contains `bridge.mjs`, `config.mjs`, `evidence.mjs`, `intake-body.mjs`, `memory-queue.mjs`, `queue-id.mjs`, `queue-port.mjs` and `worktrees-port.mjs`. There are no `intake`, `status`, `start`, replay, `escalate` or `cleanup` modules; those are functions inside `bridge.mjs`, so the trim is surgery in one file. `memory-queue.mjs` is used by four tests and is in neither list. `slice-worktrees` is `lib/runtime/slice-worktrees.mjs`, not a bridge file, and `scripts/bridge.mjs` imports `defaultGit` from it.
- **Rationale & Recommendation**: The "about 1,150 source lines" target is not traceable to files. Correct the file names and mark the row provisional until W0-13 confirms the keep list.

### Pi, Gemini and Grok routing statements are slightly wrong - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Non-Goals (line 56); Design principle 6 (line 171); M0-11 (line 745); Alternative AD (line 466)
- **Discrepancy Description**: ADR 015 removed the `pi-cli` provider, not Pi. Pi stays a runtime platform and "OpenRig runs Pi seats". `lib/config/execution-distribution.mjs:15-16` routes both `gemini` and `grok` through `pi`, but M0-11 fixes only Gemini. Alternative Y trims the OpenRig adapter to a minimal scenario, and the design does not say how Pi seats stay supported afterwards.
- **Rationale & Recommendation**: Say "the removed `pi-cli` provider". Include the Grok route in M0-11, or say why it is left. State in one line how Pi remains supported after the trim.

### G8 quickstart metric differs from the check that proves it - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** G8 (line 52); M0-8 (line 729); Verification Plan "Quickstart" (line 904)
- **Discrepancy Description**: G8 says "a first governed PR in under 10 minutes". M0-8 and the Verification Plan time the six-command path to "first local evidence", which is not a governed PR.
- **Rationale & Recommendation**: Align the goal wording with what is measured, or add a measurement for a governed PR.

### Core modules given jobs that need network or process access, with no injection seam stated - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Conventions (line 605); M1-13 (line 789); M2b-1 (line 822)
- **Discrepancy Description**: `lib/core/` must stay free of network and process calls. M1-13 makes `satisfyGate` in `lib/core/gate.mjs` require a "verified signed act" whose verification "GitHub reports", which is a network result. M2b-1 makes `verifyDelegationDecision` in core check a signature. The existing pattern is an injected port, as with `resolveReviewEvidence` in `steering-merge-policy.mjs:95`, but the design does not say it applies here.
- **Rationale & Recommendation**: State that core receives an already-verified result through a port, and that `lib/signing/**` supplies it.

## Carried over, unchanged

All of these are still unaddressed. The document still contains the text they criticise. IDs refer to `zoom_out_report.md`.

- **B1** governing-document contradictions and the "no person in the loop" overclaim.
- **B2** pinned verifier executing candidate code while holding secrets.
- **M1** scope exceeds the month-6 claim.
- **M2** plan, alternatives and deviations embedded in the design.
- **M3** brief not available to a reader, and D-range 22 versus 26.
- **M4** Week 0 overloaded and builds throwaway code.
- **M5** vendor-terms risk without a named fallback.
- **M6** open questions with obvious defaults, and the offline-verification and RFC 3161 gap.
- **M7** `lib/` importing from `scripts/`, and validators that are not importable.
- **M8** repository-wide "fencing" rename.
- **M9** OpenRig trim on the critical path.
- **M10** coordinator as a model session, overlapping `actuate-readiness`.
- **M13 to M25**, as listed in the earlier consolidated table (M11 and M12 were never used).
- **Z-N1 to Z-N7** and the catalyst Nits **N8 to N10**.

## Addressed by edits

None.

## Summary

| Severity | New findings | IDs                                                                                                                                             |
| -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocker  | 0            | none                                                                                                                                            |
| Major    | 7            | N-1 launcher git metadata, N-2 `factory-core`, N-3 audit coverage, N-4 website check, N-5 conformance claim, N-6 circuit breaker, N-7 bootstrap |
| Nit      | 4            | N-8 M0-9 file list, N-9 Pi/Gemini/Grok routing, N-10 G8 metric, N-11 core injection seam                                                        |

Open count including the earlier report: 2 Blocker, 30 Major, 14 Nit. Verdict unchanged: the document does not yet pass the zoom-out standard.
