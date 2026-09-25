# Scoped delegation application contract

S2 adds typed delegation to the existing run service and event reducer. It does not
replace the legacy authorization callback or create a second authority store. The
wire envelope is [DelegationGrant](../../schemas/delegation-grant.schema.json).

## Host binding and assurance

Configure `createRunService({ delegationPolicy, authorize, store })` before starting
a new run. `start` persists that policy in the authoritative event chain; existing
runs without it cannot mint retrospective grants. A policy has `version: 1`, an
`issuers` array, `requiredChecks`, `reviewPolicy`, `materiality: 'fixed-scope-v1'`,
`allowSubdelegation`, and integer `safetyReserve` (1–100). Each issuer records `id`,
`origin`, `authorityRef`, `mode: 'local-cooperative'`, `allowedActions`, and an explicit
`allowThroughMerge` boolean. The policy digest is `recordDigest(delegationPolicy)`.

`createLocalCooperativeIssuer({ policy, issuerId, approve })` supplies a usable local
approval surface. The host implements `approve(context)` and returns
`{ approved: true, decisionRef: 'host-owned-decision-reference' }` only after its
explicit approval action. A boolean callback alone cannot mint or resolve a grant.
The adapter returns typed issuance, resolution and revocation decisions bound to
the configured origin and policy. The host must verify the operation's workspace,
checks, exact-candidate review and delegate before approving resolution. Neither
these labels nor their digests authenticate a human. This cooperative adapter cannot
distinguish malicious processes sharing its OS account/credentials. It does not
manufacture human review or a trusted-host assertion. `trusted-host` and all hard
currency/token ceiling requests are unsupported until enforcing adapters qualify.

The host may wrap that issuer with its existing boolean callback for nondelegated
operations; boolean compatibility remains unchanged. Policy changes require a new
run and grant; they do not silently mutate issued authority.

## Application calls

- `issueGrant(request, { expectedRevision, authority, parentId? })` returns the
  updated run projection and `grantId`. Request fields are the schema's binding
  fields except `issuerBinding`, which the configured host supplies. The request
  digest commits every requested field. The issuer approval is not requested twice.
- `resolveGrant(id)` returns a copy of the stored envelope, revision, revocation
  epoch, status and consumed/reserved allowances.
- `revokeGrant(id, reason, options)` requires a typed decision from the configured
  issuer. Revocation and admission append against the same run chain.
- `admitOperation(operation, { expectedRevision, authority, grantId })` independently
  asks the configured issuer for a typed resolution over the exact operation. The
  event stores that decision, grant revision/epoch, writer/run revision, normalized
  operation and its computed digest. The reducer recomputes and checks them all.
- `executeDelegatedOperation(operation, options, dispatch)` invokes the adapter only
  after admission ACK and durable planned/submitted intent. It does not infer
  provider confirmation from callback return. Use authoritative operation outcome
  reconciliation before reporting success. Stable-ID replay returns the prior
  receipt and never redispatches, including when that deliberately requires manual
  recovery of an admission that never reached dispatch.
- `reconcileAdmission(error.pendingEvent)` reads exact event identity and reports
  `acknowledged` or `unknown`. Failed append retains the portable event on the error;
  an in-process pending admission fences further admission until reconciliation.
- `safetyCheckpoint({ id, kind, reason, operationId? }, options)` supports bounded
  `checkpoint` or reconciliation of an already admitted operation. It cannot grant,
  change budgets, launch business actions or waive gates.

An operation contains `id`, `planDigest`, `policyDigest`, `repository`, `base`,
`delegate`, `action`, `paths`, `capabilities`, `candidateDigest`, `workspaceDigest`,
`checks`, `review`, and `arguments`. Its digest includes the complete object,
including arguments and candidate/workspace identity; unknown fields and nonfinite
JSON fail closed. Actions/capabilities currently share vocabulary: `edit`, `commit`,
`push`, `pr:create`, `pr:update`, `merge`. The core classifies external effects;
a caller cannot mark a push as local. Checks are `{ name, outcome, candidateDigest }`;
review is `{ policy: 'automated' | 'human', outcome, candidateDigest }`. Every required
check and review must pass for the exact current candidate. Host approval remains
responsible for verifying that supplied evidence against its authoritative source.

Delegation entry points snapshot requests, operation identity and authority before
their first asynchronous boundary. The issuer snapshots approval context and gives
the approval UI a separate copy. Dispatch and durable intent use the acknowledged
receipt's operation and digest, so changing a caller object while approval waits
cannot change the admitted action.

## Scope, budgets and safety

`fixed-scope-v1` fixes plan, policy, repository/base, delegate, allowed actions,
capabilities, paths, checks/review and budget. Candidate edits within this scope do
not need a new plan digest, but every action binds the current candidate. Paths are
canonical repository-relative lexical paths; `src/*` includes descendants. Traversal,
absolute paths, backslashes and ambiguous components fail. This is not proof of real
filesystem containment: an executor adapter must verify symlinks/workspace identity
before claiming that enforcement.

Children may only narrow paths/actions/capabilities, strengthen checks/review and
shorten validity. Their entire allowances reserve the parent's remaining allowance
at issuance. Child use consumes that reservation, not another parent allowance;
unused reservations are conservatively not returned on revoke. Descendants cannot
outlive or evade a revoked/expired/missing ancestor. No sibling can multiply budget.
The current contract retains the same delegate throughout a child chain.

Business attempts and external-effect allowances are separate from bounded safety
records. Each safety payload is at most 2 KiB. The GitHub store reserves 4 KiB per
remaining safety record (including event envelope) from its 1 MiB source capacity.
Telemetry has no authority to consume these reservations. An unavailable source still
requires the S3 host to retain `pendingEvent` and a local pending checkpoint; no source
append can promise durability during an outage.

## Conditional admission and recovery limits

A capable store advertises `conditionalAdmission: 'single-parent-run-chain-v1'`.
The GitHub implementation commits the full reduced run to a single-parent Git commit
and uses a non-force ref update. Concurrent divergent commits cannot both advance
under this cooperative protocol. Tests stop both real store clients at PATCH so
both proposals share the observed parent, then exercise both winner orders. Lost
responses reconcile by exact event digest; failed confirmation prevents dispatch.
A later descendant does not undo an acknowledged admission. An action admitted before
revocation may finish; new admission after acknowledged revocation is denied.
External administrator ref rewriting/hostile credentials are outside this assurance.

S2 supplies the typed application surface and source transaction, not a CLI grant UI,
provider identity service, symlink verifier or crash-persistent pending journal. S3
must wire durable local pending recovery, exact provider outcome lookup/idempotency,
process advancement and technical acceptance. There is no universal exactly-once
claim. The original issuance spike remains historical and unmodified.
