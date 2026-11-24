**What this proposes**

AgentFlow is a governance layer for AI coding agents. Over about 26 weeks the author wants to turn it into a "governed factory". A coordinator on the author's Windows machine polls GitHub issues, claims them and hands them to a launcher. The launcher runs a Claude or Agy CLI headless inside a disposable `sbx` microVM that holds no GitHub credentials. The launcher then checks the changed paths against the issue's declared scope and pushes a branch under a "builder App". A verifier pinned from the previous release, plus a cross-model-family review attestation, judges each PR. A "steward" agent then merges it through a merge queue under a delegation the author has signed. Post-merge checks revert bad changes automatically, and a circuit breaker and kill switch stop the factory. Signed, timestamped evidence can be verified offline with `evidence verify` and is projected onto GxP clauses. Controls the docs claim but the code lacks are either wired or retracted, and a claims ledger plus a CI rule keeps it that way. The month-6 target is a published npm package, a mock-GxP sample repository, a case study and a conformance report. The factory is meant to build all of this itself.

**How the existing system works, per this document**

Several documented controls (audit chain, gate sweeper, process supervisor, fencing, handover cap, read-only review) have no importer outside tests. They pass CI because the reachability audit scans only `lib/core/` and `lib/verification/`. Agent CLIs are launched with `spawnSync`, a 120-second timeout and no cancel. They inherit the user's `HOME`, and a `gh auth token` fallback is reachable. Gates accept self-asserted JSON, and "human" is just a registry slug. Run-state events are digest-chained but unsigned, and the writer picks the timestamps. The cross-vendor review check exists but never runs, because nothing sets the builder receipt it reads. Claims are appended to a log with random IDs by read-then-write. The package is not on npm, the only consumer is a never-applied preview, and the GitHub merge provider does a plain merge call pinned to the head SHA.

## Findings

**1. Blocker. How a review attestation becomes trustworthy evidence (lines 183, 213, 223-228, 203, G4).**

- The signing seam says GitHub is the only signer of machine evidence, through artifact attestations from hosted CI.
- The review attestation is produced by a reviewer run on the author's host, in a sandbox with no credentials.
- The document never says who takes the attestation out of the sandbox, who signs it, where it is stored, or how the pinned verifier and steward read it. The "launcher holds builder App token" row and the "steward holds merge App token" row leave the reviewer App's token holder unnamed.
- The central merge gate (G4, "bound to the candidate digest") therefore has a gap between "reviewer run" and "required check", and I cannot write down that path.

**2. Major. How secret holdouts run against builder code (lines 48, 182, 226, M2-1).**

- Holdouts live in the private control repository, and the builder token "cannot read" them.
- The pinned verifier runs them in hosted CI with the control-repository read credential, against the candidate's own code.
- The document does not say why the PR's code, which the tests execute, cannot read or exfiltrate the holdouts or the credential in that job. "Cannot run workflow code a PR supplied" covers the workflow, not the code under test.

**3. Major. How the factory "builds itself" is never sequenced (lines 11, 259, 769, 697, Alternative AH).**

- The Overview says the work in this design is carried out by agents.
- Week 0 is "built attended", M1-6 is "human-built", and the launcher, merge path and verifier do not exist until M1 to M2b.
- Nothing says which milestone items are built by the author and which by the factory. Nothing says when the first dark-run PR happens, or who merges items before the steward exists.
- A reader cannot tell what the bootstrap order is.

**4. Major. "Evaluator" is used as a gate but never defined (lines 185, 217, 232, 553, M1-5, M2b-2).**

- "The evaluator's approval" is a merge condition, and "the steward cannot override the evaluator".
- The only link is that the steward row says it "evaluates readiness with `lib/core/steering-merge-policy.mjs`". A reader has to infer that this module is the evaluator.
- The evidence envelope also has an "evaluator block (present but null until used)" and the receipt gains an `evaluator` block. Whether this is the same thing is not stated, and "until used" is not explained.

**5. Major. Coordinator versus steward versus poller identity is unclear (lines 179, 185, 263, M1-10, M2b-2).**

