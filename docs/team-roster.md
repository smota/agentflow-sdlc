# Team roster

A team roster sends each gate to the person responsible for it and decides who may answer it. It
is optional. With no committed roster file, every gate keeps the single-person path: the OpenRig
human gateway default (`rig gateway participants --json`) and the existing person gate answers.

The roster stays in AgentFlow. OpenRig is only the delivery pipe: AgentFlow picks the person, and
the OpenRig queue carries the gate to that person's channel.

## Files

| File                                                                          | Committed | Holds                                                     |
| ----------------------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| `.agentflow/team-roster.json`                                                 | yes       | People, source handles, scopes, backup, timeout, capacity |
| `${XDG_CONFIG_HOME:-~/.config}/agentflow/<project-id>/team-roster.local.json` | never     | Private channel addresses, by roster person id            |

**The roster is read from a protected ref**, never from the working tree or a worktree's `HEAD`:
`git --git-dir=<shared git directory> show <ref>:.agentflow/team-roster.json`. The ref is
`origin/<integration branch>`, or `refs/heads/<integration branch>` when there is no such remote
branch; the integration branch is `branching.integration` (default `development`). `--ref <ref>`
names another ref. A ref that does not resolve is refused, never read as "no roster". The shared
git directory is the one every worktree reads, including a bare repository with worktrees, so an
uncommitted edit or a commit on a seat's own branch changes nothing. `roster validate` names the ref
and commit it read and says when the working tree differs. AgentFlow refuses a committed symlink at
the roster path and any case variant of it (for example `.AgentFlow/team-roster.json`).

**No rig seat may write the roster or the schemas** (`schemas/team-roster.schema.json`,
`schemas/team-roster-overlay.schema.json`). They are in the `governance-files-guard` deny list of
`manifests/path-ownership.json`. The guard matches paths made relative to the repository root,
Unicode case-folded, with trailing dots and spaces dropped from each folder and file name, and an
absolute path outside the root that ends in a protected path. So `validate:paths` rejects any
seat's commit that changes them or a spelling variant of them. A person edits the roster.

**The overlay lives outside the repository**, in the person's configuration directory. The
`<project-id>` is the main worktree's folder name (or the bare repository's) plus the first 8 hex characters of the SHA-256
of its real path. Only the person's own process may point elsewhere, with
`AGENTFLOW_TEAM_ROSTER_OVERLAY=<file>` or `--overlay <file>`. No seat environment should be able to
read that directory or carry that variable. The old in-repo name `.agentflow/team-roster.local.json`
is never read. It stays in `.gitignore` and in the git excludes the OpenRig adapter writes, and
`roster validate` fails when it is tracked or not ignored.

## The roster

```json
{
  "version": 1,
  "highAssurance": { "distinctReviewers": true },
  "people": [
    {
      "id": "sam",
      "handles": { "github": "sam-login" },
      "scopes": [
        {
          "gates": ["security-review", "acceptance-review", "release-of-candidate"],
          "paths": ["lib/**", "scripts/**"],
          "tiers": ["standard", "high-assurance"]
        }
      ],
      "backup": "ana",
      "timeoutMinutes": 240,
      "capacity": 3
    },
    {
      "id": "ana",
      "handles": { "github": "ana-login" },
      "scopes": [
        { "gates": ["acceptance-review", "merge"], "tiers": ["standard", "high-assurance"] }
      ]
    }
  ]
}
```

- `id`: the roster id. Logs, evidence, CLI output and queue bodies name people by this id only.
- `handles`: the person's login per source system (ASCII letters, digits, `.`, `_`, `-`). A handle
  identifies who wrote a source entry. It is not an address and grants nothing by itself.
- `scopes`: what the person may answer. `gates` are gate types: `adequacy-of-intent`,
  `release-of-candidate`, `agent-escalation`, `security-review`, `acceptance-review`, `merge`.
  `tiers` are change classes: `bounded`, `standard`, `high-assurance`. `paths` are repository
  globs (`*` within a folder, `**` across folders); without `paths` the scope covers every path.
- `backup`: who gets the gate after the timeout. Defaults to the next person in scope.
- `timeoutMinutes`: how long the gate waits before it goes to the backup (default 240).
- `capacity`: how many open gates the person takes before routing skips them (default 3).
- `highAssurance.distinctReviewers`: when `true`, one person cannot give both high-assurance
  reviews.
