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
system's native hierarchy, the source system's own UI will not show the true tree on its own. A source
with only single-level grouping can still carry an arbitrarily deep AgentFlow tree; that tree is
simply invisible outside AgentFlow. A source that can mirror the parent does so, and a source that
cannot keeps the text link: the GitHub medium always writes `Part of #n` and, when the host supports
it, also links the native sub-issue for navigation. The mirror is never read back as the authority.

## Optional capabilities

Version 1 adapters may declare these optional capabilities. `SOURCE_ADAPTER_VERSION` stays `1`, and
an adapter that declares none of them is still a valid version 1 adapter. `validateSourceAdapter`
checks the methods and declarations of each capability an adapter declares. The shared shapes
(reference string, WorkItem, ready predicate, claim log entry) are defined in
`lib/core/source-ref.mjs`, `schemas/work-item.schema.json`, `schemas/ready-predicate.schema.json`
and `lib/core/source-claim.mjs`.

### Capability absent

- **Absence is an answer, not a failure.** `sourceCapability(adapter, capability)` and
  `callSourceCapability(adapter, capability, method, ...args)` return
  `{ available: false, status: 'capability-absent', capability, adapter }` when the adapter does not
  declare the capability. They MUST NOT throw for absence.
- **A real failure still throws.** When a declared capability's method fails, the error propagates,
  so a source outage is never read as "not supported".
- **Limits follow from what is declared.** `describeSourceLimits(adapter)` allows one delivery rig
  for an adapter without `claim` and gives the reason; with `claim` it sets no limit.

### `ready-predicates`

- **Methods:** `toReference({ system, scope, id })`, `readWorkItem(reference)`,
  `listWorkItems({ lifecycle = 'open' })`; the adapter declares `readyPredicateKinds` (a non-empty
  subset of `label`, `status`, `lifecycle`).
- **A WorkItem carries a content-digest revision.** `revision` is `recordDigest` over
  `{ title, body, lifecycle, labels (sorted), status }`. A comment, a claim or a label order change
  does not move it.
- **References are portable.** A reference string is `<system>:<scope>#<id>`;
  `toReference` turns the parsed parts into the adapter-native reference and throws for another
  system or scope.
- **Unsupported is checked first.** `evaluateReadyPredicate` returns `unsupported` with the kinds the
  adapter does not declare before evaluating anything, so a partial answer never reads as ready.
- **Readiness is evaluated from a fresh read.** A caller decides readiness from `readWorkItem`, never
  from a copy held in a queue.

### `claim`

- **Methods:** `claim(reference, owner)`, `release(reference, owner)`, `readClaim(reference)`; the
  adapter declares `mutate-comments` and names its `claimMirror` (for example `lock-file` or
  `assignee`).
- **The source log is the ledger.** Each claim or release is an append-only log entry
  (`<!-- agentflow-claim:{json} -->` as the first line of a comment, or a filesystem log line),
  written through `previewMutation`/`applyMutation` with operation `append-claim-entry`.
- **Writer identity comes from the source.** Only entries whose source-provided writer (comment
  author, log `writer`) is in the trusted writer list count. A writer field inside the entry is never
  accepted.
- **The earliest trusted claim wins.** `resolveClaim` walks entries in log order: a claim while free
  takes the item, a claim while held is ignored, and only a release by the holder's owner frees it.
  Releases by anyone else are ignored.
- **Claiming is idempotent per owner.** When an owner's latest trusted entry is a claim, `claim`
  appends nothing.
- **The mirror is written, never read back as truth.** The native mirror (lock file, assignee) is
  updated after each claim or release for people to see. `readClaim` reports it with `diverged`, but
  `status` and `holder` come from the log alone, so a hand-edited mirror changes nothing.

### `watch`

- **Method:** `watch(cursor)` returns `{ cursor, refs }`, the reference strings changed since the
  opaque cursor (`null` reads from the start).
- **Watch is a hint.** A caller re-reads each item; a missed or repeated reference never changes
  the outcome. AgentFlow runs no polling loop around it.

### `resolve-humans`

- **Method:** `resolveHumans(writers)` returns `[{ writer, handle: { system, login } }]`.
- **Handles identify, they do not authorize.** Authority for a gate decision comes from the team
  roster and the source writer identity, not from the handle alone.

The filesystem source adapter (`lib/sources/filesystem-source.mjs`) declares every optional
capability, uses `claim.lock` as its claim mirror, and runs the reusable contract suite
(`lib/__tests__/source-contract-suite.mjs`). The single-goal filesystem medium is not a source
adapter.
