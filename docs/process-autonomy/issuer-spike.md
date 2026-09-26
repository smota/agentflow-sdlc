# S2 Issuer Feasibility Spike

This document summarizes the findings and implementation of the **S2 Issuer Feasibility Spike**, a bounded exploration of isolated execution authorization within a local-cooperative environment.

## Spike Scope and Intent

The primary goal of this spike is to demonstrate the feasibility of issuing deterministic, verifiable execution grants and resolving requested operations against them. This spike is strictly scoped to the **issuer logic** and does not provide an active intercepting provider adapter.

### Explicit Limitations

- **Same-User Environment**: The issuer operates under a local-cooperative model. The HMAC key used for grant integrity is maintained in the same process memory/file boundary. It is a local shared secret, not a cross-machine or trusted-host credential.
- **Unauthenticated Actors**: Actor assertions (e.g., `human:local`) are self-declared descriptive labels, not authenticated identity claims.
- **No In-Flight Provider Enforcement**: Because there is no active provider adapter in this bounded spike, assertions of hard token ceilings or cost caps are structurally unverifiable and actively rejected at issuance.
- **Not Authoritative S2 Atomicity**: This spike tracks mutable budget state entirely in-memory. It does not provide the persistent, atomic distributed ledger capabilities required for full remote S2 authority.
- **No Subdelegation**: Agent-driven widening or subdelegation of grants is explicitly unsupported and out of scope.

## Key Mechanisms Implemented

### 1. Immutable Grant Envelopes vs. Mutable Authority State

To ensure grants remain verifiable across their lifecycle without invalidating their HMAC signatures:

- The `GrantEnvelope` is immutable, strictly bound to the initial approval parameters (plan digest, allowed actions, allowed paths, budgets), and cryptographically signed.
- The mutable execution state (e.g., attempts used, external effects budget used, revocation status) is maintained in the issuer's internal state map and checked dynamically at resolution.

### 2. Precise Scope Binding and Traversal Prevention

Execution resolution demands strict matching of target context:

- The requested `planDigest` must precisely match the grant binding.
- Target `repository` and `base` branch must align.
- File system paths are aggressively constrained: ambiguous normalizations, absolute paths, and path traversals (`..`) are rejected before pattern matching. Prefix globbing (`/*`) is cleanly supported.

### 3. Idempotency and Replay Rejection

Resolution leverages a distinct `operationDigest` provided by the requesting context.

- Repeated presentations of the same operation digest are rejected as replays, protecting the execution budget.
- True business actions require a unique, stable identity to differentiate legitimate distinct steps from accidental retries or duplicate attacks.

### 4. Zero-Tolerance for Unproven Capabilities

The issuer actively refuses unsupported configurations rather than silently ignoring them:

- **Hard Ceilings**: Any `hardCeiling` parameter is refused outright, as no provider adapter exists to enforce it.
- **Trusted-Host Modes**: Requests for `trusted-host` issuer modes are rejected in favor of explicit `local-cooperative` labeling.

## Demonstration

The local demonstration CLI (`scripts/spikes/process-authority/cli-demo.mjs`) illustrates the lifecycle:

1. Approval of an execution plan.
2. Issuance of the immutable grant envelope.
3. Successful resolution of an in-scope, budgeted action.
4. Active rejection of operation replay.
5. Active rejection of path traversal attacks.
6. Active rejection of budget exhaustion for external effects.

## Independent review and disposition

Agy produced this issuer-only experiment through its local CLI. Codex reproduced two
remaining failures after the Agy delivery: a `push` with zero external budget was
admitted when the caller set `isExternalEffect: false`, and `src/./file` was admitted
despite the claimed canonical-path constraint. Work returned to implementation;
Codex corrected both and added negative coverage. Those corrections are explicitly
self-reviewed, not attributed to independent Agy acceptance.

Action classification now belongs to the issuer's closed action registry. The
caller cannot downgrade `push` or `pr:create` to a local action. Noncanonical paths
and malformed allowed-path patterns fail before admission. Tests also cover plan,
repository and branch mismatches, revocation, tampering, unsupported issuer modes,
invalid budgets, and rejection without consuming a valid operation's budget.

Validation command: `node --test scripts/spikes/process-authority/delegation-grant.test.mjs`
(9 tests passed). The CLI demonstration was also executed successfully. These are
in-process demonstrations; no actual push, PR creation, user authentication, or
provider enforcement is performed. The demo's human actor string is illustrative.

The path check is lexical, not filesystem containment: symlinks/junctions and actual
workspace effects require a qualified execution adapter. Operation digests are
caller-supplied in this spike; production admission must derive and bind them to the
actual requested operation and reconcile duplicate outcomes. HMAC authenticates an
envelope only relative to this issuer's ephemeral secret; it is not human-origin
proof. Restart durability, atomic authoritative admission, policy revision binding,
provider capability qualification and narrowed child grants remain full S2 work.
This result does not require a new identity service, JWT system or hardware keys;
trusted-host assurance remains unsupported until a real host binding is available.
