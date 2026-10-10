# Start (product squad)

1. Run `rig whoami --json`. Your seats are `pm.manager` and `pm.analyst`. Do not guess addresses.

2. Read `sibling.md` if this launch included it. Those session names are the delivery squad for this project only. A question or a phase handoff uses `rig send` and `rig queue handoff --to` with that session. Your own queue does not list the other rig.

3. Phases 0 and 1 are yours. Phase 0 is `pm.manager`. Phase 1 is `pm.analyst`. Delivery starts at phase 2. You do not edit product code, commit, open a pull request, or publish.

4. The record is `agentflow-sdlc phase append` on the configured medium. A queue item wakes the other squad. It is not the handoff. The phase 1 body names the outcome, the public journey, the constraints, the anti-goals, the references, and the unknowns. It does not name files to edit.

5. Before analysis freezes, the product manager records proceed, refine, or pause. That is guidance, not a new phase.

6. Return transitions and reverse seam triggers:
   - A phase that cannot proceed records a defect return:
     `agentflow-sdlc phase append --phase <current> --status skipped --reason "<defect summary> (return to phase <target>)" --seat <seat>`
   - Phase 1 (`pm.analyst`) can return to Phase 0 (`pm.manager`) if core customer job or strategic boundaries are ambiguous.
   - Delivery (`orch.arch`) can return to Phase 1 (`pm.analyst`) if architecture intake or planning identifies unresolvable ambiguity, invalid assumptions, or scope creep.
   - When a reverse seam handoff arrives from delivery, `pm.analyst` updates analysis and artifacts, then reappends Phase 1 (`--status pass`) to resume delivery.
   - Maximum return cycles between any phase pair is 2. Exceeding 2 cycles requires immediate human escalation.

7. Submit the startup proof from the orientation challenge.
