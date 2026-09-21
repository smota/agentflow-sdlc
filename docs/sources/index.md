# Source adapter path

Source adapters connect AgentFlow artifacts and lifecycle actions to a durable external system.
They expose read and mutation capabilities separately and return portable `ArtifactRef` values.

GitHub is the first implementation. It is the default operational substrate, not the AgentFlow
domain model. A new source adapter must preserve artifact authority, lifecycle semantics, action
boundaries, idempotency, and mutation receipts.

See [GitHub](github.md) and the [modular architecture](../modular-architecture.md).

## Source adapter invariants

Any adapter, GitHub or otherwise, must satisfy:

- **A stable identifier.** Something that names the same artifact across reads without drifting.
- **A revision derived from a CONTENT DIGEST, never the source system's own `updated` field**,
  because issue bodies edit silently and an `updated` timestamp does not prove what changed, or that
  anything did. Compute it with `recordDigest` (`lib/core/record-digest.mjs`) over the artifact's
  identifying content — never invent a second digest recipe.
- **An append-only, ordered event log carrying writer identity.** `unknownWriterBlocksRecovery`
  depends on this: recovery cannot proceed if a prior writer cannot be identified from the log.
- **A typed `partOf` relation, stored opaquely.** The adapter returns a parent reference (e.g. a
  parent issue number); it does not resolve or interpret it. AgentFlow reconstructs the tree from
  these opaque references, to arbitrary depth, entirely outside the adapter.
- **Durable record storage that will not mangle a 64-character hex digest.** Truncation,
  case-folding, or numeric coercion of a digest silently breaks every equality check built on it.

Accepted cost: because `partOf` is reconstructed by AgentFlow rather than read from the source
system's native hierarchy, the source system's own UI will not show the true tree. A source with only
single-level grouping (for example, GitHub issues with no native sub-issues) can still carry an
arbitrarily deep AgentFlow tree; that tree is simply invisible outside AgentFlow.
