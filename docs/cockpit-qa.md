# Cockpit QA, security review, and non-Docker rollout

Docker deployment is intentionally a second pass. This checklist covers local and remote Node-service deployment.

## Manual QA script

1. Start read-only local mode:
   ```bash
   AGENTFLOW_REPOSITORIES=smota/agentflow-sdlc GITHUB_TOKEN=<read-token> pnpm cockpit
   ```
2. Open `/` and verify Goal Board loads.
   - View tabs include Goals, Releases, Reviews, and Follow-ups.
   - Release dashboard is first-class, above the goal workspace.
   - Release metrics include awaiting release, missing release notes, and release blockers.
3. Open `/issues/119` and verify:
   - Goal detail has a back link to Goal Command Center.
   - Compact goal header uses stable grammar: identity, status/path/release badges, then actions.
   - Source is an external header action, not mixed into conceptual badges.
   - Selected Path and Version / Release Lens appear in the summary strip.
   - Human review status is explicit when required by high-assurance path.
   - Next-best-actions render as compact row cards.
   - Role Flow Contributions render icon/status first instead of generic timeline framing.
   - Readiness Health renders icon/color state markers, score, denominator, excluded skipped/not-applicable checks, and hover/focus detail.
   - Relationship Map renders only when relationships exist and explains its navigation purpose.
   - Activity & Decisions hides empty lanes or shows a compact empty state.
   - Guarded actions panel says server-side auth/CSRF/audit required.
4. Open `/issues/127/replay` and verify Goal Story replay.
   - Navigation links back to Goal detail and Goal Command Center.
   - Timeline clearly says `Oldest → newest`.
   - Events render on a vertical flow line ending at Current state.
   - Page copy says how the goal moved from intent to current state.
5. Open `/issues/127/replay.md` and verify markdown export.
6. Confirm replay page says read-only reconstruction and has no rerun/execute control.
7. Confirm no raw transcript, prompt, tool input, secret, or full log content appears.

## Remote OAuth QA

1. Create GitHub OAuth app with callback `${COCKPIT_PUBLIC_URL}/oauth/callback`.
2. Start remote mode behind HTTPS reverse proxy:
   ```bash
   COCKPIT_REMOTE=true \
   COCKPIT_PUBLIC_URL=https://cockpit.example.com \
   COCKPIT_SESSION_SECRET=<32+ chars> \
   GITHUB_CLIENT_ID=<id> \
   GITHUB_CLIENT_SECRET=<secret> \
   GITHUB_ALLOWED_USERS=<login> \
   AGENTFLOW_REPOSITORIES=smota/agentflow-sdlc \
   pnpm cockpit
   ```
3. Verify unauthenticated requests redirect to `/login`.
4. Verify unauthorized GitHub user is denied.
5. Verify logout clears session.
6. Verify security headers exist on HTML responses.

## Guarded action QA

Only run against a disposable issue.

1. Start with `COCKPIT_WRITE_ACTIONS=true`.
2. Submit action without CSRF token: expect `csrf-invalid`.
3. Submit without confirmation header: expect `confirmation-required`.
4. Submit forbidden action through API: expect `forbidden-by-policy`.
5. Submit allowed `post-handover`: verify GitHub comment link returned and `audit.jsonl` entry written.

## Runner telemetry QA

1. Start with `COCKPIT_RUNNER_TELEMETRY=true`.
2. Submit sanitized event to `/telemetry`: expect `ok: true`.
3. Submit event with `prompt`, `toolInput`, `secret`, or `rawLog`: expect rejection.
4. Verify telemetry is labeled non-authoritative.

## Security checklist

- [ ] GitHub OAuth configured for remote mode.
- [ ] Allowlist configured with users, org, or team.
- [ ] Repository permission checks enforced.
- [ ] Session secret at least 32 chars.
- [ ] Secure cookies in remote mode.
- [ ] CSRF token required for write actions.
- [ ] Security headers present.
- [ ] Rate limiting enabled.
- [ ] Audit log enabled for writes and auth.
- [ ] Raw transcripts/prompts/tool inputs/secrets/full logs absent from UI, replay, exports, and telemetry.
- [ ] Human security review completed before public exposure.

## Non-Docker deployment notes

Use a process manager such as systemd, pm2, or a platform process runner. Terminate TLS in a reverse proxy such as Caddy, Nginx, Traefik, or a managed load balancer. Configure `COCKPIT_PUBLIC_URL` to the public HTTPS origin. Keep secrets in the platform secret store, not in committed files.

## Rollback / disable

- Disable remote access by stopping the service or removing reverse proxy route.
- Disable writes with `COCKPIT_WRITE_ACTIONS=false`.
- Disable telemetry with `COCKPIT_RUNNER_TELEMETRY=false`.
- Remove OAuth app credentials if compromised.

## Goal Command Center UX checklist

- [ ] Header uses repo-local AgentFlow logo and product palette.
- [ ] Home page answers what goal needs attention and why within one screen.
- [ ] Top metrics, highlight zone, and next-best-actions are visible above the goal list.
- [ ] GitHub issue/PR/comment language is secondary to goal, confidence, evidence, next action, and follow-ups.
- [ ] Fail-safe states avoid generic `unknown` warnings except real errors.
- [ ] Header hides local token implementation detail and labels the repository as Workspace.
- [ ] Goal Story appears as a styled action, not an unstyled utility link.
- [ ] Readiness Health behaves like a health check with score, dimensions, denominator, and floating details.
- [ ] Skipped-by-path roles explain why they were skipped and do not reduce score.
- [ ] Release dashboard is a first-class view with release candidate, target branch, awaiting-release goals, missing notes, and blockers.
- [ ] Version / Release Lens distinguishes merged, awaiting release, delivered/closed, and no-release-impact states.

## Release checklist

- [ ] `pnpm test` passed.
- [ ] Manual QA script passed.
- [ ] Security checklist reviewed.
- [ ] Docs reviewed.
- [ ] Docker explicitly deferred to later issue/pass.
