# Goldfish Review Report

**Target:** `docs/designs/governed-factory.md` (lines 1-1016)

Mode: REVIEW. Two independent reviewers read the full file. Neither read `docs/designs/governed-factory/review-round-1/`.

## Reviewer Status

| Reviewer                 | Status    |
| ------------------------ | --------- |
| `egm-zoom-out`           | completed |
| `egm-inventive-catalyst` | completed |

## Severity Summary (after deduplication)

| Severity | Count |
| -------- | ----- |
| Blocker  | 1     |
| Major    | 14    |
| Nit      | 7     |

The inventive-catalyst lens reports only Major or Nit findings, because its findings are advisory. Two overlapping pairs were merged. The first is the verifier-secrets finding, which the zoom-out lens rated Blocker and the catalyst lens rated Major. It is kept as one Blocker. The second is the Agy credential finding, which the zoom-out lens rated Nit and the catalyst lens rated Major. It is kept as one Major.

Some catalyst claims about GitHub behavior (`pull_request_target`, `merge_group`, open egress on hosted runners) come from the reviewer's background knowledge. They were not verified in the repository. Treat them as items to confirm in the week-0 spikes.

## Prioritized Findings (Blockers -> Major -> Nits)

### F1. Pinned verifier runs candidate code in a job that holds secrets - Severity: Blocker

- **Reviewer Lens:** `egm-zoom-out`, `egm-inventive-catalyst`
- **Affected Scope:** "Trust boundaries" table (lines 221-228), Components row "Pinned verifier" (line 182), Open Question on where the verifier runs (line 74), M2-1 and M2-2 (lines 891-898), M2b-4 (line 932), M3-2 (line 943). Also G4 (line 49) and the no-op check and post-merge canon run (lines 226, 234).
- **Discrepancy Description**:
  - The trust table says the verifier holds the control-repository read credential and attestation permission, and "cannot run workflow code a PR supplied". That covers the workflow file only.
  - The same job runs the holdouts, the no-op test check and the full suite against the PR's tree. The post-merge job runs the full suite and canon. A builder-authored test therefore executes in a job that can read holdouts, seeded defects and the canon, and (on a hosted runner with open egress) can send them out.
  - The attestation job (line 943) has the same shape. Merged code running with `id-token: write` and `attestations: write` can mint attestations for forged evidence.
  - The G4 negative test ("the builder token cannot read holdouts") proves the wrong boundary. It does not show that builder code cannot read them through the verifier.
- **Rationale & Recommendation**:
  - This undermines G4, G5 and the principle that what judges a change is never part of the change. The design defers it to "which one the author's plan allows".
  - Split the verifier into stages. Stage 1 has no secrets and builds the candidate and runs its own tests. Stage 2 runs the holdouts and canon black-box against the built artifact, in a fresh, egress-denied sandbox from the same substrate port. It receives holdouts through a trusted step and returns only pass/fail and a reason code. A separate attestation job never executes candidate code.
  - Secondary liabilities: holdouts must target the artifact's external interface (white-box holdouts are lost). The verifier gains a second substrate dependency. CI latency and cost rise. A pass/fail oracle still leaks some information over many PRs, so add a per-PR attempt limit, which can stall legitimate retries.

### F2. Unconditional agent merge drives the largest costs and is not needed for the stated root problem - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Problem item 3 (line 33), G3, Alternative C (lines 335-339), "Policy changes this design requires" (lines 238-248), W0-20 (lines 792-797), M2b (lines 914-934), "If time slips" (line 660).
- **Discrepancy Description**: The root problem is claim honesty, containment and outsider-verifiable evidence. None of that needs the steward, the time-lock, the revert path, the circuit breaker or L3 self-modification of `factory-core`. Agent merge forces the policy rewrite across about 26 governing documents (W0-20), a third owner for configuration authority, and the weaker "partial" e-signature story (lines 50, 115, 645). That cuts against the regulated-buyer thesis in the Overview. The "If time slips" list never cuts M2b. Problem 3 already assumes the solution.
- **Rationale & Recommendation**: Make M0, M1, M2 (L1/L2 with human merge) and M3 the committed program, since they deliver G1, G2, G4 and G5. Treat M2b, L3 and the W0-20 rewrite as a separate, later decision. Today every week-0 milestone assumes the rewrite lands before the first unattended run.

