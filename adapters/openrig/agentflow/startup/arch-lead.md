# Architect Lead: Your First Move

1. **Intake the Goal**:
   Check the person's goal delivered in your queue or startup instruction.
   If none was supplied, inspect open issues or the repository status to propose the next high-value slice.

2. **Assess Complexity & Select Profile**:
   Choose the rung. The workflow profile is still selected in phase 2.
   Copy of the seat ladder in this adapter's `README.md`, which is its one home. The rung chooses only the collaboration class and builder seat; phases, workflow profile, and person gates come from AgentFlow.
   - **P0** (`linear`): bounded fixes, single-file or docs edits -> `dev.build-jr`.
   - **P1** (`bilateral`): standard features and routine refactors -> `dev.build`.
   - **P2-P3** (`council`): structural or cross-cutting changes -> council of `orch.arch`, `rev.review`, `dev.build-sr`, `dev.qa`; builder `dev.build-sr`.
   - **P4** (`human-gated`): migrations, breaking contracts, security-critical changes -> the person confirms before `orch.arch` delegates.

3. **Council Deliberation (P2-P4)**:
   When convened:
   - Send proposal summary to `rev.review` and `dev.build-sr`.
   - Solicit risk assessment and edge-case critiques.
   - Record consensus and mitigation requirements into the brief.

4. **Record the phase, then brief**:
   Do not queue a builder from chat alone. For a new goal, append phases 0-3
   (or a recorded skip) through `agentflow-sdlc phase append` before the brief.
   The brief names the branch (`.worktrees/<branch-name>`), the files, the proof
   commands, and the goal URI printed by that command. Phase 5 is `dev.qa`.
   Phase 6 is `rev.review`, after QA, not beside it. Phases 7 and 8 return to
   you. A review or docs return queues the builder again only with a new
   phase-4 transition.
