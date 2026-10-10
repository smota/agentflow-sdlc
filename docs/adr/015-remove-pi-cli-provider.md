# ADR 015 — Remove the pi-cli provider

**Status:** Accepted under the standard admission on #371 (capability #393) on 2026-10-10
**Date:** 2026-10-10

## Context

AgentFlow shipped a `pi-cli` provider beside the Claude, Codex, Agy, and Grok providers. That made
Pi look like a choice of execution layer. Pi is a runtime platform and a harness adapter. The
execution layer that runs Pi seats is OpenRig. Supervising projects from the Cockpit (#371) needs one
meaning for source adapter, execution layer, coordinator, runtime platform, and harness adapter.

## Decision

AgentFlow no longer ships or discovers a `pi-cli` provider. A configured engineering provider of
`pi-cli`, or `providers inspect pi-cli`, fails with a message that names the replacement: the OpenRig
execution layer runs Pi seats, or the project configures another provider.

Pi stays a runtime platform, a routable platform with its `pi-parent`, `pi-subagent`, `pi-session`,
and `pi-subagent-model` execution targets, and a harness adapter. The
[glossary](../glossary.md) holds the five definitions. An execution layer choice is OpenRig or none.

## Consequences

**Positive:** Pi is no longer offered as an execution layer, and each term has one meaning.

**Negative:** This is compatibility-impacting for a project whose `delivery.engineeringProvider`
names `pi-cli`. That configuration now fails until it names another provider.
