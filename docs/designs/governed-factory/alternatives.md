# Governed Factory: Alternatives Considered

Companion to [the governed-factory design](../governed-factory.md). It holds the full text of every alternative the design considered: pros, cons and the reason for the decision. The design keeps a one-line summary table that links here. Each letter appears in both places.

The first seven alternatives are program-level. The rest follow the architecture decisions. Where the council or reviewers recommended against an option and the author agreed, the reason given is the technical finding.

## Alternative A: Keep the original six-phase roadmap

- **Pros**: Familiar order (truth, safe execution, verification, evidence, GxP, enterprise), and it matches how the gaps were first found.
- **Cons**: Sized for a team: 24-37 focused weeks for one maintainer. It puts evidence integrity and GxP in the wrong order, so the evidence schema would need migrating after signing starts.
- **Reason for Rejection**: Rejected by author: the milestones in this design start from a containment floor and a walking skeleton, design the evidence envelope first, and keep the package demonstrable every week.

## Alternative B: Build the execution engine in-house

- **Pros**: Full control of scheduling, isolation and result handling, and no dependency on a vendor's roadmap.
- **Cons**: A platform, not a slice: the existing launcher is a one-shot `spawnSync` call with no cancel. It is far beyond what one maintainer can review and keep current.
- **Reason for Rejection**: Rejected by author: rent isolation, and build only a thin launcher. Rented pieces are `sbx`, GitHub and the signing tools.

## Alternative C: Keep a human at the merge, in full or for high-risk classes

- **Pros**: The strongest accountability story for a regulated buyer: an individual human approves each change, which closes the Part 11 signature gap for those changes. The council and reviewers recommended a policy-authorized version of this: agents merge light and standard changes, and a human signs release, high-assurance and `factory-core` changes.
- **Cons**: Human attention becomes the throughput limit, and the factory cannot run dark. The design already treats the author's hours as unscheduled.
- **Reason for Rejection**: Rejected by author: the end state is unconditional agent merge, including `factory-core` and `next` prereleases (the `latest` release and the verifier pin stay human; see Alternatives AW and AX). The Technical Plan adds the controls that make that recoverable (a box outside the repo, a pinned verifier, cross-family review, a merge queue with revert, a time-lock and an external red-team canon), and shows the signature gap as partial in the GxP mapping. A human merge is kept only for the early autonomy levels.

## Alternative D: Wire every unwired module

- **Pros**: It makes every principle in `docs/guiding-principles.md` true as written.
- **Cons**: `lease-fencing` duplicates `seat-lease.mjs`, `role-flow-span` duplicates the stronger chained store in `run-state.mjs`, and the 15% handover cap and WIP checkpoint branches have no measured need. Wiring all of them adds surface area that nothing asks for.
- **Reason for Rejection**: Rejected by author as the default: the cross-machine fencing-token claim (the unwired `lease-fencing` module; the writer-generation fencing in the run store is live and stays), the 15% handover cap, WIP checkpoint branches and the `role-flow-span` chain are retracted in a public claims ledger. The gate sweeper and process supervisor are wired (D17), after adaptation.

## Alternative E: Position AgentFlow as a governed integrator of ADK, Celesto and learning frameworks

- **Pros**: Name recognition, and an answer to "does it work with what we already run?".
- **Cons**: An integrator inherits every dependency's release risk and rarely owns a category. No prospect has asked for any of the three, and the author has used none of them. Each integration is a new supplier in a GxP story that scopes supplier work to one template.
- **Reason for Rejection**: Rejected by author, on the council's and reviewers' findings: the headline is the governance and evidence layer. "Integrator" describes the method, and positioning stays a hypothesis to test. Integrations enter only under the admission rule (deletes a plan item, or is the only way to meet an exit criterion).

## Alternative F: Leave GxP to the end

- **Pros**: It keeps early milestones focused on the controls and the walking skeleton.
- **Cons**: GxP fields (signer identity, the meaning of a signature, the reason for a change) shape the evidence schema, so late GxP work means migrating signed history.
- **Reason for Rejection**: Rejected by author: the envelope is designed first, with a hand-written golden fixture of the final outputs, and the mapping is a projection over recorded evidence.

## Alternative G: Dogfood only on AgentFlow's own repository

