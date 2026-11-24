# Comprehension Report (Round 2)

**Target:** `docs/designs/governed-factory.md` (lines 1-1016; feature specification 1-684, implementation plan 685-1016). The reviewer read only this file.

## What this proposes

The document proposes making AgentFlow, an open-source governance layer for AI coding agents, into a "governed factory" over about 26 weeks. Agents would pick up GitHub issues and build them in disposable sandboxes, with no repository credentials. Agents from the other model family would review each change, and a steward agent would merge it under a delegation the author signs. Failed merges are reverted automatically, and a merge queue plus a circuit breaker limit the damage. Every step would leave signed, timestamped evidence that a third party can check offline. That evidence would also feed a trace that maps to GxP clauses (the document does not expand "GxP").

The work is split into a pre-milestone "week 0" and milestones M0 through M5, with an M2b between M2 and M3. Before M1, the author does a set of human acts: account setup, a private "control repository" holding the trust-bearing policy, the signed delegation and rule edits. The month-6 claim is only that the named reference stack works end to end and is in use. It builds itself and the author's own repositories, a mock-GxP sample repository is built through it, and a publishable package and case study are produced.

## How the existing system works, per this document

AgentFlow v1.12.0 has many modules and documented controls. Six of them (the chained audit span, gate sweeper, process supervisor, QA contract verifier, handover protocol and lease fencing) have no caller outside tests, because the reachability audit scans only `lib/core/` and `lib/verification/`. Agent CLIs are launched with a one-shot `spawnSync` call (120-second timeout, no cancel) and inherit the user's home directory. A `gh auth token` fallback is also reachable. Gates accept self-asserted JSON. Evidence records are digest-chained in a run store but unsigned, with writer-chosen timestamps. The cross-vendor review check never runs because nothing sets the builder receipt it reads.

The merge provider does a plain pull-request merge pinned to the head SHA. Delegation grants only accept a "local-cooperative" issuer. The claim log uses random claim IDs and a read-then-write append. The package is not on npm, there is no GxP content, and the repository's own rules require a human to approve high-assurance work before merge.

## Findings

1. **Severity: Blocker.**
   **Affected scope:** Bootstrapping, who merges before the steward exists. Lines 11, 47, 236, 656, 863 (M1-6, "human-built"), 887-934 and 999-1000.
   **Description:** I cannot write a coherent paraphrase of how the work in M0 through M2b is built and merged.
   - The Overview says agents carry out the work in this design.
   - The autonomy ladder gates what agents may change. L2 covers code outside `factory-core` and L3 covers `factory-core`. Promotion needs a soak.
   - The soak is the M2 exit. The steward, time-lock and revert path are not built until M2b, and L3 requires them.
   - The M2 and M2b items are almost all new core control code (reviewer lane, verifier, steward), so they are presumably `factory-core`.
   - Only one item (M1-6) says it is human-built.
   - Nothing says which items are agent-built, at what level, or who merges changes during the 48-72 hour M2 soak.
   - G3 bundles the soak and the steward merge into one goal, while the Verification Plan puts them at different milestones.
   - Please add a bootstrap sequence. For each milestone it should say who builds, who merges and which ladder level applies.

2. **Severity: Blocker.**
   **Affected scope:** How a review attestation is produced, signed and checked. Lines 183, 203, 213, 224-226, 232, 900 and 1013.
   **Description:** I cannot paraphrase how a reviewer's verdict becomes a trusted, verifiable record.
   - The reviewer runs in a read-only sandbox on the host.
   - The signing seam says GitHub attests machine evidence only from hosted CI, and a PR review "is not used as a signature".
   - The reviewer's output is called a "review attestation bound to the candidate digest", a record from the existing `review-attestation.mjs`.
   - The reviewer sandbox holds no credential. The launcher holds only the builder App token.
   - The text never says who writes the attestation, where it is stored (PR comment, state ref, check run, bundle), or what signature makes it unforgeable. Line 33 itself warns that anything able to write the state ref or a comment could forge an approval.
   - "Reviewer App" is created, but its use is not described.

3. **Severity: Major.**
   **Affected scope:** Overview, "Execution plane", line 16.
   **Description:** It says agents run "inside WSL2 substrates that start clean for each run". The Technical Plan, Deviation 1, Alternatives P and Q, and the Non-Goals all say the primary substrate is `sbx` microVMs on the Windows host. WSL2 is only the fallback and second implementation. A fresh reader gets two different architectures.