### F3. Learning pipeline is scope that no goal requires - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Components row "Learning pipeline" (line 191), "Learning boundary" (lines 274-276), W0-3 (line 768), M4-3 (lines 962-966).
- **Discrepancy Description**: G1-G8 do not mention learning. M4-3 adds three libraries, a new seat, three CLI verbs and a refinement-engine rework. The design admits the input is agent-writable and the reward does not yet exist (line 276). The non-goals already defer external optimizers.
- **Rationale & Recommendation**: Retract the `refinement-engine` claim or mark it `planned` in the ledger, which is cheap. Drop M4-3, W0-3 and the boundary section until a goal needs them.

### F4. Modules are wired to satisfy the audit, not because a goal needs them - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M1-9 (lines 870-872), M2-10 and the tester lane (lines 184, 909-912), Alternatives AE and AF (lines 503-513).
- **Discrepancy Description**: M1-9 rebuilds the process supervisor and gate sweeper (persisted registries, orphan reconciliation, deadlines) mainly to give them product callers. The launcher and substrate `cancel`/`reconcile` already own process-tree kill and orphan cleanup (lines 211, 852). The QA contract verifier is kept by adding a whole tester lane and a built-artifact packaging step, while Alternative AF puts the useful part at about 60 lines.
- **Rationale & Recommendation**: Retract the supervisor and QA-verifier claims, as the design already does for four other modules, or defer wiring until a goal depends on them. Remove the tester lane from M2.

### F5. Design deletes existing code, then builds equivalents - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M0-9 (line 828), M1-1 (line 846), M1-4 (line 855), M1-10 (line 873).
- **Discrepancy Description**:
  - M0-9 deletes `lib/bridge/worktrees-port.mjs` and `lib/runtime/slice-worktrees.mjs`, which already provide create, inspect, remove and sweep for slice worktrees. M1-4 then has the launcher prepare the working copy as new code. `AGENTS.md:92` makes `.worktrees/*` the execution model.
  - `lib/bridge/bridge.mjs` already lists work items, claims through `claimOrYield` and has `reconcile` and an intake path. M1-10 creates `lib/runtime/intake-poll.mjs` as new code, while M0-9 deletes the dispatch half.
  - The existing `execution` provider facet already requires `plan`, `execute`, `status`, `cancel`, `cleanup` and `receipt` (`lib/core/provider-binding.mjs:73-75`), and a `workspace` facet exists. The new `containment` facet and `lib/core/substrate-port.mjs` overlap both.
- **Rationale & Recommendation**: Keep the worktree helpers and the dispatch path the launcher and poller need. Justify what the new launcher and poller add over the existing code, or build on it. State why `containment` is not an extension of `execution` and `workspace`. The simplest option may be the existing `local-cli` provider launching through an `sbx` wrapper, with egress and credential guarantees added to the descriptor.

### F6. A second substrate implementation is built to justify the word "pluggable" - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** G2 (line 46), Components row "Substrate port" (line 181), M2-7 (lines 905-906), Alternative U (lines 443-447), Deviation 5 (line 305).
- **Discrepancy Description**: The design says "pluggable" must not be claimed without a second implementation, then makes G2 require one (the assembled WSL2 stack). Alternative U lists its own weaknesses (most glue, shared kernel, sandbox covers shell commands only). Passing the same suite forces weaker suite semantics or a large build. The weak-adapter negative test (line 853) already shows the suite discriminates.
- **Rationale & Recommendation**: Drop "pluggable" from the claims and defer M2-7 until `sbx` fails its spike or a prospect asks. Keep the containment port and one reference implementation.

### F7. The document is an implementation backlog at the wrong altitude - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** "Detailed Implementation Plan" (lines 685-1014, about a third of the file), "Key shapes" pseudocode (lines 705-757), line-number citations such as lines 803, 813 and 872.
- **Discrepancy Description**: The document says M1 onward depends on what week 0 and M0 find and must be re-verified (line 23), so the M1-M5 rows are speculative and will rot. The ledger row shape, substrate pseudocode and `coordinator.json` field list are code-level detail. The same decisions now live in the brief, this design, ten new ADRs (W0-1 to W0-11, lines 765-776) and milestone goals. That puts the single-source-of-truth principle (`docs/guiding-principles.md:123`) at risk.
- **Rationale & Recommendation**: Keep file-level lists for week 0 and M0 only. Put M1 and later in each milestone goal's exit criteria when it is admitted. Keep interface contracts and cut the pseudocode. Decide whether the ADRs or this design is canonical for each decision.

