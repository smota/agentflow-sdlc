# OpenRig execution layer

The execution layer runs AgentFlow delivery on an [OpenRig](../OPENRIG.md) rig. It is optional. A
team without a rig loses nothing: every AgentFlow rule, gate and piece of evidence works with one
coding CLI and no daemon. This page says what the layer is, what each level of adoption needs and
gives, how to stand up one rig, and what is not supported. The decisions behind it are in
[ADR 016](adr/016-optional-openrig-execution-layer.md).

## What the layer does

- **The source is the truth; the rig queue is a projection.** Queue rows carry a reference and
  derived ids, never the content of an issue or pull request. If a rig is lost, nothing is lost:
  `bridge reconcile` rebuilds the queue from the source.
- **A push, not a poll.** Something outside the rig tells the [bridge](openrig-bridge.md) "look at
  `github:owner/repo#12`". The bridge re-reads the item through the
  [source adapter contract](sources/index.md) and ignores any content that was pushed.
- **One claim per item.** A rig claims an item in the source before it works on it
  ([claims](sources/index.md#claim), [GitHub claims](sources/github.md#claims-581)), so two rigs
  never take the same item.
- **One worktree per slice.** `bridge start` creates the slice's git worktree and
  [removes it after merge](openrig-bridge.md#slice-worktrees) only when nothing would be lost.
- **Evidence goes back to the source.** Each phase's role-pass is written to the source with
  `bridge evidence`.
- **Steering stays outside the rig.** A seat cannot approve its own work: the review step needs a
  different session from the build, and gates are resolved only by the bridge running outside the
  rig.

## Adoption levels

Each level adds to the one before it. Stop at any level; nothing below it needs the levels above.

| Level      | What it needs                                                                                            | What it gives                                                                                                     |
| :--------- | :------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `none`     | AgentFlow and one coding CLI. No rig, no `bridge` configuration                                          | The full workflow, gates and evidence by hand or with a single agent. `bridge` commands do nothing and exit 0     |
| `seats`    | OpenRig 0.7.6 or later, `agentflow-sdlc adapters install openrig`, a provisioned squad                   | A delivery squad with named seats. Work is handed to it by a person or by `agentflow-sdlc handoff deliver`        |
| `workflow` | `seats`, plus the AgentFlow delivery workflow spec and the seat table (concept and issues named below)   | Each phase is a workflow step; phase handover is a queue handoff, and waits on a person or a PR are blocked steps |
| `full`     | `workflow`, plus `adapters.openrig.bridge` in the config, trusted writers, and a way to push a reference | Ready work reaches the rig after one push; slices get worktrees; evidence returns to the source; one-claim rule   |

A team with no rig is at `none` and is a complete, supported configuration. Adopting a higher
level never changes the lower ones: turning the bridge off (removing `adapters.openrig.bridge`)
returns the project to `seats` with its state intact, because the source held it all along.

Two things at the `workflow` level live in separate work and are named here by concept and issue
only:

- **The seat table (#579).** One canonical list of every seat with its pod, role, phases and write
  rule. Path ownership, rig specifications and policy are checked against it.
- **The delivery workflow spec (#583).** The AgentFlow phases as an OpenRig workflow spec, with
  `validate-openrig-workflow --rig` to check it against a live daemon (needs OpenRig 0.7.6 or later
  and cannot run in hosted CI).

Many people and many delivery rigs on one project are the team roster (#585) and multi-rig delivery
(#586). They are not needed for one rig and one person. A roster for a high-assurance project is
still waiting for human review on #585.

## Stand up a single rig

This walks one project, one person, one rig, with the filesystem source (no GitHub needed). To use
GitHub instead, change the `source` as shown in step 3.

1. **Prerequisites.** OpenRig 0.7.6 or later (`rig --version`), a git repository with an
   integration branch (`development` by default), and AgentFlow adopted
   ([Get started](get-started.md)).
2. **Provision the rig.**

   ```bash
   agentflow-sdlc adapters install openrig /path/to/project
   agentflow-sdlc adapters squads provision openrig --kind delivery myproj /path/to/project
   rig up agentflow-myproj --cwd /path/to/project
   ```

   Use `--kind unified` for one rig that holds the product, delivery and review pods
   ([OpenRig](../OPENRIG.md#unified-multi-pod-rig-mode---kind-unified)).

3. **Configure the bridge** in `agent-workflow.config.json`. Without a `rig`, the bridge stays off.

   ```json
   {
     "adapters": {
       "openrig": {
         "bridge": {
           "rig": "agentflow-myproj",
           "source": {
             "adapter": "filesystem",
             "root": ".agentflow/source",
             "writer": "agentflow-bridge",
             "claimWriters": ["agentflow-bridge"],
             "evidenceWriters": ["agentflow-bridge"]
           },
           "ready": {
             "all": [
               { "kind": "label", "has": "agentflow:ready" },
               { "kind": "lifecycle", "state": "open" }
             ]
           }
         }
       }
     }
   }
   ```

   For GitHub use `"source": { "adapter": "github", "repo": "owner/repo", "claimWriters":
["<bot-login>"], "evidenceWriters": ["<bot-login>"], "mirrorAssignee": "<bot-login>" }`. The
   bridge reads the credential the host already holds (`GITHUB_TOKEN`, `GH_TOKEN`, or a logged-in
   `gh`); AgentFlow stores none.

4. **Set the evidence writers.** Every decision the bridge takes from role-pass evidence counts only
   evidence written by a trusted writer. With neither `claimWriters` nor `evidenceWriters`, every
   command exits 1 with `invalid-config`
   ([Trusted evidence writers](openrig-bridge.md#trusted-evidence-writers)). On GitHub, use one
   dedicated bot login per project that nothing else uses: any other writer on that login could
   post a claim-shaped comment. The claim entry names the rig, so one bot serves every rig of the
   project.

5. **Check the setup.**

   ```bash
   agentflow-sdlc bridge status --target /path/to/project
   ```

   It shows the rig, the source, its limits, the ready predicate and whether `rig` is usable.

6. **First intake.** Mark an item ready, then push its reference:

   ```bash
   agentflow-sdlc bridge intake filesystem:local#item-7 --target /path/to/project
   ```

   The bridge re-reads the item; if it is ready it creates one intake row for the entry seat
   (`pm.analyst` by default). The entry seat then runs `bridge start <qitemId>`, which claims the
   item, creates `.worktrees/<slice>` and starts the workflow. Pushing the same item again reports
   `already-queued`. On GitHub the reference is `github:owner/repo#12`. See
   [push a reference](#push-a-reference) for ways to send it automatically.

7. **Reconcile.** After a lost push, a restart or a rig rebuild:

   ```bash
   agentflow-sdlc bridge reconcile --dry-run --target /path/to/project   # look first
   agentflow-sdlc bridge reconcile --target /path/to/project
   ```

   It restores one intake row for every open, ready item that has no live work, and cleans up
   closed or merged items. Run it on the rig host on a schedule if you have no pusher.

8. **Cleanup.** After a merge, the pusher sends `--event merged` (on GitHub with the pull request
   reference, because a squash merge is matched by the pull request's head), or run
   `bridge cleanup <ref>`. The worktree is removed only if it has no uncommitted, untracked or
   unpushed work and its head is merged into the integration branch; otherwise it stays and a
   person is told. To turn the layer off, remove `adapters.openrig.bridge`.

### Person-run checks

These need a live OpenRig daemon, so a person runs them once per rig; agents and hosted CI cannot.

- `validate-openrig-workflow --rig <rig>` (from #583) on OpenRig 0.7.6 or later, once the
  workflow spec (#583) is installed.
- A live replay smoke: rebuild an item that already has evidence past phase 1 and confirm
  `bridge start` replays the earlier phases. The bridge assumes OpenRig lets the entry session close
  each step for its owner and opens the next step in order; neither is verified without a live
  daemon ([replay assumption](openrig-bridge.md#assumption-about-replaying-phases)). Do not point
  such a smoke at a rig you depend on.

## Push a reference

The bridge has no polling loop. Something sends a reference and an event kind, and nothing else.

**A hosted CI job cannot reach a rig on a private machine.** A GitHub-hosted runner has no network
path to your workstation or server, so a plain `ubuntu-latest` job cannot call `bridge`. Pick one:

| Option                             | How                                                                                                                 |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| Self-hosted runner on the rig host | Install a GitHub Actions runner on the rig's machine and use the reference pusher below                             |
| A relay or webhook you run         | A small service you operate receives the event and runs `bridge intake <ref>` on the rig host                       |
| Manual push                        | A person runs the command below when work becomes ready                                                             |
| Scheduled `reconcile` on the host  | Run `agentflow-sdlc bridge reconcile` from cron or a systemd timer on the rig host; no pusher at all, at some delay |

### The reference pusher

[`adapters/openrig/examples/github-rig-push.yml`](../adapters/openrig/examples/github-rig-push.yml)
is a GitHub Actions job for a self-hosted runner. Copy it to `.github/workflows/`, label the runner
`rig-host`, and set the repository variable `AGENTFLOW_TARGET` to the project path on that machine. That `--target` is the local path of the project on the rig host, not source content.
It sends only `github:<owner>/<repo>#<number>` and the event kind: `ready` when an issue is
labeled, `closed` when an issue or pull request is closed and `merged` when a pull request is
merged. `review-done` is not pushed by this job: push it by hand or from a relay you run.

**Warning: never run this on a self-hosted runner for a repository that accepts fork pull requests
unless workflows from outside collaborators require approval.** A runner on the rig host runs what
a workflow says. The job uses `pull_request_target` (the workflow comes from the base branch, so a
fork cannot change it), has `permissions: {}` and no checkout, so it runs no pull request code. Do
not add `pull_request` or `pull_request_review` triggers or a checkout step; the test fails if you
do. It never sends the title, body, labels or comments,
uses no secrets and asks GitHub for no token permission; the bridge reads GitHub with the
credential on the rig host. A test (`adapters/openrig/__tests__/reference-pusher.test.mjs`) keeps
it that way.

### The manual command

```bash
agentflow-sdlc bridge intake github:owner/repo#12 --event ready --target /path/to/project
```

`--event` is one of `ready` (default), `review-done`, `merged` or `closed`. The bridge decides from
the source, not from the event name: a `merged` push for an item that is not merged does nothing.

## Not supported

- **Pi seats inside a rig.** The pi-cli provider was removed ([ADR 015](adr/015-remove-pi-cli-provider.md)),
  and a rig built for the bridge uses Claude Code and Codex seats only. Some shipped presets still
  name a `pi` runtime for a seat; do not use those seats with the bridge (a follow-up aligns the
  presets).
- **Long-running non-Claude seats.** Context continuity across compaction and restart is documented
  only for Claude seats.
- **Any change to OpenRig.** The layer works with OpenRig as released. Anything OpenRig does not do
  (per-seat working directories, idempotent `workflow instantiate`, per-loop rework guards) is done
  by AgentFlow instructions and checks.
- **Source adapters other than GitHub and filesystem.** Others can be added through the
  [source adapter contract](sources/index.md); none ship.
- **Rig-level identity.** The session that records evidence is self-asserted through
  `OPENRIG_SESSION_NAME`; the boundary is who can run commands on the rig host
  ([Evidence](openrig-bridge.md#evidence)).

## Limits to know

- One bridge reaches only the daemon on its own host.
- On GitHub, a claim rests on a dedicated bot login; anyone with write access to the repository
  can edit or delete comments, so restrict write access to people trusted with the claim
  ([GitHub claims](sources/github.md#claims-581)).
- A worktree is never removed with uncommitted, untracked, unpushed or unmerged work.
- Rig counts per reviewing person are unmeasured; the default is one delivery rig per active
  reviewer and three open gates per person.
