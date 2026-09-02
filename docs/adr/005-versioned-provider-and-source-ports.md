# ADR 005 — Versioned provider and source ports

**Status:** Accepted
**Date:** 2026-09-01

## Context

AgentFlow already has portable `ArtifactRef`, transition, lifecycle, action-boundary, runtime-platform,
and execution-target contracts. Adding harnesses or source systems directly to workflow logic would
duplicate those concepts and create name-based conditionals throughout the codebase.

## Decision

AgentFlow introduces four versioned boundary contracts:

- `CollaborationIntent` describes the desired collaboration mode, roles, constraints, and required
  capabilities without choosing a provider or launch mechanism.
- `ProviderBinding` records the selected provider, proven capability facets, execution target,
  transport, and degradation policy.
- `ExecutionReceipt` records what actually executed and links inputs, outputs, and validation through
  existing `ArtifactRef` values and provenance vocabulary.
- `SourceAdapter` exposes source reads and explicitly bounded mutations without making GitHub the
  domain model.

Provider capabilities are narrow facets: `inventory`, `project-adapters`, `execution`, `workspace`,
`evidence`, and `lifecycle`. A provider declares only facets it implements. Provider selection is by
required capabilities and explicit project binding, never by shell-string probing or brand-specific
branching.

GitHub is the first source adapter. Cockpit consumes source projections and remains optional. Existing
GitHub and Cockpit modules migrate behind the port incrementally; their v1 public behavior remains
covered throughout the migration.

Unsupported contract versions fail with a diagnostic. An unavailable optional provider degrades to
sequential or manual execution when the intent permits it, and the degradation is recorded in the
binding and receipt.

## Consequences

**Positive:** providers and source systems can be added without changing SDLC policy; evidence remains
portable; capability claims are explicit and testable; manual execution is a first-class fallback.

**Negative:** adapters add indirection; compatibility shims remain until consuming projects migrate;
some provider-native details cannot appear in portable contracts and stay in namespaced metadata.
