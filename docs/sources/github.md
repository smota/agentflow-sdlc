# GitHub source adapter

The GitHub adapter supplies issue and pull-request reads, lifecycle projections, and explicitly
bounded comment mutations. Core code consumes normalized `ArtifactRef` values; GitHub-specific JSON
stays inside the adapter or optional projections.

Read capabilities require no mutation boundary. Every write first calls `previewMutation`, which
binds the operation parameters, effective action boundary, current remote revision, and idempotency
key into a SHA-256 plan token. `applyMutation` accepts only that exact token, re-reads the revision,
and refuses stale state before writing. Mutation-capable adapters require a durable receipt store;
`flushReceipt` persists by idempotency key, and comment bodies carry a hidden idempotency marker so a
restart between remote write and local flush can recover without duplicating the comment. Label and
lifecycle commands use GitHub's idempotent operations and propagate authentication, network, or
permission failures. `mutate-comments` and lifecycle writes require an effective `open-pr` or
`external-action` boundary. Authentication and repository permission remain external runtime
concerns and must not appear in durable evidence.

The file receipt store serializes writers with an exclusive process-owned lock. Before replacing
the canonical store it flushes a deterministic journal containing before/after digests, then stages,
backs up, and promotes. On restart it removes a stale dead-process lock and either completes cleanup
for a promoted digest or restores the prior digest. Unknown drift and live concurrent writers fail
closed. Stale-lock reclamation holds a separate exclusive recovery guard, preventing another
process from reclaiming or deleting the new writer lease during the handoff.

## Readiness, evidence and humans (#581)

The REST adapter declares `ready-predicates` and `resolve-humans` and answers `label` and
`lifecycle` predicates; GitHub has no status field, so `status` predicates report unsupported. It
does not declare `watch`, and declares `claim` only when claim writers are configured (see below);
callers see `capability-absent` otherwise.

- `toReference({ system: 'github', scope, id })` accepts only the adapter's own `owner/repo` scope.
- `readWorkItem` and `listWorkItems` return the shared WorkItem shape. The `revision` is a content
  digest over title, body (without the gate block), lifecycle, sorted labels and a null status, never
  `updated_at`, so a landing comment does not stale a mutation plan. The legacy `readArtifact`
  revision is unchanged. Mutation plans use the same content digest.
- Lifecycle is `open`, `closed`, or `merged` (a closed pull request with `merged_at`). A listing
  skips open and unmerged pull requests, and pages 100 at a time.
- Role-pass evidence is an `add-comment` mutation whose body comes from `formatRolePassComment`;
  `parameters.reference.number` or `parameters.number` names the issue. Transitions are read back
  with the comment author as the writer. `openGates` counts waiting gates in the issue's gate block;
  an unreadable block counts as one open gate (fail closed).
- `resolveHumans` maps a writer to `{ system: 'github', login }` in lower case.

The revision excludes the gate block, so `openGates` can change without a revision change. A
work item with no readable `state`, an unreadable or non-object `agentflow-work` marker, or an
unknown `changeClass` is unreadable and `readWorkItem` throws; it is never read as open or as a lower
class. `partOf` is the number from a `Part of #N` line only. Transitions are claims by their author:
consumers must filter them by trusted writer, and records with a non-integer phase are dropped. A
gate block with no record, no end, a non-array log or validation findings counts as one open gate.
`listWorkItems({ lifecycle, onUnreadable })` skips an unreadable item and calls the optional
`onUnreadable({ reference, error })` for each, so one poisoned issue cannot stop a repository-wide
listing; transport failures and truncation still throw.
Paged reads throw rather than truncate past 100 pages.

## Claims (#581)

`createGitHubSourceAdapter({ repo, client, receiptStore, claimWriters, mirrorAssignee,
claimBoundary })` declares `claim`, `mutate-comments` (the log) and `mutate-lifecycle` (the
mirror), with `claimMirror: 'assignee'`, when `claimWriters` is non-empty. `mirrorAssignee` is then
required. Every claim, release and mirror write is planned under `claimBoundary` through
`previewMutation`/`applyMutation` and refused unless its effective boundary is `open-pr` or
`external-action`; it needs a receipt store like any other mutation.

