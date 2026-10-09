# Start (every seat on the agentflow rig)

1. Run `rig whoami --json`. It names your seat and your peers' sessions. Use
   those names; do not guess addresses. During launch a peer may not be listed
   yet: if one of the squad seats (`orch.arch`, `dev.build-jr`, `dev.build`,
   `dev.build-sr`, `dev.qa`, `rev.review`) is missing, check `rig ps --nodes`
   again a little later before assuming it failed.

2. Find the repository you work in: `git rev-parse --show-toplevel`. If that
   fails, or your working directory is this rig's own folder, the rig was
   launched without `--cwd`. Stop and report it.

3. Get the big picture before anyone changes anything:
   - Read the target repository's documentation: `README.md`, `ARCHITECTURE.md`,
     `CONTRIBUTING.md`, `AGENTS.md`, or `.agentflow/` configuration.
   - Note the project's build, lint, and test commands.
   - Confirm that `.worktrees/`, `CLAUDE.local.md`, and `AGENTS.md` are ignored
     in `.git/info/exclude`.

4. Submit your startup proof:
   Run the `rig startup-proof submit` command from the orientation challenge
   in your startup text. It proves to OpenRig and the Architect Lead that you
   received and processed your start instructions.

5. Workflow cadence:
   - `orch.arch` starts from the person's goal and scopes the mission, selecting
     the appropriate workflow profile (P0-P4) and convening Council if needed.
   - Builder seats (`build-jr`, `build`, `build-sr`) wait for scoped briefs from `orch.arch`.
   - Builders work exclusively in `.worktrees/<branch-name>`.
   - `dev.qa` and `rev.review` check builder commits in parallel upon notification.
   - Idle seats are fine; never start unrequested tasks.
