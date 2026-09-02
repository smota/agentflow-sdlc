# AgentFlow Cockpit concepts and rules

This document defines the Cockpit product concepts and implemented rules. Use it as review input for SDLC roles, skills, agent prompts, and future issue standards.

## Purpose

AgentFlow Cockpit is the Goal Command Center for AgentFlow-managed delivery. It turns durable workflow records into a navigable operational view of goals, releases, role flow, readiness, approval gates, follow-ups, and safe workflow actions.

Cockpit is not a source-system dashboard. It consumes a `SourceAdapter`; GitHub is the implemented
default storage and sync substrate. Product language leads with AgentFlow concepts, and source links
remain secondary.

## Primary navigation axes

### Workspace

A workspace is one configured repository from `AGENTFLOW_REPOSITORIES` or `COCKPIT_REPOSITORIES`.

Rules:

- If one repository is configured, show it as `Workspace: owner/repo`.
- If multiple repositories are configured, show a Workspace selector.
- Workspace switching uses `repo=owner/repo` in the URL.
- Workspace selector includes a visible `Switch` button and also submits on `onchange`.
- Issue, replay, dashboard, and guided-action links preserve `repo=`.
- Unknown repositories are rejected server-side.

### View

Dashboard views are URL-backed. They are navigation, not decorative tabs.

Implemented values:

- `view=goals` — goal command workspace.
- `view=releases` — release-first dashboard.
- `view=reviews` — review and human approval gate queue.
- `view=follow-ups` — follow-up queue.

Rules:

- Active view is styled.
- Browser back/forward should preserve view state.
- View links preserve selected workspace.

### Release filter

Release filtering applies in `view=releases`.

Implemented values:

- `release=unreleased` — default release queue; all release-impact goals not yet released.
- `release=released` — goals considered released/delivered.
- `release=all` — all release-impact goals.
- `release=needs-assignment` — release-impact goals missing explicit target release.
- Future: `release=vX.Y.Z` for a specific planned/released version.

Rules:

- Release filter links preserve selected workspace.
- Unreleased work is the default because it is most actionable.
- Release dashboard shows release candidate, target branch, unreleased count, released count, needs-assignment count, missing release notes, and blockers.

## Release model

Release is a first-class delivery lens. It answers: what ships, what is waiting, what lacks assignment, and what blocks release readiness.

### Candidate release source

Candidate version must come from explicit workflow/repo delivery data only.

Accepted sources:

1. Issue body fields such as `Release: vX.Y.Z`, `Target release: vX.Y.Z`, or `Version: vX.Y.Z`.
2. Milestone title exactly matching a release version like `vX.Y.Z`.

Rules:

- Incidental semver mentions in body text, logs, package versions, runtime versions, or test output must not become release candidates.
- If no explicit candidate exists, show `Next release`.

### Release impact

Implemented release impact states:

- `major`
- `minor`
- `patch`
- `docs-only`
- `none`
- `unknown`

Rules:

- `no release impact` or `internal-only` means no release assignment required.
- Feature/minor labels imply release impact.
- Bug/fix labels imply patch impact.
- Documentation signals imply docs-only impact.

### Release assignment state

Implemented assignment states:

- `assigned` — release-impact goal has explicit candidate version.
- `needs-assignment` — release-impact goal has no target release.
- `released` — closed/delivered state with no awaiting-release signal.
- `no-release-impact` — explicitly excluded from release assignment.

Rules:

- `needs-assignment` is a hygiene queue, not an error.
- UI copy should say: “This goal appears to affect delivery but has no target release. Assign it to a release or mark no release impact.”
- Missing release notes are tracked separately from release assignment.

## Goal hierarchy and detail model

Cockpit uses AgentFlow concepts first:

- Goal Group — epic/parent issue.
- Goal — delivery objective.
- Delivery — implementation/PR/merge activity.
- Role Flow — role contributions and skipped-by-path roles.
- Readiness — applicable quality checks.
- Release — target/version/release state.
- Human approval gate — explicit human decision for high-assurance work.
- Follow-up — deferred tracked work.
- Source — external durable record link.

Issue detail header grammar:

1. Identity: `Goal #N` and title.
2. Concept badges: status, goal type, selected path, release state.
3. Actions: `↺ Goal Story`, `Open source ↗`.
4. Health orb as compact readiness summary.

Rules:

- Do not place source links between conceptual badges.
- Source is an external action, not product state.
- Goal Story is a primary navigational action.

## Selected path and readiness rules

Selected path defines which roles and checks apply.

Implemented profiles:

- `bounded`
- `standard`
- `high-assurance`
- `exploratory`

Rules:

- Skipped-by-path roles are excluded from readiness denominator.
- Quality score must not penalize intentionally skipped or not-applicable roles.
- Readiness score is `passed applicable checks / applicable checks`.
- Readiness details should use icons/color first; verbose states stay in tooltip/detail.

Readiness icons:

- `✓` complete/recorded/approved.
- `●` needs attention/not recorded/requested.
- `⊘` skipped/not applicable.
- `■` blocked.
- `!` error.

Visible state words like `recorded` and `needs attention` should not overload primary rows when grade and icon already communicate state.

## Human approval gate

Human approval gate is the practical form of human review.

Used for:

- high-assurance work
- security-sensitive changes
- auth/permission changes
- data migration or data-loss risk
- production deployment risk
- explicit user/project policy

Implemented statuses:

- `not-required`
- `not-requested`
- `requested`
- `approved`

Rules:

- High-assurance path requires a human approval gate.
- Approval can be inferred from PR review approval or workflow text stating human security/acceptance/review approval.
- UI should say “Human approval gate,” not vague “Human review.”
- A complete human gate should record reviewer, scope, decision, and notes in durable workflow records.

Recommended record shape:

```md
## Human approval gate

Reviewer: @login
Scope: security | acceptance | release | other
Decision: approved | changes-requested | blocked
Notes: ...
```

## Goal Story Replay

Goal Story Replay explains how a goal moved from intent to current state.

Rules:

- Replay is chronological by default: oldest to newest.
- UI shows `Oldest → newest`.
- Events render as a vertical timeline with a flow line ending at `Current state`.
- Replay includes navigation back to Goal detail and Goal Command Center.
- Export markdown remains available.
- Replay should avoid internal-only copy such as “reruns agents.”

## Guided workflow actions

Guided workflow actions are safe workflow accelerators. They help users fix workflow state without leaving Cockpit.

Implemented action cards:

- Request human approval gate.
- Add missing clarification.
- Draft follow-up.
- Post handover.

Rules:

- Actions are preview-first.
- Writes require auth, CSRF, confirmation, and audit when enabled.
- Actions should be contextual and explain why they exist.
- Guardrails prevent destructive or remote execution actions.
- Product copy should not frame these as generic “guarded actions”; use “Guided workflow actions.”

## Fail-safe and source rules

Rules:

- Empty sections should explain what is missing and what creates the missing data.
- Normal durable state is silent; only exceptional evidence/source states need badges.
- GitHub issue/PR/comment terminology is secondary to AgentFlow concepts.
- Source links use external-link styling (`↗`).
- No raw transcript, prompt, tool input, secret, or full log content belongs in UI, replay, export, or telemetry.

## Implemented issue scope

This document covers the non-Docker Cockpit work developed through the Goal Command Center sequence:

- Goal Command Center concept and hierarchy.
- Path-aware readiness and version lens.
- Release dashboard and filters.
- Workspace switching.
- Goal detail header grammar.
- Readiness icon/detail model.
- Goal Story Replay timeline.
- Guided workflow actions.
- Human approval gate framing.

Docker deployment remains intentionally excluded from this pass.
