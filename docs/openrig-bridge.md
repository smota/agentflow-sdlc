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

| Key                      | Meaning                                                                                               | Default                                                 |
| :----------------------- | :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| `rig`                    | The delivery rig. Shorthand for `rigs: { control: rig, delivery: [rig] }`                             | none: no rig means the bridge is off                    |
| `source.adapter`         | A registered source adapter (`filesystem`, or a hosted source when its adapter declares readiness)    | required                                                |
| `source.claimWriters`    | Writers whose claim entries the source trusts                                                         | the bridge's own writer                                 |
| `source.evidenceWriters` | Writers whose role-pass evidence counts for any bridge decision                                       | `source.claimWriters`; with neither, no evidence counts |
| `ready`                  | The [ready predicate](sources/index.md): `label`, `status` and `lifecycle` leaves under `all` / `any` | the `agentflow:ready` label on an open item             |
| `entrySeat`              | The seat that receives intake rows; its phase is where fresh work starts                              | `pm.analyst`                                            |
| `workflowSpec`           | The OpenRig workflow spec each item runs as                                                           | the AgentFlow delivery workflow                         |
| `escalateTo`             | The session that receives person escalations                                                          | `human@<rig>`                                           |
| `worktrees`              | Slice worktrees ([below](#slice-worktrees)): `false` or `{ enabled: false }` turns them off           | on                                                      |
| `worktrees.dir`          | Where slice worktrees live, relative to the repository root                                           | `.worktrees`                                            |
| `worktrees.branchPrefix` | Prefix of each slice's branch                                                                         | `work/`                                                 |
| `worktrees.integration`  | The branch whose merged state decides removal                                                         | the remote's default branch, else `development`         |
| `worktrees.remote`       | The remote whose integration branch is fetched                                                        | `origin`                                                |
| `worktrees.disposable`   | Ignored paths that may be deleted with a worktree (all other ignored files keep it)                   | `["node_modules"]`                                      |

"No rig configured" means `bridge` is absent, or both `rig` and `rigs.delivery` are empty. One
delivery rig is supported; several delivery rigs on one project arrive with multi-rig delivery.

The `bridge` key is never projected into `adapters/openrig/rig.yaml`.

## Commands

```bash
agentflow-sdlc bridge intake <ref> [--event ready|review-done|merged|closed] [--payload-file <json>] [--json]
agentflow-sdlc bridge start <qitemId> [--session <seat@rig>] [--json]
agentflow-sdlc bridge evidence <ref> --phase <n> --status pass|skipped --seat <id> --body-file <file> --executed-by <slug> --launcher <slug> --executor <target> --transport <t> --delegation-boundary <b> [--model <m>] [--reason <text>] [--json]
agentflow-sdlc bridge reconcile [--dry-run] [--json]
agentflow-sdlc bridge cleanup <ref> [--json]
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
| `escalate`  | Asks a person through the queue                                                                                                                                                                                                                       |
| `status`    | Shows the rigs, the source, its limits, the ready predicate and whether `rig` is usable                                                                                                                                                               |

`start` reads its session from `OPENRIG_SESSION_NAME` when `--session` is not given. `evidence`
reads it from `OPENRIG_SESSION_NAME` to decide `seatVerified` and to check the reviewer.

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

| Event         | Requires                                              | Effect                                                                           |
| :------------ | :---------------------------------------------------- | :------------------------------------------------------------------------------- |
| `ready`       | The ready predicate holds                             | One intake row, or `not-ready` with reasons, or `deferred`                       |
| `review-done` | A phase 6 pass recorded after the latest phase 4 pass | Resolves rows parked on `external:review:<id>` with the evidence link            |
| `merged`      | The item's lifecycle is `merged`                      | Resolves rows parked on `external:merge:<id>`, then cleans up the slice worktree |
| `closed`      | The item's lifecycle is `closed`                      | Aborts live workflow instances and cancels live rows for the item                |

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

An item has live work when a row of its intake chain is pending, in progress or blocked, or a
workflow instance tagged `af:<stable id>` is active or waiting. The intake chain is the stable id
and its generation ids, read one at a time with `rig queue show`. OpenRig retention may erase
closed rows, and an erased id cannot be reused, so the scan steps past missing ids (up to 16 in a
row) and a new row always takes the generation after the highest one found; liveness never comes from
`rig queue list`, whose output is bounded (100 rows by default, newest first). Escalation and
notice rows carry the tag `af-notice:<stable id>` and are not work.

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

| Port        | Used for                                                                                    |
| :---------- | :------------------------------------------------------------------------------------------ |
| `admission` | Backpressure: returns `{ admit: false, reason }` to defer intake. Default admits everything |
| `claim`     | Claim before work; default claims through the source when it declares `claim`               |
| `worktrees` | `pathFor` on intake, `prepare` on start, `cleanup` on merged, `sweep` on reconcile          |
| `notifier`  | Person delivery; default creates a queue row with human intent `decision`                   |
