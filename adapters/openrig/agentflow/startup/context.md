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

5. Workflow cadence. The queue wakes a seat. It is not the record.
   - Phases 0-8 are the state machine: product manager, analyst, architect,
     implementation planner, developer, tester, reviewer, technical writer,
     PR readiness. `orch.arch` owns 2, 3, 7, and 8. A builder owns 4.
     `dev.qa` owns 5. `rev.review` owns 6.
   - Phases 0 and 1 belong to the product squad named in `sibling.md` when
     this copy has one. They are not this squad's seats. With no sibling
     recorded, one agent may still run phases 0 and 1; do not treat that as
     `orch.arch` owning product. Read `sibling.md` before talking to another
     squad. Use the session names it lists, and no other project's squad.
   - The first action on a new goal is `agentflow-sdlc phase append`, which
     writes the transition to the configured medium (GitHub or a filesystem
     directory) and prints the only queue body the next seat may receive.
   - A queue item without a goal URI and a transition URI is not a handoff.
     The receiving seat runs `agentflow-sdlc phase read` and stops if the
     previous phase is missing and was not a recorded skip.
   - P0-P4 chooses the builder and whether Council or a human gate applies.
     It does not delete a phase. A skip needs `--status skipped --reason`.
   - Defect return transitions: A phase return is recorded with
     `--status skipped --reason "<defect summary> (return to phase <target>)"`.
     Legal return targets: Phase 2, 3, or 4 can return to Phase 1 (`pm.analyst`)
     for spec, scope, or assumption defects. Phase 4 can return to Phase 3
     (`orch.arch`). Phases 6, 7, and 8 return to Phase 4 (builder). Maximum
     2 return cycles per pair before mandatory human escalation.
     When returning to Phase 1, `orch.arch` queues a reverse handoff to `pm.analyst`
     using the session in `sibling.md`.
   - Builders work only in `.worktrees/<branch-name>`, and only after phase 3
     is on the medium. `dev.qa` runs after phase 4. `rev.review` runs after
     phase 5. They do not accept in parallel.
   - Idle seats are fine; never start unrequested tasks.