### F8. Week 0 is overloaded and reaches into the author's policy and accounts - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** W0-1 to W0-20 (lines 763-797), "Known risks: Week 0 is heavier" (line 291).
- **Discrepancy Description**: Week 0 has 20 items: ten ADRs, a kill switch, a run cap, a guarded runner, a gate, three spikes, a baseline, nine goal files and the policy rewrite. Several are not needed before the first contained run (ADRs 019, 025 and 026 describe M4 and M1 work, and W0-13, the OpenRig review). W0-16 and W0-17 feed M3, not the gate.
- **Rationale & Recommendation**: Limit week 0 to the containment floor, the vendor-terms check, the `sbx` spike and the control repository. Move the rest to the milestone that needs it.

### F9. "Agents hold no credential" conflicts with the Agy login inside the sandbox - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`, `egm-zoom-out` (rated Nit)
- **Affected Scope:** Principle 1 (lines 15-16), trust table (line 223, "Agy's is open"), Alternative S (line 434), Credentials (line 642), CUJ 3 (lines 93-97).
- **Discrepancy Description**: "Cannot reach credentials" holds only for GitHub credentials. Alternative S is rejected because a subscription token would sit in the guest. The chosen `sbx` path has the same property for Agy. The egress allowlist must include vendor hosts, so a compromised agent can send the token to an allowlisted endpoint. The rejection reason and the adopted design disagree.
- **Rationale & Recommendation**:
  - Put a credential-injecting egress proxy outside the sandbox so the guest sees only a placeholder (the design already gives `sbx` this role for Claude). Or use a factory-only, quota-capped vendor identity revoked per run or day.
  - Add "Agy token not recoverable from guest" as a week-0 spike pass/fail criterion and as a red-team canon case. At minimum state the scope and the accepted residual risk explicitly.
  - Secondary liabilities: Agy headless OAuth is already a known gap (line 72), so a proxy may be impossible and Agy becomes attended-only. A separate identity may breach vendor terms or add cost. The proxy is one more component to patch.

### F10. Coordinator and steward are model sessions near merge-capable credentials - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 166, 179, 185, 227, 297, 642. M1-7 (host-held App keys).
- **Discrepancy Description**: The steward is a fresh model session per decision that holds the merge App token and reads untrusted issue, PR and comment text. The coordinator is a model session on the same host as the App keys. The design accepts "a hostile issue can waste runs" and relies on the evaluator. But a model holding the token is the violation of principle 1 that the design says it removes. If the steward can only hold or release what the evaluator already approved, the model adds attack surface and no authority.
- **Rationale & Recommendation**: Make the merge actuator and token minter deterministic code that takes only validated structured input (evaluator output, delegation, time-lock state, pause flag). Keep a model only as an advisory, hold-only anomaly flag that can tighten a decision and never loosen it. Keep the token in a separate narrow process no model session can read. Secondary liabilities: edge cases (conflicts, flaky checks) go to the author more often, a deterministic scheduler must be built, and the token process becomes a single point of failure needing a watchdog.

### F11. The pointer to the control repository sits in a file agents can edit - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Line 248, M2b-2 (line 928, `controlRepository` binding in `agent-workflow.config.json`), M2-1 (line 891, "pinned, signed commit").
- **Discrepancy Description**: The design claims agents cannot reach the classifier or the opt-in. But the repository ID and expected ref sit in an ordinary repo file. If that file is not classified `factory-core`, or the classification is itself read through the pointer, an agent PR can repoint the verifier. `validate:authority` rejects trust-bearing keys but does not protect the pointer. The design does not say who owns the pin of "expected ref".
- **Rationale & Recommendation**: Move the control-repository ID and signed-commit pin into the digest-pinned verifier release (a human act) and host configuration. Keep the repo copy informational and fail closed if it differs. State that the pointer file is `factory-core`. Secondary liability: each governed repository needs its own pinned configuration, which complicates adopter onboarding.

### F12. Host-originated receipts remain self-asserted despite attestation - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 33, 187, 213 (signing seam), 392 (Alternative L), 945 (M3-3), G3 and G5 (lines 47, 49).
- **Discrepancy Description**: Problem 3 objects to self-asserted evidence. The fix attests the bundle in hosted CI, but the bundle is assembled from run-store events and receipts written on the Windows host (egress log, kill result, actual model, substrate identity, timestamps). The attestation proves CI saw those bytes, not that the host told the truth. "Zero containment escapes" and the case-study numbers rest on unsigned host material. Alternative L is rejected because host-signed evidence would sit next to the agents, yet the host already holds the App keys. The trust policy has no principal kind for the launcher or host. The RFC 3161 seam is optional and nightly, but G5 requires back-dated timestamps to be caught.
- **Rationale & Recommendation**: Add a `launcher` or `host` principal kind, with a host-held key outside every sandbox signing each receipt at creation. Prefer evidence the substrate produces itself (`sbx` egress and audit logs, digested not summarized). Make `evidence verify` label each claim "CI-attested", "host-signed" or "unsigned self-report". Require the timestamp seam for any record supporting a G3 or G5 claim. Secondary liabilities: key custody and rotation add risk, it still trusts one machine (tamper-evidence, not independence), and a required timestamp authority adds an external dependency.