- The coordinator is "a stateless scheduled session" that "is the `steer.lead` seat run with the `agentflow-steerer` skill". Line 263 calls it "a model session".
- M1-10 builds `intake-poll.mjs`, which is deterministic code, to poll, claim and admit.
- The steward is "a fresh session per decision", yet M2b-2 changes the same skill's seat check from `steer.lead` to the steward's App identity.
- It is unclear whether the coordinator and steward are one agent, two sessions of one skill, or code versus model. It is also unclear which parts of poll, claim and admit are model-driven and which are code.

**6. Major. "Release" and the human-only acts contradict "unconditional agent merge" (lines 47, 236, 305, 570, 802, M5-4, M0-6).**

- L3 is "factory-core changes behind the time-lock, then release", and Alternative C says agent merge includes release.
- The rollout says `latest` is published "only at M5, by the author's release act", and M5-4 is marked (human).
- `verifier.digest` can only be updated by a human act (M2-2). Because "release N-1 governs release N", every verifier release then needs the author.
- Which releases are agent-performed at L3, and which still need the author, is not stated.

**7. Major. Stale Overview and Non-Goals text contradicts the settled architecture (lines 16, 61, 267-270, 271).**

- Line 16 says agents run "inside WSL2 substrates".
- Deviations 1 and 5 make `sbx` microVMs the reference and WSL2 the fallback.
- The Non-Goal "No unattended runs on Windows native" is listed as reworded in Deviation 4, but the Non-Goals text is unchanged. The coordinator, launcher and steward do run unattended on the Windows host.
- A newcomer reading top to bottom gets the wrong substrate and a false non-goal.

**8. Major. Month-6 claim says two implementations per port, but signing will have one (lines 19, 213, 588, M5-1).**

- Line 19 says "two implementations passing each port's suite", and M5-1 says "two implementations per port".
- Signing is stated to have a single GitHub implementation, with a second deferred to Future Improvements, and "pluggable" is withheld for it.
- The document should say which ports are in the claim.

**9. Major. "Lane" is used in three senses (lines 184, 183, 198, 244).**

- A lane is "a builder vendor" with a 3-PR cap (line 198).
- "Reviewer lane" and "tester lane" are role runs in their own sandboxes.
- The learning pipeline has an "idle-only quota lane".
- The in-flight cap and the lane components cannot be told apart without guessing.

**10. Major. "Goal" is used in two senses (lines 41-52, 198, 262, W0-19, M1-10).**

- The Goals section is G1-G8, check-based objectives.
- The Admit step says "the goal the item belongs to has an agreed admission gate". W0-19 creates `goals/gf-*/goal.json` objects bound to person gates.
- Nothing says how an issue is linked to a goal object.
- The terms "admission gate", "person gate" and the gate states (waiting, refused, stale) are not defined in this document. They are only named in the resource list (`docs/person-gates.md`).

**11. Major. The milestones are not defined as a set (lines 179-192, 599-891).**

- Week 0, M0, M1, M2, M2b, M3, M4 and M5 are referenced throughout, mostly through titles on the plan tables ("truth and alpha", "thin slice", ...).
- There is no schedule, no mapping to the 26 weeks, and no exit criteria in this document. The exit criteria sit in `goals/gf-*/goal.json`, which does not exist yet (W0-19).
- Readers must reverse-engineer each milestone's purpose from file lists, and "M2b" is never explained as a separate milestone.

**12. Major. Decision IDs and process terms point to an unlinked file (lines 21, 56, 198, 202, 213, 217, 265, 281, 431, 578).**

- D1-D26, "D-A1", "C3", "the brief", "Step 6", "the council", "the reviewers" and "the brainstorm" are all cited as authority.
- Only `concepts_brief.md` defines them, and it is not linked inline.
- Line 21 says D1-D22, and line 578 says D1-D26.
- "As D5 says", "D17" and "D21" carry meaning the reader cannot see without opening a second file.

**13. Major. Several limits are used but never given values or relationships (lines 91, 234, 46, 103, 236, 563, W0-14, M2-5).**

- "N reverts in the window" has no N or window.
- "Run budget", "time budget", "run-count cap", "daily budget window" and "quota" are used for overlapping things.
- "Active hours" is defined only indirectly (downtime excluded, Open Questions and M2-8).
- The time-lock is "24 hours, to calibrate".
- A reader cannot tell which limit is per run, per day or per window, or what trips the breaker.

**14. Major. "Class" terms are not related (lines 198, 215, 236, 702, 831).**

