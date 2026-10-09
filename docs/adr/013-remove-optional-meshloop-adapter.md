# ADR 013 — Remove the optional Meshloop adapter

**Status:** Accepted by explicit maintainer direction on 2026-10-09
**Date:** 2026-10-09
**Supersedes:** [ADR 012](012-execution-provider-and-observability-boundaries.md) decision 12
("Meshloop as an optional execution adapter") only. The rest of ADR 012 is unchanged.

## Context

ADR 012 allowed Meshloop to act as an optional execution adapter behind the versioned provider
port. Releases [1.2.0](../releases/v1.2.0.md) and [1.3.0](../releases/v1.3.0.md) shipped that
adapter, its qualification script, Meshloop-named observation kinds and operator guides. The
maintainer directed that AgentFlow be disconnected from Meshloop completely.

## Decision

AgentFlow no longer plans, executes, qualifies or observes Meshloop. The adapter, its engineering
provider, its qualification script, its observation kinds and its configuration and qualification
guides are removed. AgentFlow adds no replacement Meshloop surface or compatibility shim.

The neutral engineering-provider port, the other built-in providers and the generic
observability boundary from ADR 012 stay as they are. A project can still configure another
engineering provider explicitly.

Release notes, ADR 012 and maintainer records that describe the earlier work stay as history.

## Consequences

**Positive:** AgentFlow no longer depends on or documents an external engineering product, so
there is less provider-specific code and test surface to maintain.

**Negative:** Projects that configured `meshloop-engineering-cli` lose that provider. Resolving
that configured id now fails with "Configured engineering provider unavailable", and they must
select another provider or use the direct flow. Earlier Meshloop qualification evidence no longer
applies to the current release.
