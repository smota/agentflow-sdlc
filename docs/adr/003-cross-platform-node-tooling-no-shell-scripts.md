# ADR 003 — Cross-platform Node.js tooling, no bash/PowerShell scripts

**Status:** Accepted
**Date:** 2026-07-07

## Context

Consuming projects run on macOS, Linux, and Windows. Shell scripts (`.sh`/`.ps1`) fork behavior per
platform and silently fail in the other. Ativaly established this convention (its own ADR 022) and
it applies without modification to a framework meant to install into any project regardless of the
contributor's OS.

## Decision

Every script this framework ships or installs (git hooks, validators, the sync CLI) is
cross-platform Node.js (`.mjs`), invoked via `node <path>`, never a shell script. Git hooks are
wired via `core.hooksPath` pointing at committed `.mjs`/thin-wrapper files, not copied and
`chmod +x`'d shell scripts.

## Consequences

**Positive:** identical behavior on every contributor's machine and in CI; no chmod/line-ending
issues.

**Negative:** anything that would be a one-line shell script becomes a small Node module instead —
accepted as the cost of portability.
