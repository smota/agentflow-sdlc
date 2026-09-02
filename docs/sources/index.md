# Source adapter path

Source adapters connect AgentFlow artifacts and lifecycle actions to a durable external system.
They expose read and mutation capabilities separately and return portable `ArtifactRef` values.

GitHub is the first implementation. It is the default operational substrate, not the AgentFlow
domain model. A new source adapter must preserve artifact authority, lifecycle semantics, action
boundaries, idempotency, and mutation receipts.

See [GitHub](github.md) and the [modular architecture](../modular-architecture.md).
