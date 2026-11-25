<!-- ARCHIVE: decision log and earlier drafts. The current brief is concepts_brief.md. Do not use this file as design input. -->

# AgentFlow Governed Factory: Roadmap and Workplan

- **Author:** Samuel
- **Date:** 2026-11-22

## Overview

AgentFlow is an open-source governance layer for AI coding agents. The plan is to evolve it, over about six months, into a governed factory that runs without a human present between human-signed gates. Agents build it through AgentFlow itself. Samuel spends about 1-2 hours a day reviewing and merging, and agents do the rest.

Success at month 6 is a package that supports an implementation-and-services offer. It has four parts: an npm release, a mock-GxP sample repository, an offline command that verifies signed evidence, and a case study of AgentFlow building itself. Adoption numbers are secondary.

The GxP part is lightweight. It maps recorded evidence to Part 11, Annex 11 and GAMP clauses. There is no outside validation and no certificate. The wording is "supports" and "maps to", never "compliant" or "validated".

Assumed fixed: Windows 11 plus WSL, several agent vendors, GitHub as the only source system, no competing fork of other projects, and renting the execution engine wherever one fits.

## Analysis

Seven reviewers examined the first draft of the roadmap (truth, safe execution, verification, evidence, GxP, enterprise). Its main problems, in order of importance:

1. **Human review time is the limit, and the draft planned in weeks.** At 1-2 hours a day, the six months hold about 130-360 human hours. The estimates of how many PRs that buys range from about 150 to about 800, and all of them are unmeasured. Generation is cheap and merging is not, so the factory is bound by how much one person can verify. Phase 4 is mostly documents, which agents write quickly and a human reviews slowly. The draft had no back-pressure, so the review queue could grow without limit.
2. **The agents build their own safety layer while running without it.**
   - Until safe execution lands, spawned agents inherit the user's `HOME` and `USERPROFILE` (`lib/providers/local-cli.mjs:9-22`), so the user's hooks, rules and MCP servers load.
   - The `gh auth token` fallback exists (`lib/sources/github-credential.mjs:13`). An agent that inherits `HOME` can read the same `gh` configuration.
   - The same agents edit the gate, attestation, custody and signing code that polices them.
3. **The truth phase cannot find its own target.** `scripts/audit-reachability.mjs` flags unwired exports only in `lib/core/` and `lib/verification/`. The six unwired modules sit in `lib/audit`, `lib/gates`, `lib/qa` and `lib/runtime`, so CI passes and agents can repeat the 2026-09-26 batch while staying green. A previous plan failed the same way (`docs/maintainers/process-autonomy-reconciliation.md`). Truth has to be a standing CI rule from week 1, not a cleanup in weeks 1-3.
4. **Gates can be forged before any unattended run.** `satisfyGate` (`lib/core/gate.mjs:101-124`) accepts self-asserted JSON, and `human` is a registry slug. Anything that can write the state ref or a GitHub comment can forge a human gate. A small slice of signing (signed approvals and trusted writers) has to come before the first overnight run.
5. **GxP last means schema rework, and dogfooding never exercises GxP.** The repo has no GxP content. Receipts lack signer identity, signature meaning and reason for change (`lib/core/review-attestation.mjs:17-34`). Two digest conventions coexist (`provider-receipt.mjs:5` and `record-digest.mjs:3-18`), and CRLF handling on Windows can break digests.
6. **The month-6 package was drawn as a tail but it is the success criterion.** The case study cannot be reconstructed afterwards, so measurement has to start in week 1.
7. **Several exit criteria could not be tested by a stranger** ("every unwired claim", "safe enough", "independent").
8. **Phases 1 and 2 are platforms, not slices.** `local-cli` is a one-shot `spawnSync` runner with a 120 s timeout and no cancel. Isolation is new construction. Mutation testing, judge calibration and a replay benchmark are each a project.
9. **The draft leans toward building where renting fits.** OpenRig supports Claude Code and Codex seats only, has no polling loop, and its rig identity is self-asserted (`docs/openrig-execution-layer.md:165-220`).
10. **Wording and credibility risks.** Evidence signed with keys Samuel controls is circular unless an outside anchor exists. One person merging agent output looks like rubber-stamping unless review effort per PR is shown. Every claim must say which case it covers: case A (the software the factory builds) or case B (the factory as a tool).
11. **Phase 5 (enterprise) contradicts the GitHub-only assumption** and invites scope drift by agents that read the roadmap.

