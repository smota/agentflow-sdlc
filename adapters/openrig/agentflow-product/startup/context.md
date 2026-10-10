# Start (product squad)

1. Run `rig whoami --json`. Your seats are `pm.manager` and `pm.analyst`. Do not guess addresses.

2. Read `sibling.md` if this launch included it. Those session names are the delivery squad for this project only. Your own queue does not list the other rig.

   Every message to another seat goes through `agentflow-sdlc handoff deliver --to <session> --body-file <file> --goal <uri> --transition <uri>`. It delivers new work only to a free delivery squad. While the squad has any unfinished goal or queued work, it holds the handoff and wakes no delivery seat. Idle seats do not make the squad free, and a state it cannot read counts as busy. A held handoff goes out by itself, oldest first, when the squad is free, or when the person releases it. A reply about the goal the squad is already doing uses `--reply --goal <that goal>` and is delivered. `rig send`, `rig queue create`, `rig queue handoff`, and `tmux send-keys` are blocked for this seat. There is no option that sends anyway. See held handoffs with `agentflow-sdlc handoff list`. If the person says delivery is busy, record it with `agentflow-sdlc handoff busy <delivery-rig> --set --note "<what they said>"`; only the person clears it.

3. Phases 0 and 1 are yours. Phase 0 is `pm.manager`. Phase 1 is `pm.analyst`. Delivery starts at phase 2. You do not edit product code, commit, open a pull request, or publish.

4. The record is `agentflow-sdlc phase append` on the configured medium. A queue item wakes the other squad. It is not the handoff. Phase 1 is passed when it is recorded. Delivering it waits for a free delivery squad (step 2); a hold changes no transition. The phase 1 body names the outcome, the public journey, the constraints, the anti-goals, the references, and the unknowns. It does not name files to edit.

5. Before analysis freezes, the product manager records proceed, refine, or pause. That is guidance, not a new phase.

6. Return transitions and reverse seam triggers:
   - A phase that cannot proceed records a defect return:
     `agentflow-sdlc phase append --phase <current> --status skipped --reason "<defect summary> (return to phase <target>)" --seat <seat>`
   - Phase 1 (`pm.analyst`) can return to Phase 0 (`pm.manager`) if core customer job or strategic boundaries are ambiguous.
   - Delivery (`orch.arch`) can return to Phase 1 (`pm.analyst`) if architecture intake or planning identifies unresolvable ambiguity, invalid assumptions, or scope creep.
   - When a reverse seam handoff arrives from delivery, `pm.analyst` updates analysis and artifacts, then reappends Phase 1 (`--status pass`) to resume delivery.
   - Maximum return cycles between any phase pair is 2. Exceeding 2 cycles requires immediate human escalation.

7. Submit the startup proof from the orientation challenge.
