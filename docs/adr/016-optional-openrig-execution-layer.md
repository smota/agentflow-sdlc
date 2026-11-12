# ADR 016 — Run AgentFlow delivery on an optional OpenRig execution layer

**Status:** Accepted for decisions delivered by merged parts (#580, #581, #582, #584, #587); each remaining decision is
marked with its pull request and becomes Accepted when it merges. The high-assurance review of the
team roster (#585) is awaiting a person.
**Date:** 2026-11-11

## Context

The OpenRig adapter already ships seats, squads, dispatch and handoff verbs (#553, #516), but it is a
set of seats rather than an execution layer. Ready work is hand-fed to the rig; nothing connects the
source system (GitHub issues and pull requests) to the rig queue, and OpenRig does not plan to add
such a bridge. The rig specification knows a working directory but not a worktree, so seat isolation
is manual. Seat names drift between policy, path-ownership rules and rig specifications (`eval.tester`
has no rule; `rev.gate`, `arch.lead`, `orch.lead` appear in policy but no rig provisions them). One
person is assumed at every gate, and nothing stops two rigs from taking the same item.

A design session with the person on 2026-11-11 agreed the decisions below (goal #578). The rig must
stay optional: a team without it loses nothing.

## Decision

1. **The source is the truth; the rig queue is a projection.** _(Bridge #582, merged.)_ Queue rows carry a reference and
   derived ids, never artifact content. A lost rig loses nothing: `agentflow-sdlc bridge reconcile`
   rebuilds the queue from the source on demand.
2. **The bridge speaks the source adapter contract, never GitHub directly.** _(Contract #580 merged; bridge #582 merged.)_ The bridge lives in
   `lib/bridge/` and takes an injected `SourceAdapter` and an injected rig queue port; GitHub code stays
   in `lib/sources/github*.mjs`, and adapter construction lives in `lib/sources/registry.mjs`. GitHub
   is the first adapter; a filesystem source adapter serves tests and local use.
3. **Intake is pushed, not polled.** _(Bridge #582 and pusher #587, merged.)_ Something outside the rig (a CI job on a self-hosted runner, a
   relay, a person) sends a reference such as `github:org/repo#582`. The bridge re-reads the item through
   the adapter and ignores any pushed content. The same push path carries `review-done`, `merged` and
   `closed`. There is no polling loop; `reconcile` repairs a lost push when someone runs it. A reference
   pusher ships as an example (`adapters/openrig/examples/github-rig-push.yml`) and sends only the reference
   and the event kind.
4. **"Ready" is a configurable predicate** over `label`, `status` and `lifecycle`, combined with
   `all`/`any`. Each adapter declares the kinds it can evaluate; a predicate using an undeclared kind
   is a configuration error, distinct from "not ready". GitHub declares `label` and `lifecycle` (it has no
   status field).
5. **A claim is one capability with system-specific storage.** _(#580 and #581, merged.)_ The source contract gains optional
   `claim`, `ready-predicates`, `watch` and `resolve-humans` capabilities and a non-throwing
   "capability absent" result that callers can tell apart from a failed call. A claim is an
   append-only log entry; the entry's writer identity, checked against trusted writers, is the
   authority, and the earliest trusted entry wins. Edited entries do not count: an entry edited after
   it was written is ignored, though a deletion leaves no trace, so write access to the repository must be
   limited to people trusted with the claim. The native field (GitHub assignee, filesystem
   `claim.lock`) is a mirror for people and is never read back as truth. A reassignment in the GitHub
   UI is input that becomes a recorded release and claim. An adapter without `claim` limits the project
   to one delivery rig.
6. **Many people, through a team roster owned by AgentFlow.** _(#585, pending merge and human review.)_ `.agentflow/team-roster.json` records
   each person's source handle, scopes (gate type, paths, tier), backup, timeout and capacity; private
   channel addresses live only in the gitignored overlay `.agentflow/team-roster.local.json`. Both files
   are denied to every rig seat by path ownership. Gates route to an in-scope person and to the backup
   after the timeout (a rig timer, not a poll). Only source log entries from roster people in scope open
   or answer a gate; a decision given in chat counts once it is recorded in the source. High-assurance
   gates track security and acceptance review separately and may be met by two people. Without a
   roster, today's single-person path applies. OpenRig is only the delivery pipe.
7. **Many delivery rigs, not one per person.** _(#586, pending merge.)_ A rig's `cwd` is exactly one project. A project may have
   one control rig (bridge, product seats) and several delivery rigs (`squads provision --kind
control`, `--kind delivery --replica <n>`). Rigs coordinate only through source claims: an item may
   be offered to several delivery rigs and the claim decides who works it. A partition key (mission or
   area label) narrows offers. New work stops being projected while open gates reach roster capacity.
8. **Worktrees stay in AgentFlow.** _(#584, merged.)_ `bridge start` creates `.worktrees/<slice>` on its own branch and
   points the seat at it with the `worktree_path=` line; the workflow's final cleanup step removes it
   after merge and releases the claim. A worktree is removed only under a safety rule: no uncommitted, untracked,
   ignored (other than disposable such as `node_modules`), unpushed or unmerged work, and its head is
   merged into the integration branch. A squash merge is recognised through the merged pull request's head
   (`mergedHead`) and the branch it merged into (`mergedInto`), both read through the adapter. Otherwise
   the worktree and the claim stay and a person is told. OpenRig is not changed (an upstream idea is open at
   mvschwarz/openrig discussion 2974; nothing depends on it).
9. **Steering stays outside the rig.** _(Evidence side in #582, merged; gate resolution in #586, pending.)_ Workers cannot approve their own work: the review step's seat
   cannot be the build seat, gate rows are resolved only by the out-of-rig bridge, and gate-resolving
   commands refuse a delivery-seat session.

Supporting decisions:

- **One canonical seat table** _(#579, pending merge)_, `manifests/seats.json`, lists every seat with pod, role, phases and
  write rule. Path ownership, rig specs, policy documents and distributions are checked against it.
  `eval.tester` is added; `rev.gate`, `arch.lead`, `orch.lead`, `pm.lead` and `steer.po` are kept as
  legacy aliases of `rev.review`, `orch.arch`, `orch.arch`, `pm.manager` and `steer.lead`, and rig specs
  may use canonical names only.
- **AgentFlow phases run as an OpenRig workflow spec** _(#583, pending merge)_,
  `adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml`, generated from
  `lib/core/phase-graph.mjs` and the seat table and checked in CI. Phase handover is a queue handoff
  (`rig workflow project`); waits on a person or a pull request are `external:` blocks; rework returns
  are `failed` branches. AgentFlow keeps the per-loop rework cap; `loop_guards.max_hops` is the
  instance backstop, and both escalate to a person (`exception_routing.classes.unmapped_failed:
human_only`). Goal and issue map to mission and slice; assurance level maps to queue tier
  (`bounded→fast`, `standard→routine`, `high-assurance→critical`).

Open-question resolutions:

- **GitHub identity:** one dedicated bot login (or GitHub App) per project, used for nothing else. The claim entry names the rig, so
  `readClaim` identifies the specific rig even though the writer and the assignee are the shared bot.
  Rigs sharing the account form one trust domain, and the bot is also the assignee mirror; per-rig accounts remain possible later without a
  format change.
- **Shared workspace (#553) and one rig per project:** they compose. `workspace.yaml` is a catalogue of
  projects, each with its own `rigs` list. A rig appears under at most one project; a project may list
  a control rig and several delivery rigs. `adapters catalog` appends rigs to a project and refuses a rig
  already attached to another.
- **Rig sizing per reviewing person:** unmeasured. Default capacity is three open gates per roster
  person, starting with one delivery rig per active reviewing person; backpressure holds intake at
  capacity. Gate wait time and open-gate counts are recorded to revise these numbers.

## As built: deviations and residual risks

- **Trusted evidence writers.** Every bridge decision taken from role-pass evidence counts only
  evidence written by a trusted writer (`source.evidenceWriters`, defaulting to `claimWriters`); with
  neither set the configuration is refused. This was not in the first design.
- **Per-item liveness.** Whether an item has live work is read item by item (`rig queue show` along the
  id chain, and the workflow list), never from the bounded `rig queue list`.
- **Session identity is self-asserted.** The session that records evidence comes from
  `OPENRIG_SESSION_NAME`. The review step refuses the build's session and a session that does not hold the
  review seat, but anyone who can run commands on the rig host can claim a seat. Rig-level identity would be
  needed to close this.
- **Worktree safety.** Removal is never forced; inspection and removal are separated by a lock, and a
  small window for an ignored file written in the last instant is accepted.
- **Roster location (#585).** The roster is read from a protected ref, with the private overlay outside
  the repository, and path matching on deny rules is case-sensitive.
- **Refusal rule.** A gate-resolving command refuses a delivery-seat session (#586).
- **Content-addressed revision.** The first GitHub `readArtifact` revision should be a content digest;
  tracked as a follow-up.
- **GitHub cost.** `listWorkItems` makes one comment fetch per issue.

## Not yet shipped

- Pi seats inside a rig and non-Claude long-running seats are unsupported, and the shipped presets still
  name a `pi` runtime for some seats (follow-up).
- The roster (#585) high-assurance review is awaiting a person, and GitHub needs raw log entries
  before roster-scoped review gates work there (#586 follow-up).
- Multi-host rigs: one bridge reaches only its local daemon.
- Rig sizing per reviewing person is unmeasured.
- `validate-openrig-workflow --rig` and a live replay smoke on OpenRig 0.7.6 or later are person-run
  checks; neither has run against a live daemon.

## Consequences

**Positive:** ready work reaches the rig after one push and comes back as role-pass evidence on the
source; losing a rig loses no state; several people and several rigs can share a project without
double work or unreviewed piles; any source adapter that implements the contract can drive the rig;
teams without a rig are unaffected.

**Negative:** the bridge adds a CLI surface, a queue port and a projection to keep consistent;
`workflow instantiate` is not idempotent in OpenRig, so the intake row's claim serializes it; per-item
seat working directories and per-loop rework guards are not OpenRig features, so isolation and the
rework cap rely on AgentFlow instructions and checks; `rig workflow validate` needs a running daemon
and cannot run in hosted CI; a hosted CI job cannot reach a rig on a private machine, so the reference
pusher needs a self-hosted runner, a relay or a person; Pi seats inside a rig and long-running
non-Claude seats' context continuity are not supported.