4. **Severity: Major.**
   **Affected scope:** Predecessor decisions D1-D38, "the brief", "D-A1" and "C3". Lines 21, 56, 171, 310-317, 339, 465, 614 and others.
   **Description:** The text cites D2, D3, D4, D5, D11, D12, D13, D17, D18, D21, D26, D-A1 and C3 as authority, and "the brief" for rules. These live in `governed-factory/concepts_brief.md`, which a reader of this document does not have.
   - D3 and D5 are partly explained inline.
   - D4 is never stated. Alternatives AR, AW and AX say they "narrow D4".
   - The others are bare labels.
   - Please define each decision inline where it is first used, or add a short decision glossary.

5. **Severity: Major.**
   **Affected scope:** Milestones and schedule. Lines 11, 23, 259, 296, 685-1016 and the headings at 799, 842, 887, 914, 936, 951 and 969.
   **Description:** M0 through M5, M2b and "week 0" are never defined in prose.
   - There is no list of what each milestone delivers, its exit criteria, or how the 26 weeks divide.
   - Each milestone only gets a short heading, such as "M0: truth and alpha" or "M2b: auto-merge path".
   - The Verification Plan gives exit tests for M2, M2b, M3, M4 and M5, but not for week 0, M0 or M1, apart from the re-run of the week-0 gate.
   - The nine admissions are described as "the program goal and eight milestones" without naming them, though W0-19 lists nine goal files.
   - Please add a milestone table.

6. **Severity: Major.**
   **Affected scope:** Holdouts and seeded defects. Lines 48, 177, 892, 999 and 754.
   **Description:** Holdout tests are central to G4 and to the verifier, but the text never says who writes them, when, or how they link to an issue or PR.
   - The control repository holds them, and agents cannot reach it.
   - The human-acts table does not list authoring holdouts, seeded defects or canon cases.
   - CUJ 1 says "the author took no action".
   - A reader cannot tell whether a human must write holdouts per issue, or whether they are generic. Neither is stated.

7. **Severity: Major.**
   **Affected scope:** Pinned verifier execution model. Lines 74, 182, 226, 892, 896 and 898.
   **Description:** The verifier runs from a workflow the PR cannot edit and holds the control-repository read credential. It also runs holdouts and checks that a new test fails on the base tree, so it must execute code from the PR.
   - The trust table says it cannot "run workflow code a PR supplied".
   - How candidate test code runs without exposing the credential or the holdouts is unexplained.
   - It is also unclear how the "release N-1" artifact (line 657) relates to the checked-out repository scripts such as `scripts/verify-pr.mjs`.

8. **Severity: Major.**
   **Affected scope:** Who creates and labels issues and declares scope. Lines 83, 209, 641, 878 and 1013.
   **Description:** CUJ 1 starts from an issue "labelled ready" with a declared scope. Issue text is also described as untrusted data.
   - Nothing says who writes the issue, who applies the ready label, or who may edit the declared scope.
   - A declared scope that anyone or any agent can edit is self-asserted, and the launcher and verifier both check changes against it.
   - Applying the "ready" label is effectively an approval to start work, yet it is absent from the Human acts table, which presents itself as the complete list of human acts.

9. **Severity: Major.**
   **Affected scope:** Failure and rework paths. Lines 194-205 and 83-91.
   **Description:** "How a unit of work flows" and the CUJs cover only the happy path and post-merge failure.
   - There is nothing for a failed verifier check, a rejected review, a stale review after a new push, a scope violation, a builder timeout or a quota exhaustion before merge.
   - It does not say how claims are released, how many rework attempts are allowed, or who re-dispatches the builder.
   - The case study measures "rework" and "rejected PRs", so these paths exist but are not described.

10. **Severity: Major.**
    **Affected scope:** Coordinator and steward, what they are and what credentials they hold. Lines 179, 185, 219-228, 297, 782-783 and 873.
    **Description:** The coordinator is variously "a stateless scheduled session", "the `steer.lead` seat run with the `agentflow-steerer` skill", "a model session" and a script (`scripts/coordinator.mjs`) holding state in `.agentflow/coordinator.json`.
    - The trust-boundary table omits the coordinator.
    - It does not say which credential the coordinator uses to poll issues, write claims, or read the pause flag and path classes from the control repository. The same table says the launcher cannot read that repository.
    - It does not say where the steward runs.
    - The reader cannot tell what is model-driven and what is deterministic code.