- **Pros**: Least setup, and the strongest "builds itself" story.
- **Cons**: It never produces regulated-style artifacts, so the GxP projection would have nothing real to run on.
- **Reason for Rejection**: Rejected by author: a mock-GxP calibration and logbook tracker is a second consumer, built through the factory from its first commit.

## Alternative H: Hosted sandboxes for subscription agents (Celesto hosted, GitHub-hosted runners)

- **Pros**: No local machine to keep powered on, and the hosts provide isolation.
- **Cons**: Agent runs on the author's Claude and Gemini subscription logins would put those logins on a third party's machines. Celesto's own page says "isolation, not complete security", its pre-run hooks run client-side, and no Claude Code or Agy support was found.
- **Reason for Rejection**: Rejected by author (D2): subscription logins stay on the author's machine. Hosted runners remain fine for jobs that carry no agent login (the verifier, attestations, npm publishing).

## Alternative I: Google ADK as the agent runtime or evaluation authority

- **Pros**: Apache-2.0, a graph workflow engine, plugin hooks, an evaluation framework with deterministic criteria, and A2A and MCP interoperability.
- **Cons**: It calls models through APIs, which conflicts with subscription-only billing, and some LLM-judged evaluations need billed Vertex services. The workers are Claude and Agy CLIs that run their own tool loops, so ADK would see only a wrapper. Its graph would be a third phase-graph definition. It releases every one to two weeks with breaking 2.x changes.
- **Reason for Rejection**: Rejected by author, on the council's and reviewers' findings: not in this plan. An out-of-process adapter becomes possible only if a customer asks or the subscription-only decision is reopened.

## Alternative J: Runtime self-improving agents, or external optimizers now

- **Pros**: Possible gains in prompts and playbooks. GEPA has a peer-reviewed paper, and DSPy has broad use.
- **Cons**: DGM, SEAL and ADAS rewrite code, weights or evaluators, and DGM faked tool use and deleted its own detection markers. Optimizers need outcome data that does not exist yet, and the post that recommended them is vendor marketing with no benchmark numbers.
- **Reason for Rejection**: Rejected by author: runtime self-modification never. The existing v1.9.0 pipeline is wired, after month 6 (P-1), as a propose-only worker role inside the learning boundary. External optimizers wait for L3 and enough scored outcomes, probably after month 6.

## Alternative K: A custom hash chain, OPA or Cedar policy, and a full in-toto layer

- **Pros**: Full control of the evidence format and fine-grained, declarative policy.
- **Cons**: Too much for one maintainer, and the chained store already exists in `run-state.mjs`.
- **Reason for Rejection**: Rejected by author: use signed commits, GitHub attestations and an RFC 3161 timestamp (kept as a separate optional seam).

## Alternative L: SSH signatures for everything

- **Pros**: Fully offline verification with only a public key, and one mechanism.
- **Cons**: The root of trust is one key, and agent evidence signed on the agent host would sit next to the agents. It needs a key-custody process for rotation and loss.
- **Reason for Rejection**: Rejected by author: GitHub is the only signer and attestor of machine evidence. SSH-signature verification stays as the cheapest second implementation of the signing seam.

## Alternative M: Sigstore for everything

- **Pros**: One system, no long-lived keys, and identity tied to a login.
- **Cons**: Signing needs the internet and external services, the public transparency log would expose metadata about private repositories, and the trust root needs its own update process.
- **Reason for Rejection**: Rejected by author: GitHub attestations already use Sigstore underneath, and add no second system to run.

## Alternative N: Hold the verifier digest, canon and holdouts in a directory on the Windows host

- **Pros**: No GitHub dependency and the strongest separation from agents.
- **Cons**: No history or backup, and hosted CI cannot read it, so required checks would have to run on the author's machine.
- **Reason for Rejection**: Rejected by author: a private control repository gives versioning, auditability and backup, and hosted CI can read it through a read-only credential.

## Alternative O: Public signed releases as the home for these items

- **Pros**: No extra repository, no secret to guard, and anyone can verify.
- **Cons**: Holdouts and seeded defects cannot be public, because the builder could read them and overfit.
- **Reason for Rejection**: Rejected by author: items that must stay secret need a private home. Public releases remain the home for the pinned verifier itself.

## Alternative P: A throwaway WSL2 distro for each run

