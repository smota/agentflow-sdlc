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
| `source.adapter`         | A registered source adapter (`filesystem`, or a hosted source when its adapter declares readiness)    | required                                                |
| `source.claimWriters`    | Writers whose claim entries the source trusts                                                         | the bridge's own writer                                 |
| `source.evidenceWriters` | Writers whose role-pass evidence counts for any bridge decision                                       | `source.claimWriters`; with neither, no evidence counts |
| `ready`                  | The [ready predicate](sources/index.md): `label`, `status` and `lifecycle` leaves under `all` / `any` | the `agentflow:ready` label on an open item             |
| `entrySeat`              | The seat that receives intake rows; its phase is where fresh work starts                              | `pm.analyst`                                            |
| `workflowSpec`           | The OpenRig workflow spec each item runs as                                                           | the AgentFlow delivery workflow                         |
| `escalateTo`             | The session that receives person escalations                                                          | `human@<rig>`                                           |

"No rig configured" means `bridge` is absent, or both `rig` and `rigs.delivery` are empty. One
delivery rig is supported; several delivery rigs on one project arrive with multi-rig delivery.

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
```

## Pushed content

A pusher may send what it saw with `--payload-file`. The bridge never decides from it: it re-reads
the source and lists any pushed field that disagrees (`title`, `labels`, `state`, `lifecycle`,
`status`) in `pushedContentIgnored`.

## Events

| Event         | Requires                                              | Effect                                                                |
| :------------ | :---------------------------------------------------- | :-------------------------------------------------------------------- |
| `ready`       | The ready predicate holds                             | One intake row, or `not-ready` with reasons, or `deferred`            |
| `review-done` | A phase 6 pass recorded after the latest phase 4 pass | Resolves rows parked on `external:review:<id>` with the evidence link |
| `merged`      | The item's lifecycle is `merged`                      | Resolves rows parked on `external:merge:<id>`                         |
| `closed`      | The item's lifecycle is `closed`                      | Aborts live workflow instances and cancels live rows for the item     |

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
| `worktrees` | `prepare` on start, `cleanup` on merged, `sweep` on reconcile                               |
| `notifier`  | Person delivery; default creates a queue row with human intent `decision`                   |
