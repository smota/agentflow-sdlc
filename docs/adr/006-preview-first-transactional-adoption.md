# ADR 006 — Preview-first transactional adoption

**Status:** Accepted
**Date:** 2026-09-01
**Updated:** 2026-09-02

## Context

Adoption must bind a reviewed plan, record an install profile, and support rollback after a partial
filesystem failure. Composition profiles also need one stable default payload and closed runtime
dependencies.

## Decision

Adoption and update operations become two-step transactions:

1. A read-only preview computes the exact actions, conflicts, source hashes, target preconditions,
   selected install profile, and a content-derived approval token.
2. Apply revalidates that token and every precondition, stages writes beside their targets, commits
   them atomically where the platform permits, and restores prior bytes if any action fails.

Lockfile version 2 records the selected profile, package identity, managed entries, ownership, and
last applied plan token. It is the only supported lock shape. A v2 file is written only after a
successful apply; malformed or other-version locks fail closed.

`standard` is the default profile. `minimal`, `github`, and `cockpit` may narrow or extend installed
surfaces only when their manifests, dependency closure, and installed-payload tests are explicit.
Physical package splitting is deferred until contract and installed-payload tests prove the
boundaries.

`adopt plan/apply/rollback/recover` is the only installation and update surface. Retired root
commands and lockfile migrations are intentionally unsupported; the product has no active external
installations that justify maintaining parallel behavior.

## Consequences

**Positive:** users can inspect exact changes; stale approvals and partial writes fail safely;
lockfile state is deterministic; profiles do not silently change the default install.

**Negative:** implementation and tests are more complex; removed command and lock formats require a
fresh adoption; atomic replacement has platform-specific failure modes that require fault-injection
coverage.

## Receipt durability extension

[ADR 007](007-verifiable-recoverable-delivery.md) extends storage with project-contained transactions and a mandatory durable receipt destination. Finalization and rollback use restartable journals. The v2-only lock and no-alias decisions remain unchanged.