- `highAssurance.allowSelfDeclaredWriters`: when `true`, a `filesystem` handle may answer a
  high-assurance gate. Default `false`, because a filesystem writer is declared by whoever writes
  the log.

The roster has no channel field. The validator rejects any value shaped like an e-mail address or
an OpenRig `@external` address, two people with the same handle, a missing backup, and a handle
that is one of the bridge's own writers (claim writers, evidence writers, the assignee mirror).

## The overlay

```json
{ "version": 1, "channels": { "sam": { "openrig": "<entity>@external" } } }
```

Each key is a roster id. The value is the person's OpenRig human gateway address. The overlay is
validated (schema and roster ids) when it is loaded and again before every delivery; an invalid
overlay delivers nothing. Its keys and values are never written to an issue, a source entry, a
queue body or summary, a log, or CLI output. Validation errors name roster ids and fields only; a
key that is not a roster id is counted, never printed.

## Routing

A person is in scope for a gate when one of their scopes names the gate type and the tier, and
every path of the gate matches a path glob of such a scope. A scope without `paths` covers any
gate. A gate without paths is covered only by a scope without `paths`.

The router picks the first person in roster order who is in scope and below capacity. The gate is
delivered to that person. When no decision is recorded in the source by `timeoutMinutes`, it is
delivered to the backup. The backup is the declared `backup` when that person is in scope,
otherwise the next person in scope. Each delivery is one queue row per gate and person, parked with
`--wake-after`, so the timeout is an OpenRig timer and AgentFlow does not poll.

## Who may answer a gate

A gate id binds the subject it asks about: `<source ref>:<gate name>:<digest>`, where the digest is
the current evidence or candidate digest: 64 lowercase hex characters for a high-assurance gate,
32 to 64 otherwise, for example `github:org/repo#12:release:3f9a…`. A new round of changes has a new
digest, so an agreement given in round 1 is `stale-gate` in round 2. A refusal or a withdrawal
given in round 1 carries forward (see below). A gate without a valid digest admits nothing
(`gate-unbound`). The caller computes the digest from the source itself, never from a pushed value
or a comment.

A decision is a comment in the source whose first line is the decision marker:

```text
<!-- agentflow-gate-decision:{"v":1,"gate":"<gate id>","decision":"agree"} -->
```

`decision` is `agree`, `changes-requested`, `blocked`, or `withdrawn`. A high-assurance gate also
names the review: `"review":"security-review"` or `"review":"acceptance-review"`. The marker has no
person field. A marker with any other field is not a decision. A trailing carriage return (CRLF) is
accepted.

The writer of the decision is the source's own record of who wrote the entry, such as the comment
author. The source adapter's `resolve-humans` capability turns the writer into a handle, the handle
must match the ASCII handle pattern, and it finds the roster person. A decision counts only when:

- the entry has not been edited. The adapter supplies `edited`, or `createdAt` and `updatedAt`. An
  edited agreement or withdrawal is `edited-entry`. On a high-assurance gate an entry without edit
  state is `edit-state-unknown`. An edited or unknown-state refusal still counts as a refusal,
  because blocking is the safe direction;
- the gate id carries the current digest;
- the writer is a roster person, in scope for the gate (for a high-assurance review, in scope for
  that review);
- the writer is not the bridge, the source adapter's writer, or a configured bridge writer;
- for a high-assurance gate, the handle is not a `filesystem` handle, unless the roster opts in.

Anything else is recorded and opens no gate, with a reason: `writer-not-on-roster`, `out-of-scope`,
`bot-writer`, `invalid-handle`, `self-declared-writer`, `resolve-humans-absent`, `invalid-roster`,
`no-roster`, `edited-entry`, `edit-state-unknown`, `stale-gate`, `gate-unbound`, `other-gate`,
`not-a-decision`. A decision given in chat or on a queue row is not a source entry and counts for
nothing until the person records it in the source.

**A refusal stands.** Each person's latest decision is what they stand on. A `changes-requested`
or `blocked` from any in-scope person holds the gate (or the high-assurance review) until that same
person agrees on the current digest or posts `withdrawn`. Another person's agreement does not
override it, and neither does a new digest: a refusal given for an earlier digest of the same gate
(same source ref and gate name) carries forward. _This rule is a decision for the person to
confirm._

