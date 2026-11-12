# OpenRig bridge

The bridge moves ready work from a source system into an OpenRig rig's queue, and writes each
phase's role-pass evidence back to the source. It is optional: with no rig configured, every
`bridge` command does nothing, says so, and exits 0.

The source stays the truth. The bridge re-reads the source on every command, and queue rows carry
only a source reference and ids derived from it, never the item's title or body. The bridge has no
polling loop: something pushes ("look at this reference"), or a person runs `bridge reconcile`.

The bridge works only through the [source adapter contract](sources/index.md) and an injected queue
port, so it does not depend on any one source system. Configured source adapters are built by
`lib/sources/registry.mjs`.

## Configuration

Add `adapters.openrig.bridge` to `agent-workflow.config.json` (or `agentflow.config.json`):

```json
{
  "adapters": {
    "openrig": {
      "bridge": {
        "rig": "agentflow-myproj",
        "source": {
          "adapter": "filesystem",
          "root": ".agentflow/source",
          "writer": "agentflow-bridge"
        },
        "ready": {
          "all": [
            { "kind": "label", "has": "agentflow:ready" },
            { "kind": "lifecycle", "state": "open" }
          ]
        },
        "entrySeat": "pm.analyst",
        "workflowSpec": "adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml"
      }
    }
  }
}
```

