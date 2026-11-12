# OpenRig bridge

The bridge moves ready work from a source system into an OpenRig rig's queue, and writes each
phase's role-pass evidence back to the source. It is optional: with no rig configured, every
`bridge` command does nothing, says so, and exits 0.

The source stays the truth. The bridge re-reads the source on every command, and queue rows carry
only a source reference and ids derived from it, never the item's title or body. The bridge has no
polling loop: something pushes ("look at this reference"), or a person runs `bridge reconcile`.

For adoption levels, a single-rig walkthrough and the reference pusher, see the
[execution layer guide](openrig-execution-layer.md).

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

| Key                      | Meaning                                                                                                            | Default                                                 |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| `rig`                    | The delivery rig. Shorthand for `rigs: { control: rig, delivery: [rig] }`                                          | none: no rig means the bridge is off                    |
| `rigs.control`           | The rig that runs the bridge and the product seats                                                                 | the first delivery rig                                  |
| `rigs.delivery`          | The delivery rigs offered work ([Several delivery rigs](#several-delivery-rigs))                                   | `[rig]`                                                 |
| `project`                | The project id in the bridge's queue session `agentflow-bridge@<project>-<source hash>`; unique per OpenRig daemon | `rigs.control` without a `-control` suffix              |
| `partition`              | Narrows which delivery rigs an item is offered to, by mission or area label                                        | none: every delivery rig                                |
| `maxOpenGates`           | Open person gates at which intake stops, when the project has no team roster                                       | 3                                                       |
| `source.adapter`         | A registered source adapter (`filesystem`, or a hosted source when its adapter declares readiness)                 | required                                                |
| `source.claimWriters`    | Writers whose claim entries the source trusts                                                                      | the bridge's own writer                                 |
| `source.evidenceWriters` | Writers whose role-pass evidence counts for any bridge decision                                                    | `source.claimWriters`; with neither, no evidence counts |
| `ready`                  | The [ready predicate](sources/index.md): `label`, `status` and `lifecycle` leaves under `all` / `any`              | the `agentflow:ready` label on an open item             |
| `entrySeat`              | The seat that receives intake rows; its phase is where fresh work starts                                           | `pm.analyst`                                            |
| `workflowSpec`           | The OpenRig workflow spec each item runs as                                                                        | the AgentFlow delivery workflow                         |
| `escalateTo`             | The session that receives person escalations                                                                       | `human@<rig>` of the rig whose queue carries the ask    |
| `worktrees`              | Slice worktrees ([below](#slice-worktrees)): `false` or `{ enabled: false }` turns them off                        | on                                                      |
| `worktrees.dir`          | Where slice worktrees live, relative to the repository root                                                        | `.worktrees`                                            |
| `worktrees.branchPrefix` | Prefix of each slice's branch                                                                                      | `work/`                                                 |
| `worktrees.integration`  | The branch whose merged state decides removal                                                                      | the remote's default branch, else `development`         |
| `worktrees.remote`       | The remote whose integration branch is fetched                                                                     | `origin`                                                |
| `worktrees.disposable`   | Ignored paths that may be deleted with a worktree (all other ignored files keep it)                                | `["node_modules"]`                                      |

"No rig configured" means `bridge` is absent, or both `rig` and `rigs.delivery` are empty.

The `bridge` key is never projected into `adapters/openrig/rig.yaml`.

## Commands

```bash
agentflow-sdlc bridge intake <ref> [--event ready|review-done|merged|closed] [--payload-file <json>] [--session <name@rig>] [--json]
agentflow-sdlc bridge start <qitemId> [--session <seat@rig>] [--resume | --force-resume <dead session>] [--json]
agentflow-sdlc bridge evidence <ref> --phase <n> --status pass|skipped --seat <id> --body-file <file> --executed-by <slug> --launcher <slug> --executor <target> --transport <t> --delegation-boundary <b> [--model <m>] [--reason <text>] [--json]
agentflow-sdlc bridge reconcile [--dry-run] [--session <name@rig>] [--json]
agentflow-sdlc bridge cleanup <ref> [--session <seat@rig>] [--json]
agentflow-sdlc bridge release <ref> [--session <name@rig>] [--person <roster id>] [--json]
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
| `cleanup`   | Removes the slice worktree of a merged item when it is safe, and releases the claim. Keeps it and tells a person otherwise ([Slice worktrees](#slice-worktrees))                                                                                      |
| `release`   | Releases the item's source claim ([Removing a rig](#removing-a-rig-and-recovering-a-claim))                                                                                                                                                           |
| `escalate`  | Asks a person through the queue                                                                                                                                                                                                                       |
| `status`    | Shows the rigs, the source, its limits, the ready predicate and whether `rig` is usable                                                                                                                                                               |

`start` reads its session from `OPENRIG_SESSION_NAME` when `--session` is not given. `evidence`
reads it from `OPENRIG_SESSION_NAME` to decide `seatVerified` and to check the reviewer.
`intake --event review-done|merged|closed`, `reconcile` and `release` need a named caller
(`--session`, else `OPENRIG_SESSION_NAME`) outside the delivery rigs; see
[Gate resolution stays outside the rig](#gate-resolution-stays-outside-the-rig). A pusher names
itself, for example `--session ci@external`. `cleanup` run on a delivery rig tells a person through
that rig's own queue.

## Trusted evidence writers

Every decision the bridge takes from role-pass evidence (the resume phase, which phases to replay,
whether review is done, whether a call is a retry, and whether a transition is legal) uses only
evidence written by a trusted evidence writer: the source-provided author of the comment or log
line, never a field inside it. Configure them with `source.evidenceWriters`; they default to
`source.claimWriters`. List the bridge's own writer, because the bridge writes evidence too.

With neither key set, no evidence could ever count and no item could get past its first phase, so
the configuration is refused: with a rig configured, every `bridge` command exits 1 with
`invalid-config` naming `adapters.openrig.bridge.source.evidenceWriters`.

## Ids

All ids come from the source reference, so the same item always maps to the same row.

| Id                 | Rule                                                                                       |
| :----------------- | :----------------------------------------------------------------------------------------- |
| Stable id          | `af-<system>-<first 8 hex of sha256(scope)>-<id>`, lowercase, at most 64 characters        |
| Slice              | `<system>-<id>`                                                                            |
| Next generation    | `<stable id>-g<n>`, used when the earlier intake row is closed and the item is ready again |
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
worktree_path=.worktrees/filesystem-item-7
```

`worktree_path` is present only when slice worktrees are on. It is the OpenRig `worktree_path=`
convention: the path, relative to the repository root, where the seats for this slice work.

## Pushed content

A pusher may send what it saw with `--payload-file`. The bridge never decides from it: it re-reads
the source and lists any pushed field that disagrees (`title`, `labels`, `state`, `lifecycle`,
`status`) in `pushedContentIgnored`.

## Events

| Event         | Requires                                                                                        | Effect                                                                           |
| :------------ | :---------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| `ready`       | The ready predicate holds                                                                       | One intake row, or `not-ready` with reasons, or `deferred`                       |
| `review-done` | A phase 6 pass after the latest phase 4 pass; with a team roster, an in-scope person's decision | Resolves rows parked on `external:review:<id>` with the evidence link            |
| `merged`      | The item's lifecycle is `merged`                                                                | Resolves rows parked on `external:merge:<id>`, then cleans up the slice worktree |
| `closed`      | The item's lifecycle is `closed`                                                                | Aborts live workflow instances and cancels live rows for the item                |

## Evidence

`bridge evidence` checks the transition against the phase graph, and checks `--executed-by` and
`--launcher` against the [runtime platforms](runtime-platforms.md), `--executor` against the
[execution targets](execution-targets.md), and `--transport` and `--delegation-boundary` against
their vocabularies. It records them as separate fields. `seatVerified` is true only when the
caller's OpenRig session holds the seat it names.

Phase 6 (review) pass evidence needs a reviewer. It is refused unless the caller's OpenRig session
is given, holds the review seat (`rev-review@<rig>` for `rev.review`) and is on the configured rig.
The phase graph already gives phase 4 only to builder seats, so a session holding the review seat
can never be the session that recorded the build.

Residual risk: the caller session is self-asserted through `OPENRIG_SESSION_NAME`, exactly like
seat claims. Anyone who can run the command with that variable set can claim the review seat; the
boundary is who can run commands on the rig's host, not the bridge.

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

4. Sweeps slice worktrees ([below](#slice-worktrees)): removes those of closed or merged items
   under the safety rule, and lists worktrees that belong to no item in the source as orphans.

After the queue is emptied, `reconcile` restores one intake row for every open ready item.

Reconcile reads the workflow list once per run. An item that fails (for example, the queue times
out) is reported under `failed`; the rest are still handled, and the run ends with status
`reconciled-with-errors` and exit 1.

### Live work

An item has live work when one of its intake rows is pending, in progress or blocked, or a workflow
instance tagged `af:<stable id>` is active or waiting. Intake rows are found two ways, on every
rig's queue:

- by listing the bridge's own live rows (`rig queue list --source <session> --state
pending,in-progress,blocked --limit 10000`; a full page is an error, never a smaller answer) and
  reading each row's intake body. The bridge creates rows under
  `agentflow-bridge@<project>-<source hash>`: the project id and the first 8 hex of a hash of the
  source's identity (adapter, scope, and a filesystem source's resolved root), so two projects on
  one daemon never share a listing even when their ids match. It also reads the sessions of earlier
  versions, `agentflow-bridge@<project>` and `agentflow-bridge@<rig>` of every configured rig, so
  rows from before an upgrade stay visible. Keep `project` unique per OpenRig daemon: rows of an
  earlier version under a shared legacy session cannot be told apart by project;
- by reading the ids the current configuration uses (each rig's offer id and the stable id, and
  their generations) one at a time with `rig queue show`. OpenRig retention may erase closed rows,
  and an erased id cannot be reused, so the scan steps past missing ids (up to 16 in a row) and a new
  row always takes the generation after the highest one found.

Escalation and notice rows carry the tag `af-notice:<stable id>` and are not work.

Cost: on every port, each `intake` and `reconcile` makes one `rig queue list` call per listed
session (the current one plus 1 + _N_ legacy sessions for _N_ configured rigs), then one
`rig queue show` per id read, per item. A listing that returns a full page of 10000 rows stops the
command with an error rather than miss a row (fail closed); `reconcile` reports it.

## Slice worktrees

With a rig configured, every slice gets its own git worktree, so two seats on two slices never
share a working directory. The setting is on by default; `worktrees: false` turns it off, and with
no rig configured nothing here runs and git is never called. The bridge may run from the primary
checkout or from inside a slice worktree: it always resolves the primary checkout. The code is
`lib/bridge/worktrees-port.mjs` over `lib/runtime/slice-worktrees.mjs`.

| Moment                             | What happens                                                                                                                                                                                                                                                                                    |
| :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intake`                           | The intake body names `worktree_path=<dir>/<slice>`. Nothing is created yet                                                                                                                                                                                                                     |
| `start`                            | After the claims and before the workflow instance exists, creates `<dir>/<slice>` on branch `<branchPrefix><slice>` from the freshly fetched `<remote>/<integration>`, or reuses it. The instance's root objective also carries `worktree_path=`. If creation fails, the row returns to pending |
| `intake --event merged`, `cleanup` | Fetches the integration branch, removes the worktree only under the safety rule, then releases the rig's claim on the item. A worktree that is already gone also releases the claim                                                                                                             |
| `reconcile`                        | Does the same for every worktree whose item is closed or merged in the source. An open item's worktree is kept. A worktree whose slice no item has is listed under `worktrees.orphans` and never removed                                                                                        |

Seats must work only inside `worktree_path` and never `cd` back to the primary checkout to edit.
OpenRig cannot move a running seat's working directory, so the path reaches the seat through the
`worktree_path=` line and the seat's startup instruction.

The safety rule. A worktree is removed (with `git worktree remove`, never `--force`, never `rm`)
only when all of these hold:

- the slice path is not a symlink; the worktree is registered, lives under the worktrees directory,
  is not locked, and is on the expected branch `<branchPrefix><slice>` (a detached HEAD is refused);
- it has no modified, staged or untracked files, and no merge, rebase, cherry-pick or revert in progress;
- it has no ignored files that removal would delete. Git ignores things such as `.agent-runs/`
  evidence and `.env`, and `git worktree remove` deletes them. Only the paths in
  `worktrees.disposable` (default `node_modules`, including a symlink of that name) may go with
  it. A name without a slash matches that directory anywhere, so a monorepo's
  `packages/*/node_modules` counts; a name with a slash (`build/cache`) matches from the worktree
  root. Everything beneath a disposable path is deleted with it, including a repository nested
  there: that is the meaning of listing it. The reasons name the blocking paths, relative to the
  worktree;
- no other registered worktree lives inside it (a nested worktree would be deleted with its
  uncommitted work);
- it has no commits ahead of its upstream, when it has one;
- its HEAD is an ancestor of `<remote>/<integration>`, or equals the merged head the source reports
  for the item (`mergedHead`, for squash merges). The source must also report the branch it merged
  into (`mergedInto`), and it must be the integration branch; a head merged into any other branch
  is ignored. See Known gaps below for what supplies it;
- the integration branch was fetched in this run. A fetch that fails means the merged state is
  unknown, and a stale ref keeps the worktree.

Inspection and removal are not one atomic step. Before removing, the worktree is locked with a
reason, inspected again under the lock (ignored files, nested worktrees, HEAD, status), and unlocked
only to be removed at once; any failure unlocks and keeps. A file git itself would refuse
(modified, untracked) cannot slip through; an ignored file written in the last instant between
unlock and removal can, and that residual window is accepted. The branch is deleted last and only if its tip is
still the inspected commit (`git update-ref -d refs/heads/<branch> <inspected commit>`). A commit made in
between keeps the branch, and the result carries a `branchNote`. Only the expected branch is ever
deleted, never whatever is checked out. The reflog and stashes are not consulted: a stash is
shared by the whole repository and is not removed with a worktree.

When removal is refused the worktree stays, the claim stays, and a person is told through the
notifier (kind `worktree-kept`) with every reason. Telling again about the same reasons is a
re-delivery, not a new row. What a person is told is scrubbed: paths are relative to the repository
root, the home directory and a Windows user profile are `~`, and remote URLs, `user:secret@host`
credentials, bare GitHub-style tokens and Authorization headers are replaced. Orphans are
listed in the reconcile report and not sent to a person.

`reconcile --dry-run` reports `worktrees.wouldRemove`, `kept` and `orphans`, marks the report
`possiblyStale: true` and changes nothing: it does not fetch, so no ref or `FETCH_HEAD` changes and
the merged state is read from the last fetch.

Git runs only when a hook needs it. Building the port and `status` run no git; the primary
checkout and the integration branch are resolved on first use. A project that is not a git
repository makes every worktree hook do nothing.

### Known gaps

- `bridge cleanup` and the `merged` event do not yet project the workflow's cleanup step
  (`rig workflow project --exit done|waiting`): the bridge does not know that step's packet. This
  arrives with the cleanup step of the workflow spec (#583).
- The startup instruction of the seats must tell them to work only inside `worktree_path` and never
  `cd` back to the primary checkout to edit. That one-line change to
  `adapters/openrig/agentflow/startup/context.md` is pending #583 and is not made here.
- Squash-merge cleanup is matched by slice. A squash commit does not contain the branch's commits,
  so the worktree is removed only when the adapter reports the head of the merged pull request
  (`mergedHead`, read through the adapter on every decision, never taken from a pushed payload)
  and it equals the worktree's HEAD. The GitHub adapter reports it only for a merged pull request.
  GitHub has no link from an issue to the pull request that closed it, so the `merged` event,
  `bridge cleanup` and reconcile must name the pull request reference, and the slice
  (`github-<number>`) must have been queued from that same reference. A slice queued from an issue
  and delivered by a differently numbered pull request finds no worktree under the pull request's
  slice, and its own worktree is kept and reported until a person removes it.

## Assumption about replaying phases

When a rebuilt item resumes past its entry phase, `start` replays each phase the source already
evidences with `rig workflow project --exit handoff --actor-session <entry session>`. This assumes
that OpenRig lets the entry session close each step for its owner (A3), and that a `handoff` exit
opens the next step in the spec's step order (A2). Neither is verified here; verify both in a live
smoke against OpenRig 0.7.6 or later.

If OpenRig refuses a replay, or the source lacks trusted evidence for a phase in between, `start`
aborts the half-replayed workflow instance, parks the intake row with
`rig queue block --on external:reconcile-replay:<stable id>`, and tells a person. If the abort
itself fails, the row is still parked and the person is told to abort the instance by hand. Fix
the cause, then run `bridge start <qitemId>` again: it claims the parked row and starts a fresh
instance. To give up, cancel the row.

### A start that fails

`start` claims the intake row first. If anything fails before a workflow instance exists (the
source cannot be read, the source claim or worktree preparation fails, instantiation fails), the
row is unclaimed and returns to pending, so the next `start` simply retries. If it fails after the
instance exists, the row is parked on `external:start-failed:<stable id>` and a person is told.
A row parked by a failed start or replay never adopts a still-live instance: `start` stays parked
until that instance is aborted.

## Extension points

The bridge takes these optional ports:

| Port            | Used for                                                                                    |
| :-------------- | :------------------------------------------------------------------------------------------ |
| `admission`     | Backpressure: returns `{ admit: false, reason }` to defer intake. Default admits everything |
| `claim`         | Claim before work; default claims through the source when it declares `claim`               |
| `worktrees`     | `pathFor` on intake, `prepare` on start, `cleanup` on merged, `sweep` on reconcile          |
| `notifier`      | Person delivery; default creates a queue row with human intent `decision`                   |
| `queues`        | One queue port per rig name; a rig without one uses `queue`                                 |
| `roster`        | The team roster; with it the review gate needs an in-scope person's source decision         |
| `gateEntries`   | Source log entries for gate decisions and markers; default the adapter's `readLogEntries`   |
| `candidateHead` | The candidate under review when the source reports no head                                  |

The CLI wires `admission` to the gate-capacity port, `roster` to the team roster read from its
protected ref ([team roster](team-roster.md); the bridge never reads the private overlay), and
`candidateHead` to `git rev-parse refs/heads/<worktrees.branchPrefix><slice>`.

## Several delivery rigs

A team with more ready work than one rig can carry adds delivery rigs to the same project. The rigs
never talk to each other: they coordinate only through the source.

```json
"bridge": {
  "rigs": { "control": "agentflow-myproj-control", "delivery": ["agentflow-myproj-d1", "agentflow-myproj-d2"] },
  "source": { "adapter": "filesystem", "claimWriters": ["agentflow-bridge", "rig-d1", "rig-d2"] },
  "partition": { "key": "mission", "map": { "578": ["agentflow-myproj-d1"] } },
  "maxOpenGates": 3
}
```

- **Rigs.** The control rig (`agentflow-<project>-control`, a product-base copy) runs the bridge
  and the product seats. Delivery rig _n_ is `agentflow-<project>-d<n>`, a delivery-base copy.
  Neither collides with a single-rig project's delivery rig `agentflow-<project>`. Project ids
  ending in `-d<n>` or `-control` are refused. Every rig's `cwd` is the one project root.
- **Offers.** `intake` and `reconcile` create one offer row per delivery rig the partition names,
  each on that rig's queue (id `<stable id>-<6 hex of sha256(rig)>`), destined for the rig's entry
  seat. With one delivery rig the row keeps the plain stable id.
- **Claim before work.** The entry seat of each rig runs `bridge start <qitemId>` on its own offer.
  `start` claims the item in the source before it creates anything. The earliest trusted claim wins;
  a losing rig closes its offer as `canceled` with resolution `claimed by <rig>` and creates no
  worktree and no workflow instance. The start session must be on a configured delivery rig, and a
  rig starts only rows offered to it. A second start of the same item on the same rig (from another
  row) is not a win: holding the claim already, it closes its row as `superseded` and tells a
  person. Each start claims its row in the queue before it looks for another running start, so of
  two concurrent starts at most one proceeds; when both see each other both stand down, and the
  person told pushes the item again.
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

### Upgrading a single-rig project

A project with one delivery rig `agentflow-<project>` (bridge `rig: agentflow-<project>`) keeps it:

1. Provision the control rig (`--kind control`) and the replicas you want (`--replica 1`, …).
2. Set `rigs: { control: "agentflow-<project>-control", delivery: ["agentflow-<project>", "agentflow-<project>-d1"] }`
   and drop the `rig` key. The existing rig is now one delivery rig. The project id stays
   `agentflow-<project>` (the control rig's name without `-control`), so the bridge's queue session
   is unchanged and its rows stay visible to intake, cancellation, stray settling and gate markers;
   nothing is queued twice. Set `project` to the old id if the control rig is named otherwise, or
   when you rename it.
3. To retire `agentflow-<project>` later, remove it from `rigs.delivery` once it has finished its
   claimed work (see below).

### Removing a rig, and recovering a claim

Removing a delivery rig from `rigs.delivery` hides none of its live rows, and no other rig starts an
offer made to it. Its claims stay in the source until released:

- The bridge releases an item's claim when the item is closed, when it is merged (once its slice
  worktree is gone, when worktrees are on), when a start parks its row on a refused replay or the
  return-cycle limit, and when a start fails before it creates a workflow instance (the row goes back
  to pending), so another rig may take the item.
- For a rig removed while it held a claim, a person first aborts its workflow and cancels its live
  rows (`rig queue update <id> --state done --closure-reason canceled`), then runs
  `agentflow-sdlc bridge release <ref> --session <name@control rig>` and pushes the item again.
  `release` refuses while a workflow instance or an in-progress row exists for the item. A claim
  held by a rig still in `rigs.delivery` is released only for a roster person: `--person <roster id>`.
  Every release is recorded in the source first, as a comment
  `<!-- agentflow-claim-release:{"v":1,"holder":…,"session":…,"person":…,"at":…} -->`. The session
  and the person are self-asserted: the record says who asked, not that they may. A release is
  authorised by a person only when a source decision by that person backs it.
- A start's lease on its row is the queue's own claim time (`claimedAt`, which OpenRig sets
  atomically on `rig queue claim` and returns from `rig queue show --json`). If a start process
  died after it claimed the row and the item but before the workflow instance, the row stays in
  progress. Once the claim is older than 15 minutes, the entry seat of the same rig runs
  `bridge start <qitemId> --resume`; it refuses while the claim is fresher, because a start may
  still be running. When the queue does not report the claim time, `--resume` refuses (fail
  closed); a person who knows the start is gone runs `--force-resume <its session>`, which must name
  a session on the same rig and is noted on the row. Two resumes that both pass these checks race on
  the queue's atomic claim, so only one proceeds; that race is not a lease and does not stop a
  resume of a start that is still running. `--resume` also refuses when an instance or another start
  of the item exists.

### Backpressure

More rigs help only while people keep up with review. Before it queues new work, the bridge counts
the open person gates on the source (the sum of `openGates` over open items). When that count
reaches capacity, `intake` reports `status: deferred, reason: gate-capacity, openGates, capacity`
and `reconcile` lists the item under `deferred`; nothing is queued. After a gate closes, the next
push or `reconcile` queues it.

The gates are recorded in the source by the bridge. Each park of a row on a review, merge, replay or
failed-start gate gets a comment `<!-- agentflow-gate:waiting:<gate>@<qitem id>~<n> -->`, where
`<n>` counts that row's parks, so a row that parks again after a resolve is a new gate. Resolving
the gate, or the row no longer waiting, adds the matching `closed` line. `intake` and `reconcile`
bring these markers up to date before they count, so a workflow parked at review counts as soon as
the next push or reconcile runs. Only markers written by trusted writers (the evidence writers and
the bridge's own writer) count, in the bridge and in the source's `openGates`; anyone else's marker
is ignored. A source adapter reports `openGates` from these markers (the filesystem source does).
Intake is held when the source cannot write comments (`reason: gate-markers-unwritable`) or cannot
list its log entries (`reason: gate-log-unreadable`).

One `reconcile` pass counts the items it has already admitted against capacity, so it does not
overshoot. Concurrent `intake` calls can: each counts before the others queue, so with _k_ pushes at
once the queue may exceed capacity by up to _k_ − 1 items. An item queued but not yet at a gate is
not counted.

Capacity is the sum of `capacity` over the [team roster](team-roster.md) people (3 each by default).
Without a roster it is `maxOpenGates` (default 3, one person). Start with one delivery rig per
active reviewing person. **These numbers are not measured.** Record gate wait time and the open-gate
count from the source and revise them.

### When the control rig stops

Delivery-side commands (`start`, `evidence`, `cleanup`) use only their own rig's queue and the source, never
the control rig. If the control rig stops, delivery rigs finish the work they have claimed, no new
offers arrive, and they idle. Escalations from a delivery rig go to `human@<that rig>` unless
`escalateTo` is set.

The CLI talks to the local OpenRig daemon, so the control rig and its delivery rigs share one
daemon. Rigs on other hosts are not reached by one bridge; that is not verified against OpenRig.

### Gate resolution stays outside the rig

Workers cannot approve their own work. `intake --event review-done|merged|closed`, `reconcile` and
`release` refuse:

- a call with no named caller (`--session`, else `OPENRIG_SESSION_NAME`);
- any session on a delivery rig other than the control rig, whatever its name (`human@<delivery
rig>`, `agentflow-bridge@<delivery rig>`, a seat);
- a seat session on the delivery or eval plane (`manifests/seats.json`) on any rig.

**Sessions are self-asserted.** This check stops a worker that follows its instructions, not one
that lies about its session. With a team roster, the real control is the person's decision recorded
in the source (below). Without a roster, `review-done` relies on the phase 6 evidence whose
reviewer session is itself self-declared: that is a residual risk, accepted for single-person
projects.

With a team roster, `review-done` also needs a person's decision recorded in the source: a comment
whose first line is
`<!-- agentflow-gate-decision:{"v":1,"gate":"<ref>:review:<digest>","decision":"agree"} -->`,
written by a roster person in scope for `acceptance-review` at the item's tier (both reviews for
high-assurance). The gate id binds what is under review: `<digest>` is the SHA-256 (64 hex) over
the candidate head and the trusted transitions up to the latest phase 6 pass. The candidate head is
the one the source reports for the item (a declared candidate head, the pull request head, or the
merge head); only when the source reports none is it the slice branch head, which a seat can move.
`gate.candidateFrom` says which (`source` or `branch`). `review-done` reports the current id under `gate.gateId` while it
waits. A commit pushed after the agreement, or a new build and review round, changes the digest, so
an agreement for an older one is `stale-gate` and does not count. When the candidate head is unknown
no roster gate opens (`candidate-head-unknown`). The bridge reads the decision with
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
