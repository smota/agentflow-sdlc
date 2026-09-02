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

Cockpit reuses the GitHub source client through a thin compatibility facade. Cockpit can be absent
without affecting the source contract, CLI workflow, validators, adoption, or role execution.

When adding GitHub mutations, test issue-versus-PR identity, stale state, permission denial,
idempotency, concurrency, and partial external failure. Related issue #187 owns the independent
integration-lifecycle reference bug and must not be silently absorbed.
