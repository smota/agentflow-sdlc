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
does not yet declare `claim` or `watch`; callers see `capability-absent`.

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
Paged reads throw rather than truncate past 100 pages.

Tests run against `lib/__tests__/fixtures/fake-github.mjs`, an in-memory client; none touch the
network.

Cockpit reuses the GitHub source client through a thin compatibility facade. Cockpit can be absent
without affecting the source contract, CLI workflow, validators, adoption, or role execution.

When adding GitHub mutations, test issue-versus-PR identity, stale state, permission denial,
idempotency, concurrency, and partial external failure. Related issue #187 owns the independent
integration-lifecycle reference bug and must not be silently absorbed.
