# AgentFlow Cockpit

AgentFlow Cockpit is the optional Goal Command Center for goal-oriented SDLC delivery. It turns
source-adapter projections, role-pass evidence, validation, and follow-ups into goals, evidence
health, role flow contributions, graph navigation, next-best-actions, and replayable goal stories.

Cockpit is optional at runtime and first-class in the AgentFlow SDLC product. Core, CLI, and source
adapters remain authoritative and fully usable without Cockpit. Adoption, validators, skills,
plugins, and settings merge must not require a running Cockpit server.

For the implemented product vocabulary and rules, see [`docs/cockpit-concepts-and-rules.md`](cockpit-concepts-and-rules.md). Use that document when reviewing SDLC roles, skills, and agents.

## Product principles

- The configured source adapter supplies durable truth; GitHub is the implemented default.
- Local or runner telemetry is optional and non-authoritative.
- Single-agent, multi-role execution remains default.
- Helpers are advisory unless role attribution proves a valid multi-agent handoff.
- High-assurance work still requires human security/acceptance review.
- Follow-up issues are first-class; hidden TODOs are not.
- No raw model transcripts, prompts, tool inputs, secrets, or hidden runner state in the UI.

## CLI

```bash
AGENTFLOW_REPOSITORIES=owner/repo node bin/cli.mjs cockpit
node bin/cli.mjs cockpit doctor --json
```

`cockpit doctor` validates package files and runtime configuration. AgentFlow maintainers run
`node scripts/cockpit-smoke.mjs` from the AgentFlow package checkout as a release gate; that
package-only script is not installed into consuming repositories.

## MVP authentication

Remote-capable Cockpit uses GitHub OAuth as the MVP authentication option.

Required controls:

- GitHub OAuth login.
- Allowlisted users, orgs, or teams.
- Repository permission checks for each managed repo.
- Secure sessions and logout.
- CSRF and origin checks for write-capable actions.
- Audit log for every guarded action.
- Remote mode defaults read-only until write actions are explicitly enabled.

## Project linking

For MVP, a Cockpit project is a registered GitHub repository, for example `smota/agentflow-sdlc`.

Cockpit reads:

- `AGENTS.md`
- `agent-workflow.config.json`
- issue bodies and labels
- issue comments and markers
- PR bodies and checks
- commits and closure metadata

Cockpit does not require a mounted repo checkout in remote mode. Future Docker deployment should use repository allowlists and GitHub API first; local runner telemetry can be added later as sanitized optional events.

## Opinionated views

### Goal Command Center

Shows top metrics, a highlight goal, next-best-actions, goal health, follow-ups, and human gates. GitHub issue details are secondary metadata; the primary language is goal, confidence, evidence, next action, and role flow.

### Epic View

Rolls up child issues, dependencies, acceptance matrix, risk, active workstreams, PRs, follow-ups, and decisions.

### Goal Detail, Selected Path, and Role Flow Contributions

Shows the selected path/profile/risk first, then phases 0-8 as role contributions rather than a generic timeline. Roles can be complete, skipped by path, not applicable, not started, needs attention, blocked, or error:

1. Product manager / JTBD
2. Analyst
3. Architect
4. Developer planning
5. Developer
6. Tester
7. Review
8. Tech writer
9. PR readiness

Each role card shows completion first. Supporting evidence is detail/proof behind the role status. Roles skipped by selected path explain why and do not reduce readiness.

### Readiness Health

Reports governance completeness as a path-aware score with explainable dimensions, not model confidence. The denominator includes only applicable checks; skipped-by-path and not-applicable checks are excluded:

- Scope.
- Design.
- Implementation.
- Validation.
- Review/gates.
- Follow-ups.

Missing optional evidence is shown with fail-safe copy instead of generic `unknown` warnings.

### Version / Release Lens

Shows whether the goal is in progress, merged, awaiting release, or delivered/closed. It also surfaces target branch, release impact, candidate version when known, and release-note state. This reinforces that merged work is not always delivered work.

### Comments lanes

Comments are grouped by workflow purpose using markers/templates:

- Workflow Status
- Handover
- Decisions
- Clarifications
- Review Findings
- Validation
- Follow-ups

## Goal Story replay

Goal Story replay is a read-only reconstruction of how a goal moved from intent to outcome. It does not rerun agents and does not mutate GitHub.

Replay sources, in precedence order:

1. GitHub issue and PR durable state.
2. Workflow-status, handover, validation, review, and follow-up comment markers.
3. PR commits, merge status, and check summaries.
4. Optional sanitized runner events in a later version.

Replay groups events into AgentFlow sections:

- Goal
- Scope
- Role timeline
- Decisions
- Validation
- Review/Gates
- PR readiness
- Outcome
- Follow-ups

The UI defaults to compact mode for short goals and marks evidence as durable, inferred, missing, or stale. Missing evidence is shown explicitly instead of invented. Markdown export is available for sharing in GitHub comments or postmortems.

Current routes:

- `/issues/<number>/replay` — HTML Goal Story replay.
- `/issues/<number>/replay.md` — markdown export.

## Guarded actions

Write-capable actions are structured and auditable:

- add clarification
- request checkpoint
- request human review
- draft follow-up issue
- update issue section
- post handover
- start next phase

Forbidden actions include remote gate bypass, marking validation/review passed, weakening acceptance criteria silently, deleting evidence, and merge-by-chat.

## Running the MVP server

Cockpit currently ships as a minimal Node service:

```bash
AGENTFLOW_REPOSITORIES=smota/agentflow-sdlc \
GITHUB_TOKEN=ghp_readonly_or_fine_grained_token \
pnpm cockpit
```

Remote mode requires GitHub OAuth configuration:

```bash
COCKPIT_REMOTE=true \
COCKPIT_PUBLIC_URL=https://cockpit.example.com \
COCKPIT_SESSION_SECRET=32-plus-character-secret \
GITHUB_CLIENT_ID=... \
GITHUB_CLIENT_SECRET=... \
GITHUB_ALLOWED_USERS=samue \
AGENTFLOW_REPOSITORIES=smota/agentflow-sdlc \
pnpm cockpit
```

Available surfaces:

- `/healthz` — health check.
- `/` — Goal Board for registered repository.
- `/issues/<number>` — issue SDLC view.
- `/login`, `/oauth/callback`, `/logout` — GitHub OAuth flow for remote mode.
- `POST /actions` — guarded write gateway when `COCKPIT_WRITE_ACTIONS=true` and request includes `X-Cockpit-Confirm: true`.

## Future Docker deployment

Docker is a second-pass packaging option, not an MVP dependency. Current implementation stays Docker-ready by using environment configuration, stateless server boundaries, GitHub API as primary data source, `/healthz`, and no mandatory local repo mount.