**Corrections to earlier facts** (checked during this review):

- The hash chain is not simply "unwired". `lib/audit/role-flow-span.mjs` is unwired and duplicates a stronger mechanism: `lib/core/run-state.mjs` already keeps a digest-chained event log (`previousDigest`, `generation`) with compare-and-swap on `refs/heads/agentflow-state`. That log is unsigned and its timestamps are self-asserted.
- `lib/runtime/seat-lease.mjs` and `seat-claim.mjs` already cover single-machine leasing, so `lease-fencing` duplicates them.
- The four-eyes model-family check (`lib/core/execution-receipt.mjs:203-205`) runs only when `metadata.builderReceipt` is set, and nothing in the product sets it. It is a strong asset that today lives only in the library.
- `lib/providers/codex-engineering.mjs:243-326` is a hardened write path (`--ephemeral`, `--ignore-user-config`, `--sandbox`, workspace snapshots) and is the pattern to reuse. Claude and Gemini/Agy have no equivalent.

**Inventive resolutions** (the contradiction, then the resolution):

- **Agents need safety to build safety.** A human-led, 3-5 day containment floor that rents controls instead of building them:
  - a throwaway WSL2 distro or container with a clean `HOME`;
  - a single-repo token with no push or merge right;
  - GitHub rulesets and CODEOWNERS on the control plane;
  - spend caps in the vendor consoles;
  - a kill switch.
  - An autonomy ladder (L0 interactive, L1 docs, tests and ledger, L2 non-kernel code, L3 control-plane code never unattended) promotes after N clean PRs.
  - A rule that "release N-1 governs release N" means a run is governed by the last human-signed control plane, never one it modified.
- **Dark running versus a 1-2 hour cap.** Review minutes become a scheduler input. Work items carry a predicted review cost, and admission stops when the open-PR queue is full (3-8 PRs, to be calibrated). Deterministic gates run before the human sees anything. Reviews come in tiers, with kernel or schema changes capped at about one a day. Sampled deep re-reviews guard against rubber-stamping.
- **Layered phases versus a demo.** A walking skeleton by weeks 6-8: one issue, one sandboxed run, one PR, deterministic checks, one signed approval, one timestamped evidence bundle, one trace-matrix row. Phases then deepen that slice.
- **GxP shapes the schema but comes last.** Design the evidence envelope in weeks 1-3, with a hand-written golden fixture of the final outputs first. Fields are required from day one but optional by posture. GxP is a query over that evidence, not a layer.
- **Claim truth versus speed.** A claims ledger in CI from week 1. The default is retract and relabel. Wire only what later phases need. The ledger is itself the first demo.
- **Signed evidence versus self-signing.** Use anchors Samuel cannot rewrite: GitHub artifact attestations or signed commits, an RFC 3161 timestamp authority, and a verifier run outside his environment. Signed evidence proves provenance and order, not correctness.

## Goals vs. Non-Goals

- **In-Scope Goals:**
  - Every documented claim is `implemented`, `measured`, `planned` or `retracted`, with a CI check that blocks a new `MUST` or `INVARIANT` line without a ledger row.
  - Safe unattended runs on WSL2/Linux at autonomy levels L1-L2.
  - A walking skeleton demonstrable every week from weeks 6-8.
  - Holdout custody, a no-op test check, and an enforced second-model-family review.
  - Signed approvals, trusted time and an offline `evidence verify` command.
  - A thin GxP projection: a generated trace matrix, a signature manifestation, one intended-use and risk template pair, and a model-as-supplier statement.
  - A review-minute budget with back-pressure.
  - Measurement from week 1 so the case study is generated, not remembered.
- **Out-of-Scope Non-Goals:**
  - Enterprise features (SSO, SIEM, other source systems) and OPA/Cedar policy.
  - Harness-neutral write-time guards beyond Claude and Codex, and macOS sandbox claims.
  - Full mutation testing, judge calibration, a large replay benchmark and adopting a2dlc (all deferred).
  - CAPA lifecycle, periodic-review tooling, training records, and supplier qualification beyond one template.
  - Any claim of "compliant", "validated" or certified. No external validation.
  - Unattended runs on Windows native or macOS (interactive use and install tests only).

