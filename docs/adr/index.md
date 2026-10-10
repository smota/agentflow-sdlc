# Architectural Decision Records

All significant decisions about this framework are recorded here. Read these before changing
anything the decisions govern.

New decisions get the next available number.

---

## Index

| ADR                                                                              | Title                                                                                     | Status                                                                                       | Date       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------- |
| [ADR 001](001-role-based-single-agent-workflow.md)                               | Role-based single-agent, phase-driven workflow                                            | Accepted                                                                                     | 2026-07-07 |
| [ADR 002](002-npx-skills-plus-sync-cli-distribution.md)                          | Distribution via npx skills + a companion sync CLI                                        | Accepted                                                                                     | 2026-07-07 |
| [ADR 003](003-cross-platform-node-tooling-no-shell-scripts.md)                   | Cross-platform Node.js tooling, no bash/PowerShell scripts                                | Accepted                                                                                     | 2026-07-07 |
| [ADR 004](004-separate-sdlc-policy-from-harness-execution.md)                    | Separate SDLC policy from harness execution                                               | Accepted                                                                                     | 2026-09-01 |
| [ADR 005](005-versioned-provider-and-source-ports.md)                            | Versioned provider and source ports                                                       | Accepted                                                                                     | 2026-09-01 |
| [ADR 006](006-preview-first-transactional-adoption.md)                           | Preview-first transactional adoption                                                      | Accepted                                                                                     | 2026-09-01 |
| [ADR 007](007-verifiable-recoverable-delivery.md)                                | Verifiable and recoverable delivery                                                       | Implemented proposal; high-assurance review and release acceptance pending                   | 2026-09-03 |
| [ADR 008](008-single-skill-name.md)                                              | One public name for each AgentFlow skill                                                  | Accepted by explicit maintainer direction on 2026-09-25                                      | 2026-09-25 |
| [ADR 009](009-incremental-onboarding.md)                                         | Incremental onboarding, runtime-owned installation, and explicit legacy/unknown migration | Accepted; supersedes the previous broad no-legacy policy specifically via explicit migration | 2026-09-25 |
| [ADR 010](010-delegation-origin-assurance-and-admitted-action-race-semantics.md) | Delegation origin, assurance, and admitted-action race semantics                          | Proposed                                                                                     | 2026-09-25 |
| [ADR 011](011-versioned-persistence-and-portable-continuation.md)                | Versioned persistence and portable continuation                                           | Proposed                                                                                     | 2026-09-25 |
| [ADR 012](012-execution-provider-and-observability-boundaries.md)                | Execution-provider and observability boundaries                                           | Proposed                                                                                     | 2026-09-25 |
| [ADR 013](013-remove-optional-meshloop-adapter.md)                               | Remove the optional Meshloop adapter                                                      | Accepted by explicit maintainer direction on 2026-10-09; supersedes ADR 012 decision 12 only | 2026-10-09 |
| [ADR 014](014-remove-optional-ai-foundry-desk-provider.md)                       | Remove the optional AI Foundry Desk provider                                              | Accepted by explicit maintainer direction on 2026-10-10; amends ADR 004 decision only        | 2026-10-10 |

---

## Writing a new ADR

Use this template and save as `docs/adr/NNN-short-title.md`:

```markdown
# ADR NNN — Title

**Status:** Proposed | Accepted | Superseded by ADR NNN
**Date:** YYYY-MM-DD

## Context

Why this decision was needed.

## Decision

What was decided.

## Consequences

**Positive:** …
**Negative:** …
```