### F13. Revert without a human conflicts with full merge gates and the steering write guard - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 91, 186, 232-234, 266, M2b-4 (line 932). `manifests/path-ownership.json` lines 51-57 (`steer-write-guard`, `allow: []`) and `AGENTS.md` lines 85, 88.
- **Discrepancy Description**: Merge needs five things, including cross-family review and, for `factory-core`, a 24-hour time-lock. A revert of a bad `factory-core` merge must either wait out the lock while the bad change keeps running the factory, or skip the gates. "Steward cannot write code" (line 227) conflicts with an automated revert and `vX.Y.Z-next.N` tag creation. Steering identities are write-denied in `manifests/path-ownership.json`, and the design edits path ownership only for the learning seat (M4-3) and path classes (M2-2). Up to six PRs in flight may queue on a bad merge, so later reverts conflict.
- **Rationale & Recommendation**: Add a pre-authorized "mechanical revert" class, where the revert's resulting tree equals the last attested good tree (checkable by digest), with no time-lock and no fresh review. Pair it with a queue hold on new `factory-core` merges until post-merge verification of the previous merge completes. Define the revert author as a deterministic actuator identity, not the steering seat, and edit path ownership for it. Secondary liabilities: a new fast path to scrutinize, lower throughput, and non-clean reverts still need a builder run and review.

### F14. "Dark" factory versus a 24-hour veto, a weekly check-in and a human verifier pin - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 11, 121, 236, 260-262, 272, 614, 620, 898, Alternatives AW and AX, canon ratchet (line 934).
- **Discrepancy Description**:
  - The time-lock is a 24-hour veto window (line 121), but the required author cadence is at least every 7 days (line 260). If the author is not watching, the lock lapses and the steward merges, which is a rubber-stamp with a delay. The veto is a human act missing from the Human acts table. The dead-man timer equals the cadence at exactly 7 days, so there is no margin.
  - The human pins a verifier digest of code they did not review, so the human pin is not a meaningful review. Alternative AX is rejected for erosion, but M2b-5 already adds a never-shrinking canon with a ratchet check. The accepted cost is the one Alternative AW was rejected for: verifier changes queue behind the author and the factory can run against a stale judge.
- **Rationale & Recommendation**: Make the time-lock extend unless a check-in or acknowledged notification postdates its start. List the veto in Human acts. Set the dead-man threshold with margin (for example 7 days against a 5-day expected check-in). For the pin, consider letting the steward auto-pin a new verifier digest that passes the canon ratchet, holdouts and time-lock, with the human pin as a veto-able proposal. Secondary liabilities: an extending lock can stall `factory-core` merges while the author is away, notification infrastructure becomes load-bearing, and auto-pinning relies on canon strength and needs a rollback path.

### F15. Cross-family review depends on two vendors with no pre-planned degraded mode - Severity: Major

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 56, 72, 288, 789 (W0-18), 901 (M2-3, `model-family.mjs`).
- **Discrepancy Description**: If either vendor forbids unattended use, the finding "reopens D3 and the merge path" (line 789), and "Agy is the likelier vendor" to force attended-only (line 72). Cross-family review, the central independence property, has no declared fallback. Codex, Grok and Pi stay supported (line 56) but none is the reviewer fallback. M0-M2 weeks are planned before the vendor-terms answer is complete, and the Anthropic Consumer Terms text was not read.
- **Rationale & Recommendation**: Define "other family" as any two distinct registry families and name a fallback pair (for example a Claude builder with a Codex reviewer), with a conformance case in M2-3. The vendor-terms finding then selects between two designed paths and does not reopen the design. Secondary liabilities: another vendor's terms and quota to qualify, `modelFamily()` mapping to maintain, possible subscription incompatibility, and a weaker reviewer family.

