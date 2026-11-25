# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (lines 1-1016)

**Pass:** Round 2, intermediate zoom-out. It covers what `docs/designs/governed-factory/review-round-2/zoom_out_report.md` (IDs F-n) and `docs/designs/governed-factory/review-round-2/comprehension_report.md` (IDs C-n) missed. It also covers whether their suggested mitigations add scope.

Reuse claims were checked by read-only search of the repository. `docs/designs/governed-factory/review-round-1/` was not read.

## Reviewer Status

| Reviewer       | Status    |
| -------------- | --------- |
| `egm-zoom-out` | completed |

## Summary

Both earlier reports cover the architecture and trust questions well. They did not examine the scope of the Detailed Implementation Plan, or how much of the document sits below architecture altitude. Most new findings come from that gap.

New findings: 0 Blocker, 4 Major, 9 Nit.

## Prioritized Findings (Blockers -> Major -> Nits)

### N-1. The OpenRig trim has no goal behind it - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** "What is reused, new and retired" (line 282), Deviation 7 (line 307), Alternative Y (lines 467-471), W0-13 (line 781), M0-9 (lines 825-832), M2b-2 (line 924), Verification Plan (line 1007).
- **Discrepancy Description:**
  - G1 requires that claims be backed or retracted. It does not require deleting code.
  - M0-9 and its neighbours amount to a program-sized refactor. It trims about 18k lines of adapter code. It deletes about 12 adapter modules, four docs and a set of bridge modules. It also edits `package.json`, the manifests, `agent-workflow.config.json`, `bin/cli.mjs` and `scripts/validate-docs.mjs`. It amends ADR 016, adds a new ADR (027) and closes issues.
  - The trim removes capabilities that adopters may use: handoff verbs, recovery and mutation.
  - Deleting dead code is cleanup, and cleanup is not a root-problem fix.
- **Rationale & Recommendation:**
  - Mark the OpenRig claims `retracted` or `planned` in the ledger. Give the unwired modules `planned` exemptions in the reachability audit.
  - Move the trim to a post-month-6 follow-up issue, as `AGENTS.md` prefers. Drop W0-13 and ADR 027 from week 0.
  - This also removes the need for C16 (explain OpenRig inside this document).

### N-2. Two run-limit mechanisms, and the second misuses the existing quota windows - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** W0-14 `run-cap.mjs` (line 784), M2-5 (line 903), Performance (line 651).
- **Discrepancy Description:**
  - Week 0 builds a new persisted per-window run counter.
  - M2-5 then adds a `daily` window to `ALLOWED_QUOTA_WINDOWS` in `lib/config/quota-policy.mjs`. It also adds a "counter" to `budgetAdmission` in `lib/core/delivery-policy.mjs`.
  - `ALLOWED_QUOTA_WINDOWS` today is `['weekly','five-hour']`. It describes provider-observed percent-remaining quota windows.
  - `budgetAdmission({budget, used, estimatedNext})` is already a stateless admission check with no window concept. A persisted run counter can feed it directly.
  - Adding `daily` to the quota-policy windows is a semantic mismatch. It also touches a validated schema (`validateQuotaControlPolicyShape`) for no gain.
- **Rationale & Recommendation:** Keep one persisted run counter, from W0-14, and call `budgetAdmission` with it. A daily window then becomes a config value on that counter. Drop the quota-policy change in M2-5.

### N-3. The Alternatives section is 31% of the file and duplicates ten planned ADRs - Severity: Major (altitude)

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** "Alternatives Considered" (lines 319-633, 52 entries). Compare W0-1 to W0-11 (lines 765-776).
- **Discrepancy Description:**
  - Only Alternatives A to J are program-level choices.
  - Alternatives K to AZ are component-level or micro-decisions: the signing seam, sandbox products, npm packaging, a screencast, the in-flight cap off-by-one, a surface-count CI check, directory placement and wording.
  - Week 0 writes ADRs 019 to 026 to hold exactly these decisions: substrate, control repository, signing, envelope, ledger, GxP and intake.
  - The decisions are therefore recorded in this document, in the brief, and again in the ADRs. That is the single-source-of-truth risk F7 names, but F7 only looked at the plan.
  - Together with the plan (about 32%), roughly 63% of the file sits below architecture altitude.
