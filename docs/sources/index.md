# Source adapter path

Source adapters connect AgentFlow artifacts and lifecycle actions to a durable external system.
They expose read and mutation capabilities separately and return portable `ArtifactRef` values.

GitHub is the first implementation. It is the default operational substrate, not the AgentFlow
domain model. A new source adapter must preserve artifact authority, lifecycle semantics, action
boundaries, idempotency, and mutation receipts.

See [GitHub](github.md) and the [modular architecture](../modular-architecture.md).

The [OpenRig bridge](../openrig-bridge.md) is the consumer of the optional capabilities below
(`claim`, `ready-predicates`, `watch`): it speaks only this contract, never GitHub directly. See the
[execution layer guide](../openrig-execution-layer.md) for how a source adapter plugs into a rig, and
[GitHub claims](github.md#claims-581) for the GitHub claim ledger and bot identity.

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
  Callers MUST pass the adapter's `readyPredicateKinds` as `supportedKinds`; the default of every
  kind is only correct for an adapter that declares all three.
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
- **Claiming is idempotent per owner.** When the resolved holder is already the owner, `claim`
  appends nothing. In every other state it appends, so an owner whose earlier claim lost (and
  never yielded) gets a new entry, and the item, once free.
- **The trusted writer list is the authority.** Every writer on a source MUST resolve claims with
  the same trusted writer list. The owner is a field of the entry, so any trusted writer can claim or
  release on behalf of any owner; trust a writer only if it may act for every owner.
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
adapter. Filesystem specifics:

- **`trustedWriters` is required.** There is no default, because two writers that each trust only
  themselves would both win the same item.
- **The filesystem writer is self-declared.** Any process that can write the root can claim to be
  any writer, so filesystem permissions on the root are the only protection.
- **`readLogEntries(reference)` lists comment entries** in log order as `{ writer, body, uri,
createdAt, updatedAt, edited: false }`, for callers that judge entries themselves, such as gate
  decisions ([Team roster](../team-roster.md)). It is not part of the source contract.
- **Each writer keeps its own receipt store** (`receipts-<writer>.json`). A claim or comment is
  committed when its log line, which carries the idempotency key, is written; a failed receipt flush
  after that does not fail the call.
- **A source root is used from a single host.** Lock recovery checks whether the lock's process is
  alive, which is only known within one host's process namespace. A lock records its host and is
  never removed by another host; do not share a root over a network filesystem.
- **A crash leaves no permanent damage on its host.** An item lock held by a process that is gone is
  removed. An item lock with no readable owner, or a lock recovery guard, is removed once it is older
  than `lockStaleMs` (default 30 seconds). A lock that still cannot be taken fails with
  `source-lock-held`, naming the lock file to delete. A torn last log line is skipped and cut before the next append. A malformed line before the
  end is corruption and fails the read.