- **Pros**: Native to the author's machine, nothing to install, a clear teardown.
- **Cons**: I believe all WSL2 distros share one virtual machine and kernel (unverified), so isolation between runs is filesystem-level. Egress control inside the distro can be edited by an agent that gains root, and importing a distro for each run costs time and disk.
- **Reason for Rejection**: Rejected by author: `sbx` gives a kernel per run and an egress proxy with an audit log, with less of AgentFlow's own code.

## Alternative Q: A rootless container for each run, inside one WSL2 distro

- **Pros**: Fast start, mature controls, and a pinned image digest gives clean evidence.
- **Cons**: Runs share the distro's kernel, and the CLIs' own sandboxes (which depend on Linux user namespaces, unverified) may not work inside the container.
- **Reason for Rejection**: Rejected by author: a per-run kernel is the stronger boundary and `sbx` is the adopted product.

## Alternative R: A disposable Hyper-V Linux VM for each run

- **Pros**: A kernel per run, and discarding a run is deleting a disk.
- **Cons**: A larger launcher to build and maintain, slower starts (my estimate, not measured), and many VMs would compete with the author's own work on the same machine.
- **Reason for Rejection**: Rejected by author: `sbx` provides the same per-run kernel as a product, so none of that has to be built.

## Alternative S: Microsandbox (open-source microVM runtime with SDKs)

- **Pros**: Apache-2.0, about 9k stars, native on Windows, and Python, Rust and TypeScript SDKs suit a launcher.
- **Cons**: Pre-1.0 (v0.7.14). One review reports no OAuth support, so a subscription token would sit in the guest. It has no blocked-request log, and secret substitution needs TLS interception.
- **Reason for Rejection**: Rejected by author: weaker for subscription logins and for audit. It stays a candidate if `sbx` fails its spike.

## Alternative T: Other sandbox products

- **Pros**: Several are open source and some are widely used.
- **Cons**: NVIDIA OpenShell is alpha and needs a separate gateway. StrongDM Leash mounts `~/.claude` and its latest release found was from December 2025 (unconfirmed). Daytona went closed source in June 2026. E2B's self-hosted edition needs KVM and about 12 GiB of RAM. The Kubernetes agent-sandbox project needs a cluster. Coder's agent firewall is in a paid tier. Dagger Container Use is an interactive-agent tool with no egress control found.
- **Reason for Rejection**: Rejected by author, on a research report built from search results and a few fetches. The evidence for Container Use was a single snippet, and Dagger itself, the pipeline engine, was not assessed. Dagger is an unevaluated candidate for running the pinned verifier's checks in containers.

## Alternative U: Assemble the substrate from maintained components in WSL2

- **Pros**: Every piece is open source or vendor-maintained, it stays on WSL2 with repositories on ext4, and it avoids a closed-source dependency. The parts are the Claude Code sandbox with managed settings, Agy's `--sandbox`, an outside-boundary Envoy or mitmproxy egress proxy, firewall rules and a GitHub App token minter.
- **Cons**: The most glue to maintain, shared kernel between distros, a CLI sandbox that covers only shell commands and not MCP or file tools, and a hostname-only allowlist that can be fronted.
- **Reason for Rejection**: Not rejected. Kept as the fallback, built only if the week-0 `sbx` spike fails (author decision, 2026-11-25).

## Alternative V: A self-hosted GitHub Actions runner with the shipped reference pusher

- **Pros**: Event-driven and GitHub-native, and it reuses the shipped pusher from #587.
- **Cons**: A self-hosted runner can execute untrusted code from a public repository (my background knowledge, unchecked), and AgentFlow's repository is public. It shares the machine with the credentials and the `sbx` host, and the runner's updates are the author's to maintain.
- **Reason for Rejection**: Rejected by author: poll first. A runner may return as a trigger, behind the same intake seam.

## Alternative W: A webhook relay now

- **Pros**: Event-driven, with nothing inbound to the author's machine if the machine connects out. It is also the route for other services such as Linear or a board app.
- **Cons**: It adds a service to operate, and new signature and replay handling to build and test, and it needs a reconcile sweep for dropped events.
- **Reason for Rejection**: Rejected by author for now: relay later, as another trigger behind the same intake seam. It stays a Non-Goal for the 26 weeks.

## Alternative X: Schedule work by the author's review minutes