11. **Severity: Major.**
    **Affected scope:** Undefined AgentFlow vocabulary used as if known. Lines 29, 33, 184, 197, 272, 276, 893 and elsewhere.
    **Description:** These terms are used without a definition or link.
    - "oracle", "oracle custody" and "oracle edits"
    - "role pass" and "execution receipt"
    - "state ref", "run store" and the "claim log"
    - "seat", "seat lease" and "steer.lead"
    - "person gate", "admission gate", "gate" and "goal"
    - "four-eyes check"
    - "execution distribution", "pinned distribution" and "profile" (for example `claude-agy`)
    - "resolution ledger" and "review-round receipt"

    `docs/person-gates.md` and others appear only in the closing resource list. Each term needs a one-line definition at first use.

12. **Severity: Major.**
    **Affected scope:** "candidate digest". Lines 11, 48, 203, 217 and 948.
    **Description:** The term is the binding point for reviews, attestations and merge, but it is never defined. The text does not say whether it covers the commit, the tree, the diff or the built artifact. Line-ending normalization is mentioned only in M3-5. The envelope lists "commit and artifact digests" under "subject", which is not the same thing.

13. **Severity: Major.**
    **Affected scope:** "factory-core" and change classes. Lines 119, 236, 242, 337, 897 and 983.
    **Description:** Almost every autonomy, time-lock and policy rule depends on `factory-core`, but the document never says what it contains. It is only "classified in the control repository", and ADR 021 is a future deliverable.
    - "Change classes" and "risk classes" (high-assurance, "light and standard", L1 and L2 docs and code) are used without a definition, and without saying how they map to the ladder.
    - Please say what the L3 and time-lock set covers, at least by example.

14. **Severity: Major.**
    **Affected scope:** "lane" used in several senses. Lines 183-184, 198, 276 and 855-900.
    **Description:** "Lane" means a builder vendor for the in-flight cap, a role run (reviewer lane, tester lane), and an "idle-only quota lane" in the learning section. The cap rule "3 per lane" relies on the first meaning. The other uses invite misreading.

15. **Severity: Major.**
    **Affected scope:** "evaluator". Lines 185, 217, 232, 276 and 860.
    **Description:** It appears to mean the deterministic merge-readiness function `steering-merge-policy.mjs`. The same word is used for an envelope "evaluator block" that is "present but null until used", and for "evaluators" protected from the learning pipeline. The document never says which of these are the same thing.

16. **Severity: Major.**
    **Affected scope:** OpenRig. Lines 282, 307, 467-471, 781, 825-832 and 924.
    **Description:** The plan deletes or trims thousands of lines of OpenRig adapter, bridge and docs, but the document never says what OpenRig is. Alternative Y gives only a size and a hint that it is an optional execution layer with a daemon. "Rig", "rig exec", "rig whoami" and "ADR 016" are used as known. A reader cannot judge whether the retirement is safe.

17. **Severity: Major.**
    **Affected scope:** Timestamps and the back-dated tamper test. Lines 49, 109, 213 and 945.
    **Description:** G5 and CUJ 5 require detecting a back-dated timestamp offline. The signing seam calls RFC 3161 timestamps "a separate optional seam", and M3-3 makes them an optional nightly job.
    - If timestamps are optional, the test has no defined trusted time source by default.
    - The envelope has a "timestamp source" field. It never says what the default value is or what GitHub's attestations contribute.

18. **Severity: Major.**
    **Affected scope:** Human acts table completeness. Lines 117-121, 252-264 and 754.
    **Description:** The table presents itself as the full list of acts that stay with the author, but it omits several.
    - The time-lock veto (CUJ 7) has no mechanism. It is not in the control-repository layout or in any item.
    - Editing path classes, the opt-in file, the canon, holdouts and seeded defects is not listed as an act.
    - "Kill authority", set up in week 0, is never explained.