- **Rationale & Recommendation:** Keep A-J, plus the few alternatives that change the architecture: the Windows microVM substrate, human merge versus agent merge, and the control repository. Move the rest into the ADRs that W0 already creates, and link them from here.

### N-4. Two layers copy the 416-line Codex provider, and a new provider-loading mechanism sits beside an existing hook - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M1-6 (lines 862-863), M1-4 (line 855).
- **Discrepancy Description:**
  - M1-6 creates `claude-engineering.mjs` and `agy-engineering.mjs`, each "modeled on" `lib/providers/codex-engineering.mjs`. That file is about 416 lines. The result is two near-copies, which the plan itself says are "human-built" `factory-core`.
  - The launcher (M1-4) then separately prepares the workspace, collects the diff and writes the receipt. The codex-engineering pattern already includes snapshot-before-and-after and a scope flag. Those two layers do overlapping work.
  - M1-6 also adds a config-driven `providers` array to `schemas/delivery-config.schema.json`. `builtInProviders()` in `lib/providers/registry.mjs` already accepts `additionalProviders`. Only first-party providers will exist, so a schema-level loader is speculative.
- **Rationale & Recommendation:**
  - Write one parameterised engineering provider with a per-vendor argument builder.
  - Decide whether the launcher or the engineering provider owns snapshot and receipt, and give that job to one of them.
  - Drop the config-array change. Register by code, as `codexEngineering` is today.

### N-5. Orphan controls: a "morning digest" and an alert nobody receives - Severity: Nit (close to Major)

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Known risks "Admission gates stall" (line 296), Open Question on the alert channel (line 77), M1-14 (line 885), "Kill authority" (lines 178, 256).
- **Discrepancy Description:**
  - The coordinator's "morning digest" appears only in the risks list. No work item builds it. The Verification Plan (line 1013) already covers the gate list through `gates waiting`.
  - The watchdog "only writes `.agentflow/alerts.json` and exits non-zero", and the channel is an open question. A file nobody reads is not a control. The dead-man, host-down and `sbx`-stale detection that G7 relies on all depend on it.
  - "Kill authority" appears in the account-settings acts with no definition.
- **Rationale & Recommendation:** Delete the digest sentence, or define it as the `gates waiting` output. Fold the watchdog into the existing coordinator `status` verb until the alert channel is chosen. A new script and test before then is premature.

### N-6. Two parallel event channels for the same facts - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M1-11 (lines 876-877), M5-2 (line 974), Non-Goals (line 60).
- **Discrepancy Description:**
  - M1-11 adds seven new kinds to `OBSERVATION_FIELDS` in `lib/observability/events.mjs` (sandbox lifecycle, egress, kill, merge, revert, breaker, learning). It also adds label keys, numeric fields and a correlation ID.
  - The same facts go into run-state events and receipts, and the case study reads them "from the run store". This creates a second record of every event.
  - Non-Goals exclude SIEM export beyond the existing optional OpenTelemetry path, so the metrics path is optional.
- **Rationale & Recommendation:** Record once in run-state or receipts. Add OpenTelemetry kinds only if a named consumer exists.

### N-7. The claims-ledger validator carries linting rules beyond what G1 asks - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M0-3 (lines 807-809), M0-10 (line 837), Verification Plan (line 1008).
- **Discrepancy Description:**
  - G1 asks for a row per `MUST` or `INVARIANT` line, no unwired module, and "supports X" backed by a conformance run.
  - `lib/claims-ledger.mjs` also bans specific phrases ("compliant", "validated", "fencing", "no person in the loop"). It checks that high-assurance sentences carry "by default". It checks glob-count rows. It checks that each quote still exists at a `file:line`.
  - That is a prose linter wrapped in a ledger. The `file:line` anchors rot on every doc edit. Each rule becomes a standing CI gate on every documentation PR.