- **Pros**: It keeps audit load within the author's available time and gives a natural back-pressure signal.
- **Cons**: It makes the factory depend on the author's calendar and needs a model of review effort that does not exist.
- **Reason for Rejection**: Rejected by author (D21): the author's hours are not a scheduler input. Back-pressure comes from the in-flight cap, the revert circuit breaker and subscription quota, and the author can pause and resume the factory.

## Alternative Y: Keep the OpenRig layer as shipped, or trim it conservatively or moderately

- **Pros**: Keeps shipped capabilities for adopters (the product handoff verbs, recovery, mutation, the workflow generator, tiered builder routing) and avoids retracting merged ADR 016 decisions. The conservative trim removes only dead code. The moderate trim keeps the intake bridge, the workflow generator, the reference pusher, the seat presets and the steer guard.
- **Cons**: The adapter is 18,438 lines (8,471 code, 6,194 tests, 3,773 data) for a layer that is optional and outside the reference stack. About 3,100 lines have no caller outside tests, policy is duplicated in five places, four handoff systems coexist, and nothing has run against a live daemon.
- **Reason for Rejection**: Rejected by author: trim to the minimal adapter (push work into a rig and read evidence back) after a capability review against OpenRig 0.7.19, which now provides several of these capabilities natively.

## Alternative Z: Keep substrate implementations in the core package under `lib/substrate/`

- **Pros**: Follows the repository's port convention (`lib/sources/`, `lib/providers/`), needs no change to the adapter machinery, and has the fewest files.
- **Cons**: Adapter code sits inside the core package, so the brief's separation (nothing in the verifier or `evidence verify` imports an adapter) would rest on a convention and not on a directory boundary.
- **Reason for Rejection**: Rejected by author: implementations live in `adapters/<name>/`, which keeps the separation visible. An architecture-fitness test enforces that the verifier, evidence, signing and verification code never import `adapters/**`.

## Alternative AA: One npm package for each substrate adapter

- **Pros**: The strongest isolation and independent versioning, which suits `sbx` being pre-1.0 and changing often.
- **Cons**: A second package to publish, version and keep compatible with the core contract. This repository is a single package today.
- **Reason for Rejection**: Rejected by author: release overhead and version-skew risk for a one-maintainer project. Revisit if an adapter needs a heavy dependency that the core package should not carry.

## Alternative AB: Retract only the unwired `lease-fencing` module and keep the word "fencing"

- **Pros**: Each ledger claim matches the code exactly, and docs that describe the live mechanisms stay unchanged.
- **Cons**: Readers meet two "fencing" ideas, one retracted and one live, and a retraction can be read as "the run store is unprotected".
- **Reason for Rejection**: Rejected by author: remove the word from prose and rename the live mechanisms ("writer generation" and "epoch counter"), so that nothing live shares a name with a retracted claim.

## Alternative AC: Reverse the retraction and wire cross-machine fencing tokens

- **Pros**: Keeps the original principle 5 promise that two machines cannot work on the same task.
- **Cons**: `lease-fencing` duplicates `seat-lease.mjs`, and the factory runs on one machine (D18), so the wiring would add code with no real caller.
- **Reason for Rejection**: Rejected by author: the claim is retracted, and cross-machine operation is not a goal of the 26 weeks.

## Alternative AD: Do the distribution work in M2, when the factory first needs it

- **Pros**: The loader change is built against a real use, one authorization covers it, and the model and effort choices are made after M1 measurements.
- **Cons**: The Gemini routing bug (Gemini routed through the removed `pi`) stays through M0 and M1, and project-supplied profiles arrive later.
- **Reason for Rejection**: Rejected by author: M0, as the brief says. The bug is fixed early, and a later revision is another authorized migration if measurements require it.

## Alternative AE: Retract `qa-contract-verifier` entirely

- **Pros**: The smallest change, and no unwired module is left behind.
- **Cons**: It loses the one real check in the module (a "passed" verdict needs digested artifacts), which the GxP trace matrix will need.
- **Reason for Rejection**: Rejected by author: the module is kept and wired through a tester lane, after month 6 (P-2).

## Alternative AF: Keep only the artifact check and drop the tool check

- **Pros**: Keeps the real check for about 60 lines, with no new lane.
- **Cons**: Leaves the black-box principle (no source reading, no edits) unenforced, so it would stay unclaimed.
- **Reason for Rejection**: Rejected by author: deliver the principle as written, with a tester lane that mounts only the built artifact, after month 6 (P-2).