- "Path class", "change class", "risk class" (in the delegation scope), "class adequacy-of-intent" (gates) and "high-assurance" all appear.
- The Admit step says an autonomy level covers "the change class", with path classes from the control repository. It does not say how an issue's change class is derived before any diff exists.
- Which paths are `factory-core` is also never stated. The doc says only that they are classified in the control repository (ADR 021).

**15. Major. Evidence verification inputs are inconsistent (lines 49, 107, 188, 902).**

- G5 and the M3 exit say verification works "without the author's keys".
- CUJ 5 and the `evidence verify` row require "the author's public key" to check signed human acts.
- The reader needs to be told these mean "without private keys" or similar. The sentence "The result does not change with every integration package and the network removed" (line 49) is also garbled.

**16. Major. The plan for a vendor no-go is missing (lines 72, 701, 256).**

- The dark-running plan, cross-family review and G3/G4 all assume both vendors permit unattended subscription use.
- The Open Question records evidence that Anthropic's terms bar routing through subscription credentials and that Agy is the likelier to be attended-only.
- The document says a no-go "becomes attended-only" and "reopens D3". It never says what the month-6 claim or the factory look like in that case.
- The "brokered by `sbx`" versus "open" login distinction (line 223) is not explained.

**17. Major. OpenRig is never introduced (lines 250, 273, 433-437, 693, M0-9).**

- A large part of the plan (M0-9, the Alternative Y trade-offs, the W0-13 capability review) concerns trimming an "OpenRig adapter and bridge" of 18,438 lines.
- The document never says what OpenRig is or what the adapter does. "A rig", "the minimal scenario", "intake bridge" and "reference pusher" are used without definition.
- Reasoning about the trim requires prior knowledge.

**18. Major. Undefined AgentFlow vocabulary appears in the body (lines 17, 29, 33, 187, 197, 240, 248).**

- These terms are used as if known: role pass, execution receipt, oracle and oracle custody, path ownership, run store and "state ref", claim log, source adapter, `steer.lead` seat, execution distribution (`claude-agy`), "writer generation", "epoch counter", resolution ledger and "four-eyes check".
- Several are explained only partly by file names (for example "four-eyes" via line 33).
- "Agy" is never expanded. The reader can infer it is Google's Antigravity CLI only from the Open Questions text (line 72).

**19. Major. The build order claim does not hold (lines 599, 761, 768, 770, 784).**

- The plan says items are "listed in the order they can be built".
- M1-4 (launcher) pushes with the builder App, which M1-7 creates, and writes receipts whose fields M1-5 adds.
- It also uses the headless invocations M1-6 builds, and depends on the declared-scope section of M1-12.
- M5-6 is listed before M5-4, and there is no M5-5.

**20. Nit. Check-in and kill terms (lines 77, 103, 665, 689, W0-12).**

- "Check-in" is never defined except as a signed tag. `checkins/` is described as a directory of tags.
- "Kill authority" (W0-12, Account settings) is undefined, and the reset or recovery of the kill switch is not described.
- The relation between the local `.agentflow/coordinator.json` state and the control-repository `pause.json` is clear only at the milestone level.

**21. Nit. Counting inconsistencies.**

- Line 259 says week 0 has four spikes (`sbx`, baseline, digest and signing, vendor terms), while Alternative AI says "all three spikes".
- G5 lists four tamper cases, while CUJ 5 and the Verification Plan list five (adding stale review).
- W0-11 registers ADRs 017-026, but W0-13 creates ADR 027.

**22. Nit. The Problem section's "launcher" (line 31) versus the new Launcher.** The Problem section calls the existing one-shot `spawnSync` call "the launcher", while the Components table introduces a "Launcher" as new. Alternative B repeats the old meaning.

**23. Nit. Smaller undefined or unexplained items.**

- "The assistant" in the Open Questions (line 71).
- "movetheneedle" (a repository and website).
- "Case A / case B" appears in the goals (G8) and ledger schema but is defined only inline in G8.
- "Single-repo token with no push or merge right" (line 202) sits oddly next to "agents hold no GitHub credential".
- Alternatives P and V mix first-person "I believe" statements into a design document.

Target file: `docs/designs/governed-factory.md` (lines 1-916 read in full). Persona file: `<egm-plugin>/agents/comprehension.md`.
