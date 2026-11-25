# Milestone admission

Each milestone of the [governed-factory design](../designs/governed-factory.md) is a goal under
`goals/`: the program goal `goals/gf` and one goal per milestone (`goals/gf-week-0`,
`goals/gf-m0`, `goals/gf-m1`, `goals/gf-m2`, `goals/gf-m2b`, `goals/gf-m3`, `goals/gf-m4`,
`goals/gf-m5`). Each milestone goal's Outcome section lists its exit criteria. No work under a
milestone starts until the author has admitted that milestone through its admission gate.

An admission gate is a [person gate](../person-gates.md) of class `adequacy-of-intent`. It binds to
the goal's current text and a change class, so editing the goal makes an earlier answer stale. Only
the author answers it. An agent may open a gate, but must never answer one, and `gates answer`
refuses to run under an agent runtime.

## Admit a milestone

1. Read the milestone goal:

   ```bash
   agentflow-sdlc phase read --medium filesystem --root goals/gf-m0
   ```

2. Open its admission gate at the change class the milestone's work uses. An agent may do this
   step:

   ```bash
   agentflow-sdlc gates open --medium filesystem --root goals/gf-m0 --change-class standard --role person
   ```

3. List the gates that wait for you, and copy the full gate digest:

   ```bash
   agentflow-sdlc gates waiting --medium filesystem --root goals --json
   ```

4. Answer the gate in your own terminal, outside any agent session:

   ```bash
   agentflow-sdlc gates answer --medium filesystem --root goals/gf-m0 --gate <digest> --decision agree --person <your-name>
   ```

   Use `--decision changes-requested` or `--decision blocked` with `--finding <text>` to send the
   milestone back.

5. Commit the updated goal directory in a PR. The gate record is part of the goal.

## What the answer means

- `agree` admits work of that change class under the milestone.
- A refused or stale gate admits nothing, and work under the milestone stays stopped.
- Answers given before signed human acts exist (week 0, M0 and M1, until design item M1-13) are
  recorded as unsigned. Later answers are signed acts.
- A gate that nobody answers stays waiting. Nothing proceeds on a waiting gate.