## Alternative AG: A manual week-0 gate, replaced by code later

- **Pros**: Keeps the brief's rule at low cost: a documented manual kill and the `sbx` spike results, with the code kill switch and daily cap arriving in M1 and M2.
- **Cons**: Weeks 1-8 would depend on manual procedures that someone has to keep honest.
- **Reason for Rejection**: Rejected by author: build a minimal code kill switch, run-count cap and guarded runner in week 0, so the gate is enforced by code from the start.

## Alternative AH: No separate week-0 gate

- **Pros**: The simplest plan: controls arrive with each milestone, and unattended runs start with the M2 soak.
- **Cons**: It assumes the author watches the agents during weeks 0-8, and agents would run without containment while they build the containment.
- **Reason for Rejection**: Rejected by author: the brief's gate stays ("no unattended runs before this passes").

## Alternative AI: Only the `sbx` spike in week 0

- **Pros**: The shortest week 0, which matters now that week 0 carries the gate.
- **Cons**: The signed-act slice in M1-13 could hit the line-ending problem before M3-5, and the case study would have no recorded "before" numbers.
- **Reason for Rejection**: Rejected by author: all three spikes run in week 0, as the brief says.

## Alternative AJ: Run each spike where it is first needed

- **Pros**: Week 0 stays focused on the gate and the `sbx` spike, and each unknown is answered just before the work that depends on it.
- **Cons**: The vendor-terms risk would stay open into M2, and a late "no" would arrive after work built on the assumption that it is allowed.
- **Reason for Rejection**: Rejected by author: answer the early unknowns before M0 starts.

## Alternative AK: Net-zero surface, enforced by CI

- **Pros**: It shrinks the surface a newcomer faces and makes the freeze rule real: a `manifests/surface-count.json` fails CI when a count rises without a retirement.
- **Cons**: It adds an M0 audit to find verbs and schemas that are safe to retire, and some planned additions would have to fold into existing command groups.
- **Reason for Rejection**: Rejected by author: accept the "state why" rule as drafted.

## Alternative AL: A capped growth budget

- **Pros**: Growth is bounded and visible, and no retirement audit is needed.
- **Cons**: The cap is a guess. Legitimate work can exceed it, and a loose cap never binds.
- **Reason for Rejection**: Rejected by author: accept the "state why" rule as drafted.

## Alternative AM: At most 3 PRs in flight in total

- **Pros**: The simplest rule, the least exposure if a bad change merges, and at most three changes waiting for cross-family review.
- **Cons**: Three slow items from one lane would block the other lane's work.
- **Reason for Rejection**: Rejected by author: the cap is 3 per agent lane, as D5 says.

## Alternative AN: A signed tag for each milestone boundary

- **Pros**: The simplest mental model: one signed tag in the control repository after the exit criteria pass, and the coordinator admits no next-milestone work without it.
- **Cons**: It is a new mechanism beside the existing person gates, it ties a gate to a phase number (the README says gates bind to subjects), and nothing binds the signature to what the exit criteria showed.
- **Reason for Rejection**: Rejected by author: milestones are goals, admitted through the existing admission gate.

## Alternative AO: No milestone gate beyond delegation changes

- **Pros**: The fewest interruptions and the closest fit to a dark factory: the only signed acts are the delegation, its scope changes (ladder promotions and release) and policy changes.
- **Cons**: Fewer signed human checkpoints, which the GxP mapping uses as design-review evidence, and milestone work could drift from its goal between ladder promotions.
- **Reason for Rejection**: Rejected by author: keep a human admission at each milestone.

## Alternative AP: A narrated screencast recorded by the author

- **Pros**: The most persuasive for a services offer.
- **Cons**: It costs the author's time, sits on the author's side of D12 (business work), and goes stale at each release.
- **Reason for Rejection**: Rejected by author: a generated terminal recording of the scripted demo, regenerated at every release.

## Alternative AQ: No screencast

- **Pros**: The least to build and maintain. The scripted demo and the website walkthrough pages are the demonstration.
- **Cons**: A prospect who will not run the demo has nothing quick to look at.
- **Reason for Rejection**: Rejected by author: keep a short recording, as the brief says.