A high-assurance gate records `security-review` and `acceptance-review` separately. It opens only
when both reviews have an agreement from a person in scope and no standing refusal. One person may
give both reviews, unless `highAssurance.distinctReviewers` is `true`.

The filesystem source reports its comment entries with `readLogEntries(reference)`, each with
`edited: false` and equal `createdAt` and `updatedAt`, because its log is append-only through the
adapter.

## Structural limits

These limits come from where seats run, not from this code. Review them before relying on the
roster for high-assurance work.

- **Same-user seats.** Rig seats run as the person's operating-system user with the project as
  their working directory. Such a seat can write the person's configuration directory (the overlay),
  set `AGENTFLOW_TEAM_ROSTER_OVERLAY` in its own environment, rewrite local git refs (including
  `refs/heads/<integration branch>` and `refs/remotes/origin/…`), edit the working-tree
  `agent-workflow.config.json` that names the integration branch, and append entries with any
  writer name to a filesystem source. The protections here stop a seat's commits and working-tree
  edits from taking effect; they do not stop a process that deliberately rewrites the person's
  files or refs. Run seats as a separate user, or fetch the protected ref from a remote the seat
  cannot push to, when that matters.
- **Self-declared writers.** A filesystem source writer is whatever the writing process says it
  is. That is why `filesystem` handles cannot answer high-assurance gates unless the roster opts in.
- **Identity is the source account.** A seat must never hold a person's source credentials: a
  comment written with a person's account counts as that person.
- **The digest is the caller's.** The gate id binds whatever digest the caller passes. The caller
  (the bridge, #586) must compute it from the source independently; a wrong digest makes an old
  agreement count for new changes.
- **Decision markers are invisible.** The marker is an HTML comment, so a rendered issue or pull
  request page does not show it. A person reading the page sees only the text around it; check the
  raw comment when a decision matters.
- **Deletions are not detected.** An edit is detected, a deletion is not. An account with write
  access can delete a later `changes-requested` comment so that an earlier agreement of the same
  person counts again. Keep write access to the source narrow; the source's audit log shows
  deletions.

## Commands

```bash
agentflow-sdlc roster validate [--ref <ref>] [--overlay <file>] [--json]
agentflow-sdlc roster route --gate <type> [--paths a,b] [--tier <tier>] [--ref <ref>] [--json]
node scripts/validate-team-roster.mjs [--ref <ref>] [--overlay <file>] [--json]
```

`roster validate` checks the committed roster, the overlay, and that the old in-repo overlay name
cannot be committed. `roster route` explains who a gate goes to and why, by roster id; it does not
read the overlay. Neither command delivers or resolves a gate. With no roster both print
`No team roster (.agentflow/team-roster.json); gates use the single-person path.` and exit 0.

The library is `lib/roster/`: `team-roster.mjs` (load, validate, handle lookup), `gate-router.mjs`
(`routeGate`, `nextRecipient`, `deliverGate`, `createQueueNotifier`) and `authority.mjs`
(`authorizeWriter`, `admitGateDecision`, `gateDecisionState`, `highAssuranceGateState`,
`formatGateId`).

## Where this differs from the design

These choices differ from the solution design for #585 and are recorded here for review:

- **Every path, not any path.** A scope covers a gate only when it covers every gate path. Matching
  any one path would let a person scoped to one folder approve changes to another.
- **Notifier location.** The OpenRig notifier is `createQueueNotifier` in `lib/roster/gate-router.mjs`,
  not in `scripts/roster.mjs`, so the bridge can import it without importing a script.
- **No `human:<login>` fallback.** With no roster, the roster functions admit nothing
  (`no-roster`) and the existing single-person path decides, unchanged. Writers are not treated as
  `human:<login>` identities.
- **Bridge wiring is in #586.** This change provides the router, the authority check and the
  notifier. Calling them from the bridge, reading decision entries with their edit state through
  the source adapter, and refusing gate resolution from a delivery seat's session (decision 9)
  belong to #586.

See also [Person gates](person-gates.md) and [OpenRig bridge](openrig-bridge.md).
