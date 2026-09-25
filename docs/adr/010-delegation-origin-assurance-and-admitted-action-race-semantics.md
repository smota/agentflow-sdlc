# ADR 010 — Delegation origin, assurance and admitted-action race semantics

**Status:** Proposed
**Date:** 2026-09-25
**Slice:** S0 (baseline), full implementation in S2/S3
**Process-autonomy plan ref:** docs/maintainers/process-autonomy-execution-plan.md §Architecture decisions (D1)

> [!NOTE]
> This ADR is **proposed**, not accepted. It becomes accepted only through the workstream's
> review policy (Codex SDLC evidence review, Grok architecture review, and any required human
> candidate review). Do not treat the proposal as an implementation approval or a blanket
> certification.

## Context

AgentFlow's existing `authorize` callback in `lib/application/run-service.mjs` returns a boolean.
A boolean-true authorization is sufficient for single-agent, current-session use, but it does not
emit a typed grant, record issuer origin or assurance level, or bind a plan digest, permitted
action set, repository/base, or expiry. As a result:

- Any caller supplying `true` obtains the same permission regardless of who issued the decision
  and under what conditions.
- The admission check has no atomic link between the authority record and the run/writer
  generation, creating a window where a concurrent revocation or a stale cached authorization
  can race with an in-flight external action.
- A host approval under a shared OS account cannot prove it originated from a specific user
  decision; a config value, an agent-written GitHub comment using shared credentials, or an
  arbitrary actor string is not identity proof.

The execution plan (D1) requires typed issue/resolve delegation use cases, grant-bound admission,
atomic grant/run reservation, and explicit host-assurance disclosure — without adding a mandatory
identity service or cryptographic signature scheme.

## Decision

1. **Typed grant at the boundary.** Add `issueGrant(intent)` and `resolveGrant(ref)` use-case
   as AgentFlow application use cases alongside existing boolean `authorize()`. Host adapters supply
   origin/assurance evidence; they do not define SDLC scope or mint additional authority. The
   boolean compatibility path remains for existing callers but is explicitly insufficient for
   delegated admission: only a resolved `DelegationGrant` object supplies the grant.

2. **Grant fields.** A `DelegationGrant` records: issuer origin/assurance level, delegate
   identity, plan digest, policy digest, repository and base branch, permitted paths/capabilities
   and action set (narrower than the issuer's own rights), validity window and expiry, budget
   allowances (work attempts, external-effect count), and an authoritative revocation reference.

3. **Assurance levels.** Three declared levels, each with explicit limitations:
   - `local-cooperative`: shared OS user; cannot distinguish malicious same-user agents; policy
     may reject this level for protected actions.
   - `trusted-host`: a binding that can export a verifiable user decision; must demonstrate
     replay/forgery rejection under its stated threat model before claiming this level.
   - `not-available`: through-merge or externally-effecting actions are refused; record ready-PR
     and report the limitation explicitly.

4. **Atomic admission.** Define a portable conditional-admission source capability. Its one
   authoritative transaction binds grant identity/revision, revocation epoch, writer/run revision,
   budget reservation and operation digest. Revocation and writer handoff use the same consistency
   boundary. The GitHub adapter proposes a single-parent commit against the observed ref, followed
   by a non-force fast-forward update. The commit parent is the observed Git commit, not a writer
   generation number. Dispatch requires acknowledged admission; ambiguous confirmation remains
   pending until reconciliation. A later descendant does not invalidate an acknowledged admission.
   A source without the capability cannot claim revocation-safe delegated external effects.

5. **Revocation and race semantics.** Acknowledged revocation blocks all new admissions. A
   previously admitted operation may finish after revocation; attempt cancellation only if the
   provider supports it, then reconcile. An ambiguous confirmation (neither acknowledged success
   nor acknowledged failure) produces a pending/unknown local checkpoint; no new business effects
   are admitted until reconciliation.

6. **No retroactive grants.** The old-format run remains historical. No retroactive grant is
   issued for it; its narrative must not be advanced.

7. **Plan digest immutability.** Once a grant is issued against a plan digest, the candidate
   code may evolve only to implement that plan within the approved scope, action set, and
   assertions. Scope, action set, or assertion changes invalidate or re-evaluate the grant;
   ordinary implementation edits admitted by the AgentFlow-owned predicate do not require plan reapproval.

## Consequences

**Positive:** Typed grants make authority explicit and auditable; assurance disclosure prevents
silent false claims; atomic admission is intended to fence concurrent authority changes at the admission boundary;
S2/S3 must prove that invariant, and already-admitted actions may finish after revocation; boolean compatibility keeps existing adapters working during migration.

**Negative:** The admission path becomes more complex and requires a capable source provider for
through-merge assurance; local-cooperative mode's threat-model limitations must be disclosed
prominently; S2 must demonstrate the stated concurrency invariant before S3 enables external
actions.

**Open at proposal stage:**

- The exact `DelegationGrant` schema and its JSON/YAML representation (S2 deliverable).
- Whether `local-cooperative` assurance is acceptable for ready-PR (expected yes) or
  through-merge (expected no without explicit policy authorization).
- Provider-capability negotiation at issuance when the named provider cannot enforce a hard
  budget ceiling (see D3 / S2 for provider binding).

## Adversarial review clarifications

Grok advisory review identified these constraints; no trusted-host binding is certified by this
proposal. Origin and delegate strings are labels, not authentication evidence. Only an explicitly
reviewed host binding can assert trusted-host assurance; unsupported requests fail closed.
Shared-account CLI operates at local-cooperative assurance with its limitations visible.

The compatibility boolean path remains for legacy current-session operations; it cannot authorize
a new delegated action without a typed resolved grant. This does not silently revoke all existing
non-delegated APIs. AgentFlow owns scope/materiality evaluation, not an executor's self-report.

A safety checkpoint is bounded control-plane recording, suspension or reconciliation. It cannot
launch new business work, extend a grant, waive a gate or fabricate progress. Durable persistence
and authorized reconciliation can use the reserved control budget; telemetry cannot block them.