19. **Severity: Major.**
    **Affected scope:** Goal checks that do not match their implementation. Lines 52, 823 and 1003.
    **Description:** G8 says a quickstart reaches a "first governed PR in under 10 minutes". M0-8 and the Verification Plan implement a six-command path to "first local evidence" in a temp directory under 10 minutes. A governed PR is a different outcome. Also, G8 asks for "the stack in use" without a measurable threshold, and the Overview promises a "case study with measured numbers" without target values.

20. **Severity: Major.**
    **Affected scope:** Settled versus open decisions. Lines 71, 74, 76, 177, 751, 898 and 1013.
    **Description:** Some items listed as open are used as settled elsewhere. The pause flag home is "assumed... confirm", yet `pause.json` is in the control repository layout. The verifier workflow type is "unchecked", while M2-2 builds it. "Who performs the week-0 acts: the author, or the assistant" contradicts the Human acts rule that no agent can perform them, and "the assistant" is never defined.

21. **Severity: Major.**
    **Affected scope:** Delegation, opt-in and release wording. Lines 215, 242, 266 and 750-752.
    **Description:** Line 242 says the steward merges `factory-core` changes "and releases", but line 266 says `latest` stays human. This is presumably `next` only, and it needs saying.
    - Both the delegation (scope with risk classes) and `delegation-optin.json` (`{enabled, classes}`) name change classes. The document does not say how they combine or which wins.
    - It does not say what the "revocation pointer" points to.

22. **Severity: Major.**
    **Affected scope:** Unspecified parameters. Lines 51, 91, 121, 656 and 1007.
    **Description:** N (the revert count) and the revert window have no values, even as defaults. The time-lock is "24 hours, to calibrate". "Active hours" is defined only through scattered exclusions. The host-downtime tolerance is an open question. These parameters drive CUJ 2 and 7, G3 and the soak, so the reader cannot tell whether the criteria are testable.

23. **Severity: Minor.**
    **Affected scope:** Process references that need history to read. Lines 21, 299, 321, 337, 792 and 666.
    **Description:** "the brainstorm", "the council", "the reviewers", "Step 6", "the first review round" and "the first W0-2 row" refer to earlier work that the reader has not seen. Line 792 explains a correction ("not 62-64") by pointing to a row of an earlier draft. These could be removed or given a one-line explanation.

24. **Severity: Nit.**
    **Affected scope:** "Agy". Lines 16, 56 and 72.
    **Description:** "Agy" is used from the Overview as a model vendor's coding CLI. It is only implied to be Google's Antigravity, with Gemini models, by Open Questions and Alternative AD. A single sentence at first use would fix it.

25. **Severity: Nit.**
    **Affected scope:** Regulated-domain terms. Lines 50, 115, 644 and 959.
    **Description:** GxP, Part 11, Annex 11, Annex 22, GAMP 5 and CAPA are used throughout, and G6 depends on them. None is expanded or linked. The mock-GxP sample is explained only in CUJ 6 and X-2.

26. **Severity: Nit.**
    **Affected scope:** G5 wording. Lines 49 and 1001.
    **Description:** "The result does not change with every integration package and the network removed" is garbled, and "integration packages" is undefined. G5 and the Verification Plan say "without the author's keys", while CUJ 5 supplies "the author's public key", so the text should say private keys. Offline verification also depends on the `gh` CLI (M3-3), which the Future Improvements section notes but G5 does not.

27. **Severity: Nit.**
    **Affected scope:** Work-item numbering and scope in the plan. Lines 971-980, 1005-1013 and 790-797.
    **Description:** The M5 table lists M5-1, 2, 3, 6, 4 out of order and has no M5-5. "Week-0 spikes (W0-16 to W0-18)" includes the baseline document, which is not a spike. The Known Risks section says four spikes, while Alternative AI says three. Some terms in the plan are unexplained ("extension pack", "sealDeliveryRecord" and "recordDigest", and "the movetheneedle repository", which appears at lines 70 and 988).

28. **Severity: Nit.**
    **Affected scope:** "dark", "unconditional". Lines 47, 72 and 339.
    **Description:** "Runs dark" and "dark-running plan" are never defined, though the reader can infer "unattended". Alternative C says the end state is "unconditional agent merge", which conflicts with the time-lock, delegation scope and human-held `latest` and verifier pin.