- **Claim ledger.** Each claim or release is an issue comment whose first line is
  `<!-- agentflow-claim:{json} -->` (operation `append-claim-entry`). Comment order (comment id) is
  log order. The earliest trusted claim wins, only the holder's release frees the item, and a claim
  appends nothing only when the resolved holder already equals the owner, so a past losing claim
  never blocks a later claim on a free item. A stale plan (the issue content changed) is re-planned
  up to three times. Only `append-claim-entry` writes entries: `add-comment` refuses a body whose
  first line mentions `agentflow-claim:`, so evidence or prose cannot be posted as a bot-written
  entry.
- **Edited entries do not count.** A collaborator with write access can edit the bot's comment
  while GitHub keeps the bot as its author. A claim comment whose `updated_at` differs from its
  `created_at` is ignored (reason `edited-entry`), whether it was a claim before or was edited into
  one. **Residual risk:** a write-access user can also delete a comment, and a deleted entry leaves
  no trace in the comment list, so deleting the holder's claim frees the item. Restrict write access
  to people trusted with the claim ledger; detecting deletions needs the issue timeline and is not
  attempted.
- **Trust list.** Only comments written by a login in `claimWriters` count (compared case
  insensitively). The comment author comes from GitHub; nothing inside the entry names its writer.
  Any trusted writer may claim or release for any owner, so every rig on the project must use the
  same list.
- **Bot identity.** The recommended setup is one bot account (or GitHub App) per project: it writes
  every entry and is the `mirrorAssignee`. The rig (and host) is named inside the entry, so
  `readClaim` returns the specific rig although every comment and the assignee are the bot. Rigs
  sharing the bot are one trust domain. Moving to per-rig accounts later only changes `claimWriters`.
- **Assignee mirror.** When a rig wins, the assignees are set to the bot alone; when the holder
  releases, the bot is removed and other assignees stay. A losing claim or ignored release leaves the
  assignees alone. Each mirror write computes the wanted assignees from a fresh read, so a retry
  never replays an old list. `readClaim` reports `mirror: { value: { assignees }, diverged }`: a rig
  holder expects exactly the bot; a person holder and a free item expect no bot (a person holder
  with no assignees is consistent). The assignees are never read back to decide the holder: if a
  mirror write fails, the log still decides, and `adoptMirrorChange` repairs the mirror.
- **Reassignment in the GitHub UI.** A person changing the assignee is input, not truth: `readClaim`
  reports it as `mirror.diverged`. `adoptMirrorChange(reference, { personFor })` acts only when the
  bot is no longer assigned; a co-assignee added next to the bot is not a reassignment (`ignored`,
  reason `bot-still-assigned`, the rig keeps its claim and nothing is written). It looks, in event
  order, for the latest `assigned` issue event after the bot's own latest assignment, made by a login
  outside `claimWriters`, whose assignee is still assigned and which no entry names as its cause.
  `personFor(login)` returns a roster person id (or `{ id }`) or null. When both
  the event's actor and the new assignee resolve, it appends a `release` for the rig and a `claim`
  for `{ kind: 'person', id }`, both with `cause: { kind: 'mirror-change', actor, eventId }`, and sets
  the assignees to that person (`status: 'adopted'`). Otherwise it restores the bot as the only
  assignee, appends nothing and returns `status: 'ignored'` with a `reason`
  (`actor-not-a-person`, `assignee-not-a-person`, `no-reassignment-event`). If another writer claims
  between the release and the person's claim, the log decides (`status: 'lost'`). With no rig holder
  it returns `not-applicable`; with an in-sync mirror, `in-sync`. Both entries take their `claimId`
  and `at` from the event, so concurrent or repeated calls plan the same entries (a duplicate comment
  is the same entry and resolves as ignored), and a call that finds a mirror-change release without
  its person claim (a crash between the two) appends the claim and finishes the adoption.

The client adds `issueEvents(repo, number)` (all pages), `addAssignees` and `removeAssignees`.

Tests run against `lib/__tests__/fixtures/fake-github.mjs`, an in-memory client; none touch the
network.

Cockpit reuses the GitHub source client through a thin compatibility facade. Cockpit can be absent
without affecting the source contract, CLI workflow, validators, adoption, or role execution.

When adding GitHub mutations, test issue-versus-PR identity, stale state, permission denial,
idempotency, concurrency, and partial external failure. Related issue #187 owns the independent
integration-lifecycle reference bug and must not be silently absorbed.