## Alternatives Weighed

- **Keep the original six-phase roadmap.** Rejected by author review: it is sized for a team and puts evidence and GxP in the wrong order.
- **Build the execution engine in-house.** Rejected by author review: far beyond the review budget. Rent OpenRig for Claude and Codex seats and put a thin port in front of it.
- **Wire every unwired module.** Rejected by author review as the default: fencing duplicates seat leases, the custom chain duplicates `run-state.mjs`, and the 15% cap and WIP checkpoint branches have no measured need. Retract unless a later phase needs them. The sweeper and supervisor are the one open call.
- **Build OPA/Cedar policy and a custom in-toto layer.** Rejected by author review: too much for one maintainer. Use signed commits, GitHub attestations and a timestamp authority.
- **Leave GxP to the end.** Rejected by author review: its fields shape the evidence schema.
- **Dogfood only on AgentFlow's own repo.** Rejected by author review: it never produces regulated-style artifacts. Dogfood a mock-GxP repo as a second consumer.
- **Adopt a2dlc for verification now.** Deferred by author review: it is a project of its own. A written adopt-or-skip decision comes from a 3-day spike.

## Key Decisions & Staging for Next Steps

**Standing rules from week 1**

- Four contracts frozen early: C1 claims ledger, C2 trust boundary (what an agent can read, write, spend and call), C3 evidence envelope, C4 requirement-ID spine.
- Instrumentation from day 1: PRs, human minutes per merged PR, rework, reverts and escapes, spend, containment events, gate wait time.
- Surface freeze: no new schema, validator or subcommand without retiring one or stating why.
- No library code merges without a reachable non-test caller and a CLI-level test.
- Back-pressure: stop starting work when more than 3-8 PRs await review, or after 48 hours with no human merge.
- Review cadence: a daily 45-75 minute merge window, a weekly 60-90 minute gate and ledger review, about 20% of hours for control-plane changes, and any PR needing more than 20 minutes to review gets split.
- A `factory-core` path set is human-only or line-by-line reviewed for all six months. Changes there need review by a different model family. Signing keys and holdouts live outside the sandbox.
- Every phase boundary is a person-signed gate in AgentFlow.

**Roadmap**

| Weeks        | Stage                        | Content                                                                                                                                                                                                                                                                                                                                                     | Exit criteria (rerunnable by someone else)                                                                                                                                                                                                                                                                                                |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (3-5 days) | Containment floor and spikes | Containment floor above. Spikes: a baseline from the last 50 merged PRs; execution substrate; signing, timestamp and CRLF-stable digest; a2dlc adopt-or-skip. ADRs: substrate and billing, trust-root paths, wire/retract table, GxP golden fixture, evidence envelope.                                                                                     | An agent cannot push, merge or read host secrets. The kill switch halts a run in under 10 s. A daily spend cap is enforced. A script checks all of it. No unattended runs before this passes.                                                                                                                                             |
| 1-4          | M0 Truth and alpha           | Extend the reachability audit to `lib/audit`, `lib/gates`, `lib/qa`, `lib/runtime`. Claims ledger in CI. Wire, retract or re-point each claim. Fix the `mockPacket` resume claim (`bin/cli.mjs:937-985`, not cross-checked). `npm publish` under the `next` tag with provenance, after the retractions. Stub the mock-GxP repo as the single consumer repo. | Zero unexempted unwired items. CI fails on a `MUST` or `INVARIANT` with no ledger row. A clean `npx` install and first governed PR in under 10 minutes on Windows and WSL, in CI. The evidence envelope ADR is merged.                                                                                                                    |
| 3-8          | M1 Thin slice                | The skeleton above, plus SSH-signed approvals with trusted writers, a persisted kill switch (a repo `PAUSE` flag checked at dispatch, plus token revocation), a clean per-run `HOME` with an env allowlist, a per-day cap, a review-minute scheduler, a reliable runner, and a morning digest reusing `actuate-readiness.mjs`.                              | A one-command demo, run twice on clean machines. A committed red-team suite with recorded events for: reading `~/.ssh` or gh config, ambient tokens, pushing to a protected branch, a non-allowlisted host, writing outside the worktree, overrunning time or budget.                                                                     |
| 8-14         | M2 Safe dark running (L1-L2) | Egress allowlist and per-seat credentials. Holdout custody and the no-op check. Second-model-family review enforced (set `builderReceipt` and `observedModel`). First dark runs on the AgentFlow backlog and the sample repo.                                                                                                                               | A 48-72 hour unattended soak of about 20 issues with zero containment escapes. Holdout unreadable by the builder token, proven by a negative test. A seeded vacuous test caught. A seeded defect caught by a holdout. At month 3: if the loop does not produce mergeable PRs at acceptable review cost, cut later scope, not the package. |
| 14-19        | M3 Evidence integrity        | Rented signing (SSH or Sigstore, GitHub attestations), a nightly RFC 3161 timestamp over the bundle digest, model/prompt/context digests, one canonical digest form, a retention sentence, an offline `evidence verify`.                                                                                                                                    | A third party runs `verify` on a clean machine, on Windows and WSL, without Samuel's keys. Tamper tests are detected: byte flip, deleted record, reorder, back-dated time.                                                                                                                                                                |
| 19-24        | M4 Thin GxP projection       | A generator that reads recorded evidence and versioned mapping data and emits a trace matrix with covered, partial and out-of-scope columns. One intended-use and risk template pair. Part 11 signature manifestation. A model-as-supplier statement. A "what a customer must do" table. An informal outside read of the wording.                           | A requirement-to-evidence trace from recorded evidence only. 100% of requirements linked to issue, PR, tests and approval. A cold read-through by someone who did not build it. Wording uses "supports" and "maps to".                                                                                                                    |
| 24-26        | M5 Package freeze            | Feature freeze at week 21-24. Case study from metrics, demo script, `latest` npm release, offer one-pager. A slip in any stage eats this buffer first.                                                                                                                                                                                                      | A third party runs the demo from a clean machine.                                                                                                                                                                                                                                                                                         |