- **Rationale & Recommendation:**
  - Ship three checks: a row per keyword line, `implemented` needs a non-test importer plus a test, and the quote is still present (matched by text, not line number).
  - Keep the banned-phrase list short and in one place.
  - Treat the "by default" rule as a one-time W0-20 review, not a standing check.

### N-8. Stale citation, and the fencing rename is broad for a word change - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M0-10 (lines 833-837), Deviation 12 (line 312).
- **Discrepancy Description:**
  - M0-10 says to "check the six 'fencing' mentions in `scripts/validate-docs.mjs`". The reviewer found none in that file. In `scripts/`, "fencing" appears in `steer.mjs` (9 times) and `process-pilot.mjs` (1).
  - The rename touches about 25 files plus a new wording rule, to remove one retracted claim's vocabulary. That is the cost the author accepted when rejecting Alternative AB. It is still the largest wording change in M0.
- **Rationale & Recommendation:** Correct the citation. Confirm the rename scope after a repository search at M0 start. Consider retracting only the lease-fencing claim and defining the two live terms once in `docs/glossary.md`.

### N-9. Signing and evidence seams carry speculative structure - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Evidence envelope (line 217), M1-5 (line 860), M1-13 (lines 881-883), M3-3 (line 945), M2b-1 (line 919).
- **Discrepancy Description:**
  - The envelope's `substrate` and `evaluator` blocks are "present but null until used, so signed history never needs a migration". Line 659 already sets the migration rule: "Schemas change additively, with dual-read". The null blocks contradict that rule and have no consumer. M1-5 also adds `evaluator` to `execution-receipt`.
  - The signing seam has a single GitHub implementation, and the design declines to call it pluggable.
  - The timestamp seam is built and run nightly, although it is "optional".
  - M2b-1 keeps `local-cooperative-issuer` as development-only beside the new signed issuer.
- **Rationale & Recommendation:** Remove the `evaluator` block, and the `substrate` block until the launcher populates it. Build GitHub-verified signing as a direct module and introduce the interface when the second implementation arrives. Do not keep a second issuer unless a test needs it.

### N-10. The new "circuit breaker" collides with the existing one - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M2b-4 `lib/runtime/circuit-breaker.mjs` (line 933), CUJ 2 (line 91).
- **Discrepancy Description:**
  - A rework circuit breaker already exists in `lib/core/decision-policy.mjs` as `HUMAN_ESCALATION_REASONS.CIRCUIT_BREAKER`, with a default round limit.
  - There is also a `trip_circuit_breaker` seat action in the lease dispatch. `session-telemetry` counts `circuitBreakerTrips`, and `refinement-engine` maps those trips to turn limits.
  - A revert-count breaker with the same name will be merged into those telemetry totals and into the learning input.
  - C9's request for a rework path also has an existing answer: rework rounds already have a ceiling.
- **Rationale & Recommendation:** Rename the revert counter, for example "revert breaker". Reuse the existing escalation reason or action for its trip signal. Reuse the existing rework rounds for failed-check handling.

### N-11. Factory pause and resume overlap the existing `run pause` and `run resume` - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** W0-14 (lines 782-783), M1-8 (lines 866-868), "Coordinator states" (line 272).
- **Discrepancy Description:** `agentflow-sdlc run pause|resume|checkpoint` and the run-state `paused` status already exist (`scripts/run-delivery.mjs:837`). The design adds a third state set: `coordinator.json` with running, draining, paused and killed. It also adds a separate `coordinator` verb group and `pause.json`, and never relates them to per-run pause.
- **Rationale & Recommendation:** Define the factory pause as program-level admission only. Let in-flight runs use the existing run pause. Say so in one sentence.