## Alternative AR: Keep human approval for `factory-core` and release only

- **Pros**: Consistent with the repository's rules with no policy weakened, and the strongest GxP story: an individual human signature on the riskiest changes.
- **Cons**: The factory is not dark at L3. Control-plane changes and releases wait for the author, and approvals can turn into rubber stamps. It narrows D4.
- **Reason for Rejection**: Rejected by author: keep D4 and add an opt-in delegation setting, with this repository opting in.

## Alternative AS: A new change class for `factory-core`, leaving "high-assurance" unchanged

- **Pros**: Nothing existing is weakened, and D4 stays.
- **Cons**: It adds vocabulary to a project whose reviewers already flagged overlapping terms, and it can look like renaming to avoid a rule.
- **Reason for Rejection**: Rejected by author: keep the "high-assurance" class and make the delegation setting explicit and opt-in.

## Alternative AT: Merge tickets signed by the author for each goal

- **Pros**: Each goal carries a signature of the author with a bounded number of merges, paths and an expiry, which limits what a compromised steward can do.
- **Cons**: A ticket to sign for every milestone, and an exhausted ticket stalls the factory until the author issues another. Loose bounds stop limiting anything.
- **Reason for Rejection**: Rejected by author: the steward issues each per-merge decision under the standing delegation, and the delegation's scope carries the limit.

## Alternative AU: Edit only the binding policy and this repository's agent instructions

- **Pros**: About 12 files change, and the docs that describe the default rule stay accurate for every adopter on the default. Ledger rows would record that this repository opts in.
- **Cons**: A reader of a description-only doc inside this repository could take it as this repository's own practice.
- **Reason for Rejection**: Rejected by author: qualify every statement with "by default", about 26 files in total, so that no statement misleads.

## Alternative AV: List the human acts in a sentence in the Overview

- **Pros**: The smallest edit, and the Overview claim becomes true.
- **Cons**: A list in prose drifts as acts are added or moved, and the GxP mapping has nothing to cite.
- **Reason for Rejection**: Rejected by author: a "Human acts" table in the Technical Plan, linked from the Overview, with a claims-ledger row.

## Alternative AW: Every release and the verifier pin stay human

- **Pros**: A person stands behind every public artifact and behind the judge; the simplest release story.
- **Cons**: Verifier changes and releases queue behind the author, and the factory can run against a stale judge while fixes wait. It narrows D4 the most.
- **Reason for Rejection**: Rejected by author: the steward cuts `next` prereleases so the factory stays dark through release; `latest` and the verifier pin stay human.

## Alternative AX: The steward performs every release and the verifier pin, guarded

- **Pros**: Fully dark, as D4 first stated. A pin change would pass the current verifier and the canon, then wait out the time-lock with the author's veto.
- **Cons**: A ratchet: each small weakening of the verifier passes the previous verifier, so a series of agent pins can erode the judge with no single step failing. Countering it needs a canon that never shrinks and a rule that fails a pin when any canon case stops being caught.
- **Reason for Rejection**: Rejected by author: the default public channel and the choice of judge stay with a person.

## Alternative AY: Repository configuration owns all policy; the control repository holds only signed acts and secrets

- **Pros**: One configuration mechanism, simpler for adopters, and `validate:authority` needs no new owner. Path classes and the opt-in would sit in `sdlc.config.json`, with changes to them treated as `factory-core` changes under the time-lock.
- **Cons**: An agent can propose moving a path out of `factory-core`, and only the time-lock and the author's veto stop it. A missed veto lets the next change to that path skip the time-lock.
- **Reason for Rejection**: Rejected by author: the control repository is the only owner of trust-bearing policy, so agents cannot reach the classifier or the opt-in.

## Alternative AZ: A separate substrate port and registry, justified in an ADR

- **Pros**: A clear security seam in the `source-adapter` style: containment, which the verifier and evidence rely on, stays out of the layer where provider descriptors are self-declared.
- **Cons**: A second registry for something `docs/modular-architecture.md:33` assigns to the provider layer, which `docs/guiding-principles.md:123` forbids unless justified, plus a new `substrate` adapter kind in the plugin machinery.
- **Reason for Rejection**: Rejected by author: a `containment` provider facet, with the launcher's conformance-run gate giving the security property.

