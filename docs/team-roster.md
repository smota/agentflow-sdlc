# Team roster

A team roster sends each gate to the person responsible for it and decides who may answer it. It
is optional. With no roster file, every gate keeps the single-person path: the OpenRig human
gateway default (`rig gateway participants --json`) and today's `human:<login>` identities.

The roster stays in AgentFlow. OpenRig is only the delivery pipe: AgentFlow picks the person, and
the OpenRig queue carries the gate to that person's channel.

## Files

| File                                | Committed | Holds                                                     |
| ----------------------------------- | --------- | --------------------------------------------------------- |
| `.agentflow/team-roster.json`       | yes       | People, source handles, scopes, backup, timeout, capacity |
| `.agentflow/team-roster.local.json` | never     | Private channel addresses, by roster person id            |

No rig seat may write either file or their schemas (`schemas/team-roster.schema.json`,
`schemas/team-roster-overlay.schema.json`). They are in the `governance-files-guard` deny list of
`manifests/path-ownership.json`, so `validate:paths` rejects any seat's commit that changes them.
A person edits the roster. AgentFlow refuses to read a roster or overlay reached through a symlink.

The overlay is in `.gitignore` and in the git excludes the OpenRig adapter writes. `roster
validate` fails when the overlay is tracked or not ignored. Add the line to your project's
`.gitignore`:

```text
.agentflow/team-roster.local.json
```

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
- `handles`: the person's login per source system. A handle identifies who wrote a source entry. It
  is not an address and grants nothing by itself.
- `scopes`: what the person may answer. `gates` are gate types: `adequacy-of-intent`,
  `release-of-candidate`, `agent-escalation`, `security-review`, `acceptance-review`, `merge`.
  `tiers` are change classes: `bounded`, `standard`, `high-assurance`. `paths` are repository
  globs (`*` within a folder, `**` across folders); without `paths` the scope covers every path.
- `backup`: who gets the gate after the timeout. Defaults to the next person in scope.
- `timeoutMinutes`: how long the gate waits before it goes to the backup (default 240).
- `capacity`: how many open gates the person takes before routing skips them (default 3).
- `highAssurance.distinctReviewers`: when `true`, one person cannot give both high-assurance
  reviews.

The roster has no channel field. The validator rejects any value shaped like an e-mail address or
an OpenRig `@external` address, two people with the same handle, a missing backup, and a handle
that is one of the bridge's own writers (claim writers, evidence writers, the assignee mirror).

## The overlay

```json
{ "version": 1, "channels": { "sam": { "openrig": "<entity>@external" } } }
```

Each key is a roster id. The value is the person's OpenRig human gateway address. The overlay is
read only when a gate is delivered. Its values are never written to an issue, a source entry, a
queue body or summary, a log, or CLI output. Validation errors name the roster id and the field,
never the value.

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

A decision is a comment in the source whose first line is the decision marker:

```text
<!-- agentflow-gate-decision:{"v":1,"gate":"<gate id>","decision":"agree"} -->
```

`decision` is `agree`, `changes-requested`, or `blocked`. A high-assurance gate also names the
review: `"review":"security-review"` or `"review":"acceptance-review"`. The marker has no person
field. A marker with any other field is not a decision.

The writer of the decision is the source's own record of who wrote the entry, such as the comment
author. The source adapter's `resolve-humans` capability turns the writer into a handle, and the
handle finds the roster person. A decision counts only when:

- the writer is a roster person, and
- that person is in scope for the gate (for a high-assurance review, in scope for that review), and
- the writer is not the bridge, the source adapter's writer, or a configured bridge writer.

Anything else is recorded and opens no gate, with a reason: `writer-not-on-roster`, `out-of-scope`,
`bot-writer`, `resolve-humans-absent`, `invalid-roster`, `no-roster`. A decision given in chat or on
a queue row is not a source entry and counts for nothing until the person records it in the
source.

A high-assurance gate records `security-review` and `acceptance-review` separately. It opens only
when both reviews have an agreement from a person in scope. The latest decision in each review
counts, so a later `changes-requested` or `blocked` withdraws it. One person may give both reviews,
unless `highAssurance.distinctReviewers` is `true`.

Identity is only as strong as the source account. A seat must never hold a person's source
credentials: a comment written with a person's account counts as that person.

## Commands

```bash
agentflow-sdlc roster validate [--json]
agentflow-sdlc roster route --gate <type> [--paths a,b] [--tier <tier>] [--json]
node scripts/validate-team-roster.mjs [--json]
```

`roster validate` checks the roster, the overlay, and that the overlay cannot be committed.
`roster route` explains who a gate goes to and why, by roster id. Neither command delivers or
resolves a gate. With no roster both print
`No team roster (.agentflow/team-roster.json); gates use the single-person path.` and exit 0.

The library is `lib/roster/`: `team-roster.mjs` (load, validate, handle lookup), `gate-router.mjs`
(`routeGate`, `nextRecipient`, `deliverGate`, `createQueueNotifier`) and `authority.mjs`
(`authorizeWriter`, `admitGateDecision`, `gateDecisionState`, `highAssuranceGateState`). See also
[Person gates](person-gates.md) and [OpenRig bridge](openrig-bridge.md).