**Cut order if time slips:** judge calibration and the replay benchmark; mutation testing; any engine beyond OpenRig; CAPA and periodic-review templates; macOS sandbox claims. **Never cut:** the case study, the sample repo, the signed-evidence path, the claims ledger and the containment floor.

**Rent versus build**

| Need                      | Rent                                                                                | Build only                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                    | OpenRig for Claude and Codex seats, or GitHub-hosted runners                        | The unattended trigger and a thin execution port with a conformance suite. Adoption level `none` must keep working. Gemini/Agy is attended or review-only. |
| Isolation and credentials | WSL2, devcontainer or runner; single-repo token; rulesets, CODEOWNERS               | Env allowlist, per-run scratch `HOME`, launcher                                                                                                            |
| Signing and time          | SSH signing, GitHub attestations or Sigstore, npm provenance, an RFC 3161 authority | Evidence-to-subject glue. Retire the custom chain.                                                                                                         |
| Verification              | GitHub permissions for holdout custody; Stryker later                               | Holdout path rule, no-op check, gate wiring                                                                                                                |
| GxP                       | Public clause text as versioned data                                                | A generator and templates. Data-driven so draft rule changes do not force code changes.                                                                    |
| Distribution              | npm                                                                                 | Nothing                                                                                                                                                    |

**Month-6 package**