## Alternative BA: Agent merge for every class within month 6

- **Pros**: G3 and D4 stay whole and the month-6 story is the strongest: the steward merges `factory-core` and cuts `next` prereleases before M5.
- **Cons**: The largest share of open review findings stays on the critical path (merge control on the host, revert and kill ordering, the veto, the policy rewrite before the first unattended run), and week 0 and M2b are the heaviest milestones.
- **Reason for Rejection**: Rejected by author (2026-11-25): month 6 stops at L2 so that no rule is weakened before the evidence, GxP and publishing milestones; L3 keeps the decisions already made and follows after M3.

## Alternative BB: Human merge for everything within month 6

- **Pros**: Removes the most findings and needs no policy change; agents still build unattended and open PRs.
- **Cons**: "Dark" shrinks to "unattended up to the PR", and the author's merge time limits throughput.
- **Reason for Rejection**: Rejected by author (2026-11-25): the existing standard self-review path already allows agent merge of L1 and L2 work without weakening any rule, so the factory can stay dark for most work.

## Alternative BC: Trim OpenRig by hand in M0

- **Pros**: The 18,438-line adapter shrinks early, and G1 has fewer claims to back.
- **Cons**: M0 grows, and the second review found the M0 file list wrong in several places; a missed importer breaks `validate:release` on the critical path.
- **Reason for Rejection**: Rejected by author (2026-11-25): the trim becomes scoped L2 issues that the factory builds in M2, checked by the release gate.

## Alternative BD: Defer the OpenRig trim and its capability review past month 6

- **Pros**: The least month-6 work; the claims ledger marks the adapter's documented controls `planned` or `retracted`, which satisfies G1 without deleting code.
- **Cons**: About 18,000 lines stay for six months, against the author's stated intent.
- **Reason for Rejection**: Rejected by author (2026-11-25): the trim stays in month 6 as factory work off the critical path.

## Alternative BE: Build the WSL2 substrate in month 6 so the substrate port can be claimed as pluggable

- **Pros**: "Two implementations per port" holds for every port except signing, and WSL2 doubles as the fallback.
- **Cons**: A second full containment stack in an already heavy M2, whose weaknesses Alternative U lists; a reviewer doubted it can pass the suite honestly.
- **Reason for Rejection**: Rejected by author (2026-11-25): "pluggable" is claimed for sources and execution providers, which already have two implementations; WSL2 is built only if `sbx` fails.

## Alternative BF: Drop the word "pluggable" for the month-6 claim

- **Pros**: The least work and the most cautious claim.
- **Cons**: The product principle that integrations are pluggable is not shown anywhere, although two ports already have two implementations each.
- **Reason for Rejection**: Rejected by author (2026-11-25): claim it where the code already proves it.

## Alternative BG: Wire the learning pipeline, tester lane and process supervisor in month 6

- **Pros**: The author's earlier "wire, not retract" decisions hold, and each claim is backed by running code at month 6.
- **Cons**: M2 and M4 stay heavy with work that does not change the month-6 claim; the launcher already owns process kill, and the learning input is agent-writable with no reward yet.
- **Reason for Rejection**: Rejected by author (2026-11-25): these move past month 6 with `planned` ledger rows; the gate sweeper stays, because milestone admission needs it.

## Alternative BH: Also defer the GxP packaging, the demo recording and the website

- **Pros**: The smallest month 6.
- **Cons**: The month-6 package loses the GxP pack and the public pages that the services offer depends on.
- **Reason for Rejection**: Rejected by author (2026-11-25): GxP stays, bounded to what G6 checks, and the website and demo stay in the month-6 package.

## Alternative BI: Write all ten ADRs in week 0

- **Pros**: Every decision is recorded before the first unattended run.
- **Cons**: The week-0 gate moves further from the start, and the ADRs for M2b to M4 are written months before they can be checked against reality.
- **Reason for Rejection**: Rejected by author (2026-11-25): each ADR is written by the milestone that builds what it records.

## Alternative BJ: Move the digest and signing spike to M3 with the evidence ADRs

- **Pros**: Week 0 is one day shorter, and the spike sits beside the work it informs.
- **Cons**: M1 writes evidence records from the start; a format problem found in M3 forces a migration of those records.
- **Reason for Rejection**: Rejected by author (2026-11-25): the spike stays in week 0.

---