### N-12. The GxP section ships more than G6 and G8 require - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M4-1 and M4-2 (lines 955-961), X-2 (line 987), Non-Goals (line 63).
- **Discrepancy Description:**
  - G6 asks for a trace generator and clause mapping. G8 asks for a supplier table and a responsibilities table.
  - The plan also builds a `kind: compliance` extension pack with its own README, principles, validator and test. It adds five templates, including intended-use, risk-assessment and signature-manifestation.
  - There is also a `lib/gxp/signature-manifest.mjs` module. That makes two homes for one feature.
  - X-2 adds a "CAPA-style record" even though Non-Goals exclude a CAPA lifecycle.
- **Rationale & Recommendation:** Ship the core generator, the versioned mapping data and the two tables. Defer pack packaging and the extra templates until a prospect asks.

### N-13. The demo recording and website pages are presentation work in the delivery path - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M5-6 (lines 978-979), X-3 (lines 988-989), "If time slips" (line 660).
- **Discrepancy Description:** `record-demo.mjs`, a committed asset directory and six new website pages sit under Non-Goals "no business work". The "If time slips" list cuts "the website and manuals" but not the recording or the demo recording check in the Verification Plan (line 1014).
- **Rationale & Recommendation:** Move the recording behind the website in the cut order. Keep `demo-skeleton.mjs` only as a test fixture.

## Mitigations that add complexity

These are suggestions in the two earlier reports that would grow scope or add components.

- **F1** (stage 2 in an egress-denied sandbox from the same substrate port).
  - `sbx` runs on the author's Windows host. The verifier runs on hosted CI, so hosted CI cannot use that substrate port.
  - The only routes are a self-hosted runner, which Alternative V rejected, or a second sandbox mechanism in hosted CI. It also adds a per-PR attempt-limit counter and state.
  - Simpler: split the hosted verifier into two jobs. A secretless job builds and runs the candidate's own tests. A second job receives only the holdout material and the built artifact, with no attestation or control-repository credential, and returns pass or fail. Document the residual egress risk.
- **F9** (credential-injecting proxy, or a per-run vendor identity). Either adds a proxy to patch, or a vendor identity with terms risk. Recording the accepted residual risk and a spike check costs less.
- **F10** (deterministic actuator, separate token process, scheduler, advisory model).
  - As written it adds four components.
  - `scripts/steer.mjs` is already deterministic and already holds the merge path (`verifyMergeGates`, `--match-head-commit`). M2b-2 extends it.
  - The reducing variant is to run that script from a scheduled task and drop the model steward session. That removes a component and the quota spent on coordinator and steward sessions.
- **F11** (move the pointer into the verifier release and host config). This adds per-repository pinned configuration. Classify the pointer file as `factory-core` and have `validate:authority` check it. That is one rule.
- **F12** (host principal kind, host-held key, labelled trust tiers, mandatory timestamps).
  - It adds key custody and rotation, a new trust tier and an external timestamp authority. It reverses Alternative L.
  - Simpler: state that host-reported fields are self-reported in the verifier output and the case study. Digest the `sbx` logs. Make the timestamp seam default-on for G5 only.
- **F13** (mechanical-revert class, queue hold, actuator identity, path-ownership edit). This adds a fast path and a new principal. A single time-lock waiver rule is smaller: "the revert's tree digest equals the last attested tree".
- **F14** (extending lock, notifications, steward auto-pin).
  - Auto-pin reverses Alternative AX. It adds a rollback path and makes notifications load-bearing.
  - The extending lock can reuse the `checkins/` tags that already exist: the lock holds until a check-in tag postdates its start. That needs no new infrastructure.