### F16. Human-act ownership is stated twice with opposite answers - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Open Question at line 71, "Human acts" table (lines 254-264).
- **Discrepancy Description**: The open question asks whether the assistant might perform week-0 account acts. The table says no agent can, because these acts contain the agents.
- **Rationale & Recommendation**: The table should win. Close the question.

### F17. Rejections cite numbered decisions the reader cannot see - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** References to D2, D3, D4, D5, D11, D12, D13, D17, D18, D21, D26 (lines 21, 56, 202, 369, 465 and elsewhere), "Rejected by author" as the reason for most alternatives, promise at line 321.
- **Discrepancy Description**: A new reader cannot evaluate these rejections without the brief.
- **Rationale & Recommendation**: Give each rejection a one-line technical reason, as line 321 promises.

### F18. Speculative additions inside otherwise justified items - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** M1-5 (line 861, replacing `canonicalJson` in `lib/sparring.mjs`), M2-5 (line 903, a `daily` quota window), "13 surface counts" in Deviation 15 (line 315).
- **Discrepancy Description**: These are opportunistic cleanups and a counter whose need depends on the soak.
- **Rationale & Recommendation**: Defer each until it is shown to block a milestone exit.

### F19. Surface growth is bounded only by a convention - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** Deviation 15 (line 315), Alternative AK (lines 539-543), Risk "Surface growth" (line 292).
- **Discrepancy Description**: About 14 verbs, 6 schemas and 10 ADRs are added, and the only check is "no PR body without a stated reason", which the design itself calls a convention.
- **Rationale & Recommendation**: Give the check a single owner, or keep the deliverable deliberately small.

### F20. Polling cost accepted as a growth law - Severity: Nit

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 196, 457, 649.
- **Discrepancy Description**: `listWorkItems` makes one comment fetch per issue per tick, so cost grows with open issues. The webhook relay is deferred as a non-goal.
- **Rationale & Recommendation**: Use a label-filtered query, an `updated_at` cursor or ETag caching, fetching comments only for flagged items. Add an adaptive tick interval tied to rate-limit headroom. Secondary liabilities: a wrong cursor can miss an update, so a periodic full sweep is needed, and adaptive intervals are less predictable.

### F21. The pinned verifier may not run in the merge queue - Severity: Nit

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 74, 232, 898. The repository's `.github/workflows/` has no `merge_group` trigger.
- **Discrepancy Description**: The design assumes `pull_request_target` or an organization-required workflow supplies the required check and the same check gates the queue. From the reviewer's background knowledge (unverified), `pull_request_target` does not fire on `merge_group`. The design calls the check "unchecked" but does not name the queue interaction.
- **Rationale & Recommendation**: Confirm that an organization or repository ruleset-required workflow is used (it supports `merge_group`), or add a trusted workflow on `merge_group` that calls the pinned verifier by digest. Make this a week-0 spike item. Secondary liabilities: a ruleset-required workflow may need a plan tier the author lacks (see line 73), and queue re-runs add CI cost and latency.

### F22. "The factory builds itself" overstates a human-built core and attended bootstrap - Severity: Nit

- **Reviewer Lens:** `egm-inventive-catalyst`
- **Affected Scope:** Lines 11, 272, 291, 863 (M1-6, "human-built"), Alternative A rationale (line 326), case-study labels (line 52).
- **Discrepancy Description**: Alternative A is rejected as 24-37 focused weeks for one maintainer, but this plan is a superset of that scope in 26 weeks and relies on agent throughput that exists only after M2b. The launcher, port, verifier, signing, coordinator and steward are human-built or attended before then. The Overview sentence "work in this design is carried out by agents" overstates this.
- **Rationale & Recommendation**: Admit L1 work (docs, ledger, tests, mock repository) to the factory under attended supervision once the week-0 gate passes. Tag each work item human-built, attended or dark in the plan and case study, so the Overview claim is exact. Secondary liabilities: attended runs lengthen week 0 and M1, and ledger and case-study accounting grow.

---

## Lens Section: `egm-zoom-out` (Simplicity and scope)

Status: completed. Findings: 1 Blocker (F1), 7 Major (F2-F8, plus the Nit-rated part of F9), 4 Nits (F16-F19). Merged into F9: its Nit about the Agy credential.

Reviewer's overall read: the root problem is real and well argued (documented controls not wired, agents not contained, nothing verifiable by an outsider). The first three goals (G1, G2, G5) address it directly. The context prerequisite passes (objective and motivation clear at lines 9-39). The weaknesses are the amount of scope bundled under the root problem, one security hole in the verifier design (F1), and several places where new code duplicates existing code.

