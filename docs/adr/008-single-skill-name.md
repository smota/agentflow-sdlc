# ADR 008: One public name for each AgentFlow skill

**Status:** Accepted by explicit maintainer direction on 2026-09-25.

## Context

Short source names, colon-qualified catalog names and hyphenated adapter names made the same six skills appear under different identities in libraries and hosts. The maintainer requested one invocation name, without backwards compatibility.

## Decision

Use `agentflow-<skill>` as the public name everywhere: source directory, SKILL.md frontmatter, catalog qualifiedName, generated adapters, plugin payload and library metadata. The six skills are agentflow-auditor, agentflow-collaborator, agentflow-designer, agentflow-migrator, agentflow-orchestrator and agentflow-scanner.

Role slugs inside ownership and handoff data remain structural identifiers, not alternative skill invocation names. Lifecycle-role identities are a separate contract and are unchanged.

## Consequences

This intentionally breaks short and colon-separated skill invocation names. No aliases are shipped. Consumers refresh the six skills from their new source paths and update indexed library metadata. Existing library IDs and deployment selections should be preserved when the manager supports in-place reimport. A host may apply its own plugin command syntax; the skill's name remains unchanged.

Catalog and adapter tests reject legacy frontmatter names and verify all six canonical names in packaged payloads. Historical ADRs and release notes describe the decisions and releases they originally recorded.
