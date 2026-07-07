---
name: Bug report
about: Create a report to help us improve the product
title: 'fix: '
labels: bug
assignees: ''
---

## Problem statement

**Expected behavior:**

<!-- What should have happened? -->

**Actual behavior:**

<!-- What actually happened? -->

## Steps to reproduce

<!-- Crucial for Playwright E2E tests and debugging -->

1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

## Environment

- **Environment:** [e.g., Local, Staging, Production]
- **Browser:** [e.g., Chrome, Safari] (if applicable)

## Logs / Screenshots

<!-- Drop stack traces or visual evidence here -->

## Workflow classification

- **Profile:** bounded | standard | high-assurance
- **Risk:** low | medium | high
- **Effort:** low | medium | high
- **Change surfaces:** docs | UI | service | API | data | infra | security

### Bounded Lane B eligibility and validation

- [ ] Proposed paths and surfaces satisfy bounded rules
- [ ] Agent applied three-level judgment for `node scripts/validate-bounded.mjs` (and diff is safe for Lane B)
- [ ] Bug is isolated to docs, UI components, strings, or copy
- [ ] No routes, middleware, server actions, auth, RLS, schema, billing, or core logic
- [ ] No CI workflow, deployment configuration, or production permission changes

_Lane B is provider-neutral. Use `for-implementation:<agent>` only for asynchronous routing._