Reuse checks done by code search:

- `lib/bridge/worktrees-port.mjs` and `lib/runtime/slice-worktrees.mjs` already provide slice worktree create, inspect, remove and sweep (F5).
- `lib/bridge/bridge.mjs` already has `listWorkItems`, `claimOrYield`, `reconcile` and an intake path (F5).
- `lib/core/provider-binding.mjs:73-75` already requires `plan`, `execute`, `status`, `cancel`, `cleanup` and `receipt` on the `execution` facet, and a `workspace` facet exists (F5).

## Lens Section: `egm-inventive-catalyst` (Contradictions and inventive transforms)

Status: completed. Findings: 8 Major (merged into F1, F9-F15), 3 Nits (F20-F22).

The reviewer found false compromises and did not return "No false compromise detected". It treated two items as honest limits and not contradictions: the partial 21 CFR Part 11 e-signature mapping (lines 50 and 242), and the single-maintainer root of trust (lines 286 and 643), which is a declared, accepted invariant.

### Contradictions found and suggested transforms

| #   | Contradiction (parameter X vs Y)                                                                     | Suggested transform (catalog pattern)                                                                                                                                     | Secondary liabilities                                                                                              | Report ref |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Holdouts secret from the builder vs. builder code executing beside them in the verifier              | Segmentation and Cheap Dispensables: secretless stage 1, then egress-denied ephemeral sandbox for holdouts and canon returning only pass/fail; attempt limit per PR       | Black-box holdouts only; second substrate dependency; CI cost; residual oracle leak; retry stalls                  | F1         |
| 2   | "Agents hold no credential" vs. Agy subscription login inside the guest                              | Extraction and Intermediary: credential-injecting egress proxy outside the sandbox, or a revocable factory-only identity                                                  | Agy headless OAuth gap may force attended-only; vendor-terms and cost risk; another component to patch             | F9         |
| 3   | Model-driven steward and coordinator vs. "no model holds merge authority"                            | Extraction: deterministic merge actuator and token minter, model advisory and hold-only, token in a separate process                                                      | More work held for the author; scheduler to build; single point of failure                                         | F10        |
| 4   | "Agents cannot reach the classifier or opt-in" vs. control-repo pointer in an agent-editable file    | Extraction: pin in the human-pinned verifier release and host config; repo copy informational and fail-closed                                                             | Per-repository pinned config; slower repointing                                                                    | F11        |
| 5   | "Attested, not self-asserted" evidence vs. unsigned host-originated receipts                         | Intermediary: `host` principal key outside sandboxes, substrate-produced logs, claim-level trust labels, required timestamping for G3/G5                                  | Key custody and rotation; one-machine trust; external timestamp dependency                                         | F12        |
| 6   | Fast recovery from a bad merge vs. full merge gates and the steering write guard                     | Beforehand Cushioning and Dynamics: pre-authorized mechanical revert (tree-equals-last-good-tree), queue hold during post-merge verification, dedicated actuator identity | New fast path to scrutinize; lower throughput; non-clean reverts still need review                                 | F13        |
| 7   | Dark factory vs. 24-hour veto, 7-day cadence and a human verifier pin                                | Blessing in Disguise and Self-Service: lock extends without an acknowledged check-in; veto in Human acts; margin on dead-man timer; optional steward auto-pin of verifier | Stalled `factory-core` merges while away; notification becomes load-bearing; erosion risk shifts to canon strength | F14        |
| 8   | Cross-family review independence vs. dependence on two vendors whose terms may forbid unattended use | Beforehand Cushioning: pre-declared fallback family pair and conformance case                                                                                             | Extra vendor terms and quota; mapping upkeep; weaker reviewer                                                      | F15        |
| 9   | Polling simplicity vs. cost growth with open issues                                                  | Preliminary Action and Dynamics: cursor or ETag, adaptive interval                                                                                                        | Missed updates on cursor error; less predictable timing                                                            | F20        |
| 10  | Merge-queue gating by the pinned verifier vs. event triggers that may not fire in the queue          | Intermediary: ruleset-required workflow or trusted `merge_group` workflow calling the pinned verifier by digest                                                           | Plan tier requirement; queue re-run cost and latency                                                               | F21        |
| 11  | "Factory builds itself" vs. human-built, attended core                                               | Preliminary Action: admit L1 work under attended supervision after the week-0 gate; tag items human-built, attended or dark                                               | Longer week 0 and M1; more accounting                                                                              | F22        |
