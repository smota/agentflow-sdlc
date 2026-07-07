# Architectural Decision Records

All significant decisions about this framework are recorded here. Read these before changing
anything the decisions govern.

New decisions get the next available number.

---

## Index

| ADR                                                            | Title                                                       | Status   | Date       |
| -------------------------------------------------------------- | ----------------------------------------------------------- | -------- | ---------- |
| [ADR 001](001-role-based-single-agent-workflow.md)             | Role-based single-agent, phase-driven workflow              | Accepted | 2026-07-07 |
| [ADR 002](002-npx-skills-plus-sync-cli-distribution.md)        | Distribution via npx skills + a companion sync CLI          | Accepted | 2026-07-07 |
| [ADR 003](003-cross-platform-node-tooling-no-shell-scripts.md) | Cross-platform Node.js tooling — no bash/PowerShell scripts | Accepted | 2026-07-07 |

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
