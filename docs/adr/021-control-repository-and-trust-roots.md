# ADR 021 — Control repository and path classes

**Status:** Proposed
**Date:** 2026-11-25

## Context

The [governed-factory design](../designs/governed-factory.md) contains agents with controls that
live outside the repository they work on, so that an agent cannot change the rules that judge it.
Those controls need one home that only the author writes, that the verifier and the coordinator can
read, and that holds policy rather than secrets. The design also needs a single answer to "which
paths are the factory's own controls", because every merge rule depends on it: until L3, a change to
those paths needs the author's code-owner review (design decision D47), and at L3 it waits out the
time-lock. The author decided that the control repository is the only owner of trust-bearing policy
(D37), and that the holdouts live in a separate repository (D45).

The control repository was created in week 0 as a private repository, `smota/agentflow-control`.

## Decision

1. **One private control repository per governed repository set.** Only the author writes it. No
   builder, reviewer or steward GitHub App has access. The coordinator and verifier job B read it
   with read-only credentials. It holds policy, not secrets.

2. **Layout.**

   | Path                    | Holds                                                    | First used |
   | ----------------------- | -------------------------------------------------------- | ---------- |
   | `path-classes.json`     | The path classes below                                   | Week 0     |
   | `pause.json`            | The pause flag `{paused, reason}`                        | Week 0     |
   | `trust-policy.json`     | Principals, trust roots and required acts                | M1         |
   | `checkins/`             | One signed tag per author check-in                       | M1         |
   | `canon/`                | Red-team events; only ever grows                         | M1         |
   | `holdouts-repo.json`    | The separate holdouts repository and its expected ref    | M2         |
   | `verifier.digest`       | Digest of the pinned verifier release                    | M2         |
   | `delegation/D-<n>.json` | Signed delegations                                       | M2b        |
   | `delegation-optin.json` | The high-assurance opt-in; absent keeps the default rule | L3         |

   A governed repository's own configuration holds only a reference to the control repository and
   its expected ref; `validate:authority` refuses trust-bearing keys in repository configuration (M2-1).

3. **Path classes.** Each changed path has one class, checked in this order:
   - `factory-core`: the factory's own controls. Until L3 the author's code-owner review is required;
     at L3 the time-lock applies. The initial list: `.github/**`; the binding policy (`AGENTS.md`,
     `CLAUDE.md`, `AGY.md`, `CODEX.md`, `defaults/AGENTS.md`, `docs/guiding-principles.md`,
     `docs/agent-workflow.md`, `docs/steering-merge-authority.md`, `docs/person-gates.md`) and the
     design itself (`docs/designs/governed-factory.md`); `goals/**`, because milestone gates are
     person acts; the configuration and dependency files (`agent-workflow.config.json`,
     `sdlc.config.json`, `package.json`, `pnpm-lock.yaml`, `manifests/path-ownership.json`); the
     kill switch, cap, runner and checks (`lib/runtime/coordinator-state.mjs`,
     `lib/runtime/run-cap.mjs`, `scripts/coordinator.mjs`, `scripts/guarded-run.mjs`,
     `scripts/box-check.mjs`, `scripts/week0-gate.mjs`); containment (`lib/core/substrate-port.mjs`,
     `lib/core/provider-binding.mjs`, `lib/substrate/**`, `adapters/sbx/**`); verification, signing
     and evidence (`lib/verification/**`, `lib/signing/**`, `lib/evidence/**`,
     `scripts/verify-pr.mjs`, `scripts/pin-verifier.mjs`); and the merge path and gates
     (`scripts/steer.mjs`, `lib/core/steering-merge-policy.mjs`, `lib/core/delegation-grant.mjs`,
     `lib/core/gate.mjs`, `lib/core/review-attestation.mjs`, `lib/core/execution-receipt.mjs`).
   - `l1`: documentation, tests and the claims ledger (`docs/**`, `lib/__tests__/**`,
     `scripts/__tests__/**`, `manifests/claims-ledger.json`).
   - `l2`: every other path (the default).

   A path that matches `factory-core` is `factory-core` even when it also matches `l1`. A new control
   file joins `factory-core` in the same PR that creates it, which is itself a `factory-core` change.

4. **Pause.** `pause.json` with `paused: true` stops agent merges at verifier job B (D47) and stops
   admission at the coordinator (M1-8). Only the author writes it. The local `coordinator kill`
   switch (W0-14) is separate and stops runs on the host at once.

## Consequences

**Positive:** The rules that judge agent work sit where agents cannot reach them. One file answers
which paths need the author, so `.github/CODEOWNERS` (M2-2) is generated from it and checked for
drift. The repository holds nothing secret, so read access for the coordinator is low-risk.

**Negative:** Every governed repository depends on the control repository being readable: when it is
not, agent merges stop (safe, but the factory stalls). The `factory-core` list must keep up with new
control files; a control file left out of it can be changed by agent merge at L2. The list is
proposed here and becomes binding when the author merges this ADR.