- **F15** (a named fallback reviewer pair). This brings a third vendor's terms, quota and conformance case into scope, and conflicts with the D3 decision to use Claude and Agy only. A cheaper option is to state the attended-only fallback and stop.
- **F20** (cursor, ETag and adaptive tick). This is premature optimisation. The design already measures tick cost from week 1. Do it only if the measurement shows a problem, and note that it needs a periodic full sweep as a safeguard.
- **F21** (extra trusted `merge_group` workflow). This adds another workflow to the verifier surface. Check the ruleset-required workflow option in the week-0 spike first.
- **F22** (human-built, attended or dark tag per item, plus attended L1 admission). This adds a fourth mode to the ladder and per-item accounting. Rewording the Overview sentence is the smaller fix.
- **F19** (give the surface check a single owner). This would add a validator the author declined (Alternatives AK and AL). Keep it as a convention.
- **C4** (decision glossary for D1 to D38). This copies the brief, which creates a second source of truth. Prefer one-line technical reasons inline, which is F17.
- **C5** (milestone table). The same facts already live in the nine `goals/gf-*/goal.json` files (W0-19). Link to the goal files instead of re-listing them.
- **C11** (definitions at first use). `docs/glossary.md` exists and already covers some of these terms. Link to it and add only the missing entries.
- **C16** (explain OpenRig in this document). Resolve N-1 instead and the explanation is not needed.
- **C17** (default RFC 3161 timestamps). This makes an external authority a hard dependency of G5. Define the default timestamp source as GitHub attestation time plus the record's own chain, and keep RFC 3161 optional.
- **C6 and C8** (holdout authoring and the ready label). If the answer is per-issue human authoring or a human label, that conflicts with CUJ 1 ("the author took no action"). Resolve with generic holdouts, authored once and refreshed. Name a single human act for admission, if that is the answer.
- **C19** (align G8's "first governed PR"). The literal reading would need the Apps and control repository inside the quickstart. Reword G8 to "first local evidence", which matches M0-8.

## Carried over (already in the earlier reports)

- F1 verifier executes candidate code beside secrets (Blocker).
- F2 unconditional merge drives the largest costs.
- F3 learning pipeline, no goal requires it.
- F4 modules wired to satisfy the audit (supervisor, sweeper, QA verifier, tester lane).
- F5 deletes worktree, bridge and intake code, then rebuilds equivalents. The `containment` facet overlaps the `execution` facet.
- F6 second substrate built to justify "pluggable".
- F7 the plan is a backlog at the wrong altitude.
- F8 week 0 is overloaded.
- F9 Agy login inside the sandbox.
- F10 coordinator and steward are model sessions.
- F11 control-repository pointer in an agent-editable file.
- F12 host receipts are self-asserted.
- F13 revert versus gates and the steering write guard.
- F14 dark factory versus a 24-hour veto, a 7-day check-in and the human verifier pin.
- F15 no degraded mode for cross-family review.
- F16 and F17 human-act ownership stated twice; "D-number" citations the reader cannot see.
- F18 and F19 speculative additions M1-5 and M2-5; surface growth bounded by convention.
- F20 and F21 polling cost; verifier in the merge queue.
- F22 "builds itself" overstated.
- C1 bootstrap sequence (Blocker).
- C2 review attestation provenance (Blocker).
- C3 WSL2 versus `sbx` contradiction in the Overview.
- C4 undefined D-numbers.
- C5 milestones undefined.
- C6 holdout authoring.
- C7 verifier execution model.
- C8 issue creation and the ready label.
- C9 failure and rework paths.
- C10 coordinator and steward identity.
- C11 undefined vocabulary.
- C12 candidate digest.
- C13 `factory-core`.
- C14 "lane".
- C15 "evaluator".
- C16 OpenRig.
- C17 timestamps.
- C18 human acts completeness.
- C19 G8 mismatch.
- C20 open versus settled decisions.
- C21 delegation wording.
- C22 unspecified parameters.
- C23 to C28 process references, "Agy", GxP terms, G5 wording, numbering, "dark".

## Severity count

0 Blocker, 4 Major, 9 Nit (new findings N-1 to N-13).