| Key                      | Meaning                                                                                               | Default                                                 |
| :----------------------- | :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| `rig`                    | The delivery rig. Shorthand for `rigs: { control: rig, delivery: [rig] }`                             | none: no rig means the bridge is off                    |
| `rigs.control`           | The rig that runs the bridge and the product seats                                                    | the first delivery rig                                  |
| `rigs.delivery`          | The delivery rigs offered work ([Several delivery rigs](#several-delivery-rigs))                      | `[rig]`                                                 |
| `partition`              | Narrows which delivery rigs an item is offered to, by mission or area label                           | none: every delivery rig                                |
| `maxOpenGates`           | Open person gates at which intake stops, when the project has no team roster                          | 3                                                       |
| `source.adapter`         | A registered source adapter (`filesystem`, or a hosted source when its adapter declares readiness)    | required                                                |
| `source.claimWriters`    | Writers whose claim entries the source trusts                                                         | the bridge's own writer                                 |
| `source.evidenceWriters` | Writers whose role-pass evidence counts for any bridge decision                                       | `source.claimWriters`; with neither, no evidence counts |
| `ready`                  | The [ready predicate](sources/index.md): `label`, `status` and `lifecycle` leaves under `all` / `any` | the `agentflow:ready` label on an open item             |
| `entrySeat`              | The seat that receives intake rows; its phase is where fresh work starts                              | `pm.analyst`                                            |
| `workflowSpec`           | The OpenRig workflow spec each item runs as                                                           | the AgentFlow delivery workflow                         |
| `escalateTo`             | The session that receives person escalations                                                          | `human@<rig>` of the rig whose port carries the ask     |

"No rig configured" means `bridge` is absent, or both `rig` and `rigs.delivery` are empty.

The `bridge` key is never projected into `adapters/openrig/rig.yaml`.

## Commands

```bash
agentflow-sdlc bridge intake <ref> [--event ready|review-done|merged|closed] [--payload-file <json>] [--json]
agentflow-sdlc bridge start <qitemId> [--session <seat@rig>] [--json]
agentflow-sdlc bridge evidence <ref> --phase <n> --status pass|skipped --seat <id> --body-file <file> --executed-by <slug> --launcher <slug> --executor <target> --transport <t> --delegation-boundary <b> [--model <m>] [--reason <text>] [--json]
agentflow-sdlc bridge reconcile [--dry-run] [--json]
agentflow-sdlc bridge escalate <ref> --reason <text> [--json]
agentflow-sdlc bridge status [--json]
```

Every command accepts `--target <dir>`. A reference is `<system>:<scope>#<id>`, for example
`filesystem:local#item-7`.

| Command     | What it does                                                                                                                                                                                                                                          |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intake`    | Re-reads the item and, when it is ready, creates one intake row for the entry seat. Pushing the same item again reports `already-queued` and creates nothing                                                                                          |
| `start`     | Run by the entry seat on a pending intake row. Claims the row in the queue (so only one start proceeds), re-reads the item, claims it in the source, starts one workflow instance and hands the row off to it. Do not `rig queue claim` the row first |
| `evidence`  | Writes one role-pass comment to the source. A retry with the same inputs writes nothing                                                                                                                                                               |
| `reconcile` | Rebuilds the queue from the source in one pass                                                                                                                                                                                                        |
| `escalate`  | Asks a person through the queue                                                                                                                                                                                                                       |
| `status`    | Shows the rigs, the source, its limits, the ready predicate and whether `rig` is usable                                                                                                                                                               |

`start` reads its session from `OPENRIG_SESSION_NAME` when `--session` is not given. `evidence`
reads it from `OPENRIG_SESSION_NAME` to decide `seatVerified` and to check the reviewer.

## Trusted evidence writers

Every decision the bridge takes from role-pass evidence (the resume phase, which phases to replay,
whether review is done, whether a call is a retry, and whether a transition is legal) uses only
evidence written by a trusted evidence writer: the source-provided author of the comment or log
line, never a field inside it. Configure them with `source.evidenceWriters`; they default to
`source.claimWriters`. With neither configured no evidence counts: items start at the entry phase,
nothing is replayed, review never resolves, and every command reports
`evidenceTrust: no-evidence-writers-configured`. Include the bridge's own writer when the bridge
writes evidence.

### Exit codes

| Code | Meaning                                                                                              |
| :--- | :--------------------------------------------------------------------------------------------------- |
| 0    | Done, no rig configured, not ready, deferred, or already queued                                      |
| 1    | Source, rig or configuration failure; a ready predicate the source cannot evaluate; refused evidence |
| 2    | Usage                                                                                                |

## Ids

All ids come from the source reference, so the same item always maps to the same row.

| Id                 | Rule                                                                                       |
| :----------------- | :----------------------------------------------------------------------------------------- |
| Stable id          | `af-<system>-<first 8 hex of sha256(scope)>-<id>`, lowercase, at most 64 characters        |
| Slice              | `<system>-<id>`                                                                            |
| Next generation    | `<stable id>-g<n>`, used when the earlier intake row is closed and the item is ready again |
| Offer              | `<stable id>-<first 6 hex of sha256(rig)>`, one per delivery rig when there are several    |
| Tag                | `af:<stable id>` on every intake row and workflow instance                                 |
| Review/merge gates | `external:review:<stable id>`, `external:merge:<stable id>`                                |
| Replay gate        | `external:reconcile-replay:<stable id>`                                                    |

The change class sets the row tier: `bounded` → `fast`, `standard` → `routine`, `high-assurance` →
`critical`, anything else → `routine`.

OpenRig treats a repeated `rig queue create --id` with the same destination and source as a
re-delivery and returns the stored row, so intake is idempotent even across retries.

### Intake row body

```text
agentflow-intake/v1
ref=filesystem:local#item-7
stable_id=af-filesystem-3f9a1c2e-item-7
slice=filesystem-item-7
resume_phase=1
tier=routine
workflow=adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml
```

## Pushed content

A pusher may send what it saw with `--payload-file`. The bridge never decides from it: it re-reads
the source and lists any pushed field that disagrees (`title`, `labels`, `state`, `lifecycle`,
`status`) in `pushedContentIgnored`.

## Events

| Event         | Requires                                                                                                      | Effect                                                                |
| :------------ | :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------- |
| `ready`       | The ready predicate holds                                                                                     | One intake row, or `not-ready` with reasons, or `deferred`            |
| `review-done` | A phase 6 pass recorded after the latest phase 4 pass; with a team roster, also an in-scope person's decision | Resolves rows parked on `external:review:<id>` with the evidence link |
| `merged`      | The item's lifecycle is `merged`                                                                              | Resolves rows parked on `external:merge:<id>`                         |
| `closed`      | The item's lifecycle is `closed`                                                                              | Aborts live workflow instances and cancels live rows for the item     |

## Evidence

`bridge evidence` checks the transition against the phase graph, and checks `--executed-by` and
`--launcher` against the [runtime platforms](runtime-platforms.md), `--executor` against the
[execution targets](execution-targets.md), and `--transport` and `--delegation-boundary` against
their vocabularies. It records them as separate fields. `seatVerified` is true only when the
caller's OpenRig session holds the seat it names.

Phase 6 (review) pass evidence needs a reviewer. It is refused unless the caller's OpenRig session
is given, holds the review seat (`rev-review@<rig>` for `rev.review`), and is not the seat or session
of any trusted phase 4 transition.

## Reconcile

`bridge reconcile` makes one pass:

1. Lists the source's open items.
2. Keeps an item that has live work. Otherwise, when it is ready and admitted, creates an intake row
   (the stable id, or the next generation) with `resume_phase` from trusted evidence: the phase a
   later return names, else one after the latest applied phase. Not-ready items are reported with
   reasons; an item past the return-cycle limit is skipped for a person.
3. For the bridge's live intake rows and live instances of items that are no longer open: resolves
   the merge gate of a merged item, aborts the work of a closed item, and reports anything else as
   an orphan. This step lists rows by the bridge's source session with an explicit limit; a full
   page is an error, not a smaller answer.

After the queue is emptied, `reconcile` restores one intake row for every open ready item.

### Live work

An item has live work when a row of its intake chain is pending, in progress or blocked, or a
workflow instance tagged `af:<stable id>` is active or waiting. The intake chain is the stable id
and its generation ids, read one at a time with `rig queue show`; liveness never comes from
`rig queue list`, whose output is bounded (100 rows by default, newest first). Escalation and
notice rows carry the tag `af-notice:<stable id>` and are not work.

## Assumption about replaying phases

When a rebuilt item resumes past its entry phase, `start` replays each phase the source already
evidences with `rig workflow project --exit handoff --actor-session <entry session>`. This assumes
that OpenRig lets the entry session close each step for its owner (A3), and that a `handoff` exit
opens the next step in the spec's step order (A2). Neither is verified here; verify both in a live
smoke against OpenRig 0.7.6 or later.

If OpenRig refuses a replay, or the source lacks trusted evidence for a phase in between, `start`
aborts the half-replayed workflow instance, parks the intake row with
`rig queue block --on external:reconcile-replay:<stable id>`, and tells a person. Fix the cause,
then run `bridge start <qitemId>` again: it claims the parked row and starts a fresh instance. To
give up, cancel the row.

## Extension points

The bridge takes these optional ports:

| Port          | Used for                                                                                    |
| :------------ | :------------------------------------------------------------------------------------------ |
| `admission`   | Backpressure: returns `{ admit: false, reason }` to defer intake. Default admits everything |
| `claim`       | Claim before work; default claims through the source when it declares `claim`               |
| `worktrees`   | `prepare` on start, `cleanup` on merged, `sweep` on reconcile                               |
| `notifier`    | Person delivery; default creates a queue row with human intent `decision`                   |
| `queues`      | One queue port per rig name; a rig without one uses `queue`                                 |
| `roster`      | The team roster; with it the review gate needs an in-scope person's source decision         |
| `gateEntries` | Reads the source log entries for gate decisions; default the adapter's `readLogEntries`     |

The CLI wires `admission` to the gate-capacity port and `roster` to `.agentflow/team-roster.json`
as committed at `HEAD` of the primary checkout ([team roster](team-roster.md)); an uncommitted edit
changes nothing, and the bridge never reads the private overlay.

## Several delivery rigs

A team with more ready work than one rig can carry adds delivery rigs to the same project. The rigs
never talk to each other: they coordinate only through the source.

```json
"bridge": {
  "rigs": { "control": "agentflow-myproj", "delivery": ["agentflow-myproj-d1", "agentflow-myproj-d2"] },
  "source": { "adapter": "filesystem", "claimWriters": ["agentflow-bridge", "rig-d1", "rig-d2"] },
  "partition": { "key": "mission", "map": { "578": ["agentflow-myproj-d1"] } },
  "maxOpenGates": 3
}
```

- **Rigs.** The control rig (`agentflow-<project>`, a product-base copy) runs the bridge and the
  product seats. Delivery rig _n_ is `agentflow-<project>-d<n>`, a delivery-base copy. Every rig's
  `cwd` is the one project root.
- **Offers.** `intake` and `reconcile` create one offer row per delivery rig the partition names,
  each on that rig's queue (id `<stable id>-<6 hex of sha256(rig)>`), destined for the rig's entry
  seat. With one delivery rig the row keeps the plain stable id.
- **Claim before work.** The entry seat of each rig runs `bridge start <qitemId>` on its own offer.
  `start` claims the item in the source before it creates anything. The earliest trusted claim wins;
  a losing rig closes its offer as `canceled` with resolution `claimed by <rig>` and creates no
  worktree and no workflow instance. The start session must be on a configured delivery rig.
- **Partition.** `key: mission` maps the item's parent (`partOf`) to rigs; `key: area` maps the
  label after `prefix` (default `area:`) to rigs. An item the map does not name is offered to every
  delivery rig. Every rig in the map must be a delivery rig.
- **A source without `claim`** allows one delivery rig. Configuring more is a configuration error
  (exit 1) that quotes the source limits (`describeSourceLimits`).

### Adding a rig

1. `agentflow-sdlc adapters squads provision openrig --kind delivery --replica <n> <project> <cwd>`
   (the control rig is `--kind control <project> <cwd>`). Provisioning refuses a rig name that
   already exists and writes only the new rig's files.
2. `agentflow-sdlc adapters catalog openrig --write --id <project> --rig agentflow-<project>-d<n>`
   appends the rig to the project in `workspace.yaml`.
3. Append the rig to `adapters.openrig.bridge.rigs.delivery` and add its source writer to
   `source.claimWriters`.

No file of a running rig changes: the workflow spec addresses seats as `member@{rig}`, the control
rig's `sibling.md` does not list delivery rigs, and a delivery rig's `sibling.md` names only the
control rig. Rows queued while the project had one rig stay visible, so nothing is queued twice.

### Backpressure

More rigs help only while people keep up with review. Before it queues new work, the bridge counts
the open person gates on the source (the sum of `openGates` over open items). When that count
reaches capacity, `intake` reports `status: deferred, reason: gate-capacity, openGates, capacity`
and `reconcile` lists the item under `deferred`; nothing is queued. After a gate closes, the next
push or `reconcile` queues it.

Capacity is the sum of `capacity` over the [team roster](team-roster.md) people (3 each by default).
Without a roster it is `maxOpenGates` (default 3, one person). Start with one delivery rig per
active reviewing person. **These numbers are not measured.** Record gate wait time and the open-gate
count from the source and revise them.

### When the control rig stops

Delivery-side commands (`start`, `evidence`) use only their own rig's queue and the source, never
the control rig. If the control rig stops, delivery rigs finish the work they have claimed, no new
offers arrive, and they idle. Escalations from a delivery rig go to `human@<that rig>` unless
`escalateTo` is set.

The CLI talks to the local OpenRig daemon, so the control rig and its delivery rigs share one
daemon. Rigs on other hosts are not reached by one bridge; that is not verified against OpenRig.

### Gate resolution stays outside the rig

Workers cannot approve their own work. `intake --event review-done|merged|closed` and `reconcile`
refuse a call whose `OPENRIG_SESSION_NAME` is a seat session on the delivery or eval plane
(`manifests/seats.json`), or any seat session on a delivery rig other than the control rig. A person,
a relay or CI (no session) may call them.

With a team roster, `review-done` also needs a person's decision recorded in the source: a comment
whose first line is
`<!-- agentflow-gate-decision:{"v":1,"gate":"<ref>:review:<digest>","decision":"agree"} -->`,
written by a roster person in scope for `acceptance-review` at the item's tier (both reviews for
high-assurance). The gate id binds the evidence under review: `<digest>` is the first 16 hex of the
SHA-256 over the trusted transitions up to the latest phase 6 pass, and `review-done` reports the
current id under `gate.gateId` while it waits. A new build and review round has a new digest, so an
agreement for an older round is `stale-gate` and does not count. The bridge reads the decision with
the roster's `gateDecisionState`. A decision from a bridge writer, from someone off the roster,
given in chat, or in an edited comment counts for nothing; on a high-assurance item an entry whose
edit state the adapter does not report is refused too. The adapter's `readLogEntries` supplies the
entries with `edited`, `createdAt` and `updatedAt` (the filesystem log is append-only, so its entries
are never edited). A source adapter without `readLogEntries` opens no roster gate.

### One rig per project and the shared workspace

Goal #578 decision 7 says one rig points at one project. The shared workspace from #553 attaches
adopter repositories through `workspace.yaml`. The two compose:

- `workspace.yaml` is a catalogue of projects, `projects: [{ id, root, rigs: [...] }]`, each listing
  its own rigs. Nothing in #553 is removed.
- Decision 7 is the constraint on that catalogue: a rig's `cwd` is exactly one project root, and a
  rig name appears under at most one project. A project may list a control rig and several delivery
  rigs.
- `adapters catalog` enforces it: for an existing project id it appends a new rig to that project's
  `rigs`, leaves an already-listed rig as a no-op, and refuses a rig already attached to another
  project, writing nothing.

This record follows the ADR 016 draft for goal #578 (open-question resolution b).
