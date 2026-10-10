# ADR 014 — Remove the optional AI Foundry Desk provider

**Status:** Accepted by explicit maintainer direction on 2026-10-10
**Date:** 2026-10-10
**Amends:** [ADR 004](004-separate-sdlc-policy-from-harness-execution.md) decision only where it
said AI Foundry Desk may supply capabilities. The rest of ADR 004, including the rule that
AgentFlow must not copy AFD orchestration or infer support from a harness name, is unchanged.

## Context

ADR 004 allowed AI Foundry Desk to act as an optional project-harness provider behind the versioned
provider port, limited to what its pinned contract proved. AgentFlow shipped a capability-limited
provider for it, a pin check and usage documentation. AI Foundry Desk is discontinued, so adopters
met a provider that no longer exists as a live choice.

## Decision

AgentFlow no longer ships, discovers, pins or documents an AI Foundry Desk provider. The provider,
its pin check and its usage guide are removed. AgentFlow adds no replacement provider, compatibility
shim or alias.

The versioned provider port, the other built-in providers and the generic extension point for
caller-registered providers stay as they are. A project or library consumer can still register its
own provider through that extension point.

Release notes and ADR 004 context that describe the earlier work stay as history.

## Consequences

**Positive:** AgentFlow no longer offers a dead integration, and the provider catalog lists only
providers that exist. Harness neutrality is unchanged.

**Negative:** This is compatibility-impacting for projects that used the provider. Shipped
discovery no longer lists it, inspecting it fails like any other unknown provider, and the
provider-specific catalog option has no effect.
