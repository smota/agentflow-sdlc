# AgentFlow Cockpit

AgentFlow Cockpit is the planned optional UI for goal-oriented SDLC delivery. It presents GitHub issues, epics, comments, PRs, role-pass evidence, validation, and follow-ups as AgentFlow workflow state instead of a generic issue list.

Cockpit is optional. The CLI/GitHub workflow remains authoritative and fully usable without Cockpit.

## Product principles

- GitHub is durable truth: issues, comments, PR bodies, commits, closure metadata.
- Local or runner telemetry is optional and non-authoritative.
- Single-agent, multi-role execution remains default.
- Helpers are advisory unless role attribution proves a valid multi-agent handoff.
- High-assurance work still requires human security/acceptance review.
- Follow-up issues are first-class; hidden TODOs are not.
- No raw model transcripts, prompts, tool inputs, secrets, or hidden runner state in the UI.

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

### Goal Board

Shows goals grouped by workflow state: Intake, Scoped, Planned, Implementation, Validation, Review, PR Ready, Done, and Blocked.

### Epic View

Rolls up child issues, dependencies, acceptance matrix, risk, active workstreams, PRs, follow-ups, and decisions.

### Issue SDLC View

Shows phases 0-8:

1. Product manager / JTBD
2. Analyst
3. Architect
4. Developer planning
5. Developer
6. Tester
7. Review
8. Tech writer
9. PR readiness

Each phase shows role-pass completeness, evidence, validation, handover, and next role contract.

### Evidence Health

Reports governance completeness, not model confidence:

- Required policy read state.
- Acceptance criteria.
- Role-pass fields.
- Validation status.
- Review independence.
- Human gate requirements.
- PR manifest readiness.
- Follow-up disposition.

### Comments lanes

Comments are grouped by workflow purpose using markers/templates:

- Workflow Status
- Handover
- Decisions
- Clarifications
- Review Findings
- Validation
- Follow-ups

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