1. An npm release with provenance, `latest` tag, CHANGELOG, SECURITY.md, a semver and surface-freeze policy, and a quickstart under 10 minutes on Windows and WSL.
2. A public claims ledger and limits page: no validation, no certificate, GitHub-only, one maintainer, a supported-host table.
3. An offline `evidence verify` with a passing example and a deliberately tampered failing example.
4. A mock-GxP repo with a "not a validated system" banner, built through the factory from commit 1. It has one end-to-end trace, a generated trace matrix, a signature manifest, an audit-trail excerpt, one failed-change case with a CAPA-style record, and one tampered trail the verifier rejects.
5. A case study of AgentFlow building itself. It starts with the six unwired modules and their retraction, reports real numbers (PRs, human minutes per merged PR, rejected PRs, rework, reverts, escapes, spend, containment events), includes failures and a red-team transcript, states the signed-evidence window, and labels each claim case A or case B.
6. A responsibilities table (what AgentFlow does, what the client's QA must do) and an offer one-pager for a fixed-scope two-week pilot or assessment workshop.
7. A scripted demo and a short screencast.

**Open questions only the author can answer**

1. Will unattended runs use API keys with hard spend caps or subscription CLIs, do vendor terms allow the latter unattended, and what are the daily and monthly dollar caps?
2. Which two vendors carry the factory and the case study, and is Gemini/Agy attended or review-only?
3. Does "dark" mean unattended from `ready` to a PR with green checks, with merge and intent approval human? Is a "signed gate" an SSH-signed GitHub approval or a Part 11-style e-signature? What happens when no gate is signed?
4. What do the last 50 merged PRs show for review minutes and first-pass acceptance, and what is your tolerance for the open-PR cap?
5. Is "supports and maps to, never compliant or validated" a hard rule, and which case (A or B) leads the pitch? Reviewers lean B as the main story and A as the sample repo.
6. Can you get 3-5 conversations with CSV, QA or GxP practitioners by month 2 and an informal read by months 4-5? Without one, the fixtures encode your own reading of GxP.
7. What domain and language for the mock-GxP repo, chosen to stay clear of critical GMP use (JS/TS makes holdout and mutation checks concrete)?
8. Will you publicly retract fencing, the 15% cap and WIP checkpoints, and publish the ledger of false claims?
9. Is the npm package name available, and will you publish only under `next` until the ledger is green?
10. Does the weekly slot for the case study and prospect conversations come from outside the 1-2 hour cap? If not, the review budget shrinks by about 20-35%.
11. Will you log from week 1, with the pre-signing period honestly labelled, even though early numbers will look weak?

Not checked by the reviewers: OpenRig daemon behaviour, vendor terms, timestamp-authority and attestation availability, Annex 22 status, npm name availability. The per-PR cost and review-minute figures are placeholders until week-1 measurements replace them. Nothing here is legal or regulatory advice.

## Author Decisions (2026-11-23)

These answers come from the author. Where this section conflicts with earlier text in this brief, this section wins.

| #   | Question                   | Decision                                                                                                                                                                                    | Effect on the plan                                                                                                                                                                                                 |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Unattended payment         | Subscription CLIs only, with a run-count and time-window cap plus the kill switch                                                                                                           | Spend control is quota and run-count control, not dollars. The existing quota policy and `subscription-balanced-v1` fit. Vendor terms for unattended subscription use are unchecked and must be checked before M2. |
| 2   | Vendors                    | Claude and Agy (Gemini). Claude does more than review: build, review and sub-agent work, with model selection from both vendors. Codex is out of scope.                                     | See "Vendor consequences" below.                                                                                                                                                                                   |
| 3   | What "dark" means          | The author chose "fully dark, including merge". **Pending confirmation**: it conflicts with the author's "Samuel merges" rule and with the human-only GxP roles. See "Open decision" below. | The review-budget design and the M2 soak depend on the answer.                                                                                                                                                     |
| 4   | Open-PR cap                | Start at 3, configurable                                                                                                                                                                    | The cap applies to items waiting for a human.                                                                                                                                                                      |
| 5   | Wording and lead case      | Agreed: "supports" and "maps to", never "compliant" or "validated". Case B leads, case A through the sample repo.                                                                           | None beyond the brief.                                                                                                                                                                                             |
| 6   | Practitioner conversations | Part of the author's own business work, outside agent scope                                                                                                                                 | If none happen, the GxP mapping carries an "author's interpretation, not externally reviewed" banner.                                                                                                              |
| 7   | Mock-GxP domain            | Equipment calibration and logbook tracker, in TypeScript on Node                                                                                                                            | None beyond the brief.                                                                                                                                                                                             |
| 8   | Retractions                | Publish the claims ledger, including retractions                                                                                                                                            | None beyond the brief.                                                                                                                                                                                             |
| 9   | npm                        | Agreed: no placeholder package. Publish under `next` at the M0 exit, from GitHub Actions with provenance.                                                                                   | None beyond the brief.                                                                                                                                                                                             |
| 9b  | PR budget                  | PRs are sized by **scope**, not only size. Each PR is one focused workplan item, and the workplan is cut so that every item can be a focused PR.                                            | See "Scope-driven PRs" below. Size caps stay as a secondary guard.                                                                                                                                                 |
| 10  | Business hours             | A separate weekly slot exists, but the agents' scope is architecting, building, validating and documenting only                                                                             | Business work (prospects, offer collateral) is out of agent scope. A documentation track is added: technical docs, user manuals, and a product website under **movetheneedle**.                                    |
| 11  | Measure from week 1        | Yes (recorded from a second answer labelled "Q1"; treated as Q11 and to be confirmed)                                                                                                       | Pre-signing period is labelled "unsigned".                                                                                                                                                                         |

### Vendor consequences (Claude and Agy)

- OpenRig's execution docs list Claude Code and Codex seats only (`docs/openrig-execution-layer.md`). Agy therefore runs through the local CLI provider (`agy-cli` in `lib/providers/registry.mjs`), not OpenRig seats. The rent-versus-build table above that names Codex is superseded: rent OpenRig for Claude seats, and harden `local-cli` for Agy.
- The only hardened write path today is for Codex (`lib/providers/codex-engineering.mjs`: `--ephemeral`, `--ignore-user-config`, `--sandbox`, workspace snapshots). Claude and Agy need equivalents. This adds work to M1 and M2. Agy's CLI exposes `--mode plan`, `--sandbox` and a per-session `--settings` option. The Claude equivalents are not yet verified.
- The four-eyes check compares model families. Claude sub-agents on different models (for example Sonnet building and Opus reviewing) are the same family, so they cannot satisfy independence for standard or high-assurance work. Cross-family review must be Claude against Agy, in either direction. Same-family sub-agents are for light or bounded work only.
- Subscription-only plus Claude doing build work raises quota-exhaustion risk. Use Claude's cheaper models for mechanical work, Agy for bulk reading and routine builds, and rely on the quota policy's fallback.
- Implement the selection as a new pinned execution distribution (a `claude-agy` profile) with per-role model, client, effort and two fallbacks, changed only through the existing confirm-token migration.

### Scope-driven PRs

- The unit of work is a workplan item (an issue) with a declared scope: in-scope paths, the requirement IDs it serves, and its acceptance checks.
- A PR scope check fails when changed files fall outside the declared scope. Out-of-scope discoveries become follow-up issues (`AGENTS.md:57` already prefers follow-up issues over scope drift).
- Size caps (about 400 changed lines soft, 800 hard) remain as a secondary guard, and the open-PR cap of 3 applies to items awaiting a human.
- The workplan is cut so every item fits one focused PR. A median PR of about 800 changed lines in the last 50 merges shows the current habit is the opposite.

### Open decision: what "dark" covers

The author chose "fully dark, including merge". That can mean two different things:

1. **Policy-authorized merge (recommended reading).**
   - A human signs the intent and the risk policy up front.
   - A merge into an integration or staging branch happens automatically only when deterministic gates, holdout checks and cross-family review all pass, and the change is in a pre-authorized risk class (light or standard).
   - A human signature is still required for release or promotion, for high-assurance changes, and for `factory-core` changes.
   - Post-merge verification and automatic revert are required.
   - Human time moves upstream (intent and policy) and downstream (sampled audits and releases).
2. **Unconditional agent merge.** Agents merge every change, including high-assurance and factory-core, and also release.

Reading 1 fits the author's goal of "dark between gates" and the human-only GxP roles. Reading 2 conflicts with them, with the two-plane rule that merge verbs belong to the steering plane, and with the author's own "Samuel merges" baseline. Either reading changes the plan: it adds an auto-merge path (agent identity, rulesets, a merge queue, post-merge checks, automatic revert), shifts the review budget from per-PR review to sampled audits, and lengthens the M2 soak. The reading must be confirmed before `/egm:egm-draft`.

### Documentation track (new)

Technical documentation, user manuals and a product website under **movetheneedle**, produced from the same evidence as the case study. Not yet known: whether movetheneedle is a domain, brand or GitHub organization, and the hosting and stack. Treat the website and manuals as a staged deliverable. They stay inside the 26-week plan and are the first scope to trim after M4.

## Decision on Q3, confirmed 2026-11-23: unconditional agent merge

The author chose reading 2. Agents merge every change, including high-assurance and `factory-core` changes, and release. This resolves the "Open decision" section above and the "pending" mark in row 3 of the decisions table. It overrides the earlier statements that the author merges and that high-assurance work needs a human signature on the PR.

The reviewers' point that a dark factory needs a recoverable merge path still applies. The design requirements below make this decision workable. They are engineering requirements, not conditions on the decision.

### Design requirements

1. **The box lives outside the repo.**
   - Agents may merge any repository change, but they must not be able to change the constraints around them.
   - Those constraints are account-level settings an agent token cannot edit: GitHub rulesets and branch protection, the merge identity's permissions, vendor quotas, the kill-switch authority, signing keys, and the npm trusted-publishing configuration.
   - A human sets them once. This replaces a per-change human gate with a boundary the agents cannot cross.
2. **The verifier that judges a change is not the change.**
   - Required status checks run a pinned, digest-identified verifier from the last release, not code from the PR branch. This is the "applied copy, not the branch" principle seen in openfabriq's engine.
   - It makes "release N-1 governs release N" mechanical, and it is the control for the case where an agent changes the code that checks it.
3. **Every merge needs an independent cross-family review.**
   - The reviewer's model family differs from the builder's, so Claude-built work is reviewed by Agy and Agy-built work by Claude.
   - The review is a digest-bound attestation, and the required check fails if it is stale or missing.
4. **A merge queue with post-merge verification and automatic revert.**
   - The merge identity is a narrow-permission GitHub App, used only through the queue after required checks pass.
   - After merging, the full suite and the committed red-team suite run. A failure reverts automatically.
   - A circuit breaker pauses merging after N reverts in a window (N to be calibrated) and engages the kill switch.
5. **A time-lock on `factory-core` changes.**
   - Control-plane changes wait a fixed window (for example 24 hours, to be calibrated) before merging. A human can veto during it.
   - Silence is consent, so this is not a human gate and does not stop the factory.
6. **The committed red-team suite from M1 is a regression test for the controls.**
   - It runs on every `factory-core` change and in post-merge verification. A change that lets a blocked action through fails.
7. **Release uses credentialless publishing.**
   - npm trusted publishing (OIDC) is configured once by a human and bound to a specific workflow. Agents hold no publish credential.
   - A release is a merged version change that triggers that workflow.

### Staging: an autonomy ladder to the unconditional end state

Unconditional merge is the end state, reached in stages promoted by evidence, so the first unattended merges do not run on the control plane.

| Stage | Merge scope                                               | Promotion evidence                                                                             |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| L1    | Docs, tests, ledger entries, mock-GxP repo                | Zero containment escapes and zero post-merge failures over a 48-72 hour soak of about 20 items |
| L2    | AgentFlow code outside `factory-core`                     | A further soak with the revert path exercised at least once in a drill                         |
| L3    | `factory-core` changes behind the time-lock, then release | Red-team suite green on every change, and the pinned-verifier check proven by a negative test  |

The ladder replaces the earlier "the author merges" step. It adds an M2b milestone (the auto-merge path) and a longer M2 soak, and the plan has room only if the M4 and M5 scope cuts hold. Cut order if time slips: judge calibration and the replay benchmark, mutation testing, CAPA and periodic-review templates, then the website and manuals.

### What changes in the earlier plan

- **Review budget.**
  - The author's 1-2 hours a day move from reviewing PRs to sampled audits of merged PRs (rubric-based, sample size to be set), exception handling, policy edits, and the weekly ledger review.
  - The measure of review effort becomes audit findings per sampled PR and post-merge failure rate, not minutes per PR.
- **Open-PR cap.** The cap of 3 now limits in-flight PRs per agent lane. Back-pressure comes from queue length and the revert circuit breaker, not from a human queue.
- **Human gates.**
  - Human decisions are the intent and risk-policy signature (per unit of work or per policy), the account-level settings in requirement 1, vetoes during a time-lock, and audits.
  - There is no per-PR human approval for a change in a pre-set class.
- **GxP mapping (M4).**
  - A merge by an agent has no individual human e-signature. The mapping must show that gap explicitly (partial or out of scope) for Part 11 signature clauses, and cite the agent identity, the policy signature and the cross-family review attestation as the evidence it does have.
  - The wording rule is unchanged: "supports" and "maps to", never "compliant" or "validated". The case study states that agents approved and merged their own work under signed policy.
- **Month-6 package.** The case study gains a section on the merge path: reverts, circuit-breaker trips, and audit findings.
