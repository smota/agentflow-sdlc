# ADR 002 — Distribution via npx skills + a companion sync CLI

**Status:** Accepted
**Date:** 2026-07-07

## Context

The framework needs to reach multiple, independent project repos and stay updated in all of them
without manual copy-paste drift. Two kinds of content need distribution:

1. Skill-shaped content (role personas, workflow skills) — already has a proven mechanism: the
   `skills` npm package (`npx skills add <source>`), used successfully in Ativaly to pull in
   external skill sources (Supabase, Stripe, JTBD).
2. Repository-infrastructure content (git hooks, `.claude/settings.json` wiring, issue/PR
   templates, generic validator scripts, ADR practice) — not skill-shaped, and `npx skills` has no
   mechanism for it.

A single mechanism that tried to cover both would either abuse the skills package for non-skill
files or reinvent skill installation for no benefit.

## Decision

Use two complementary channels from this one repo:

- **`npx skills add <this-repo>`** for skill-shaped content only (workflow skills, role personas).
- **A companion Node.js CLI** (`init` / `sync` / `doctor`), published from this same repo, for
  everything else. It tracks installed framework files in a committed lockfile
  (path → version/hash) so `sync` can safely overwrite files unmodified since the last sync and
  flag — never silently clobber — anything a project has locally edited. `doctor` reports drift
  against that lockfile.

## Consequences

**Positive:** no new tooling for the content type that already has a working mechanism; a purpose-
built, minimal CLI for the rest; safe re-sync without a full 3-way-merge engine.

**Negative:** two channels to keep mentally separate; the sync CLI must be built and maintained
(tracked as a separate implementation issue) — this ADR records the decision, not the
implementation.
