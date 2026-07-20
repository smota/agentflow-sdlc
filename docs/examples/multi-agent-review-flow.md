# Example: optional multi-agent review flow

AgentFlow SDLC is single-agent by default. Multi-agent coordination is useful when independent review, specialist routing, or broad discovery adds real value.

## Scenario

A platform team updates workflow routing behavior and wants implementation by one agent plus independent review by another.

## Evidence requirements

A multi-agent run records a role attribution matrix instead of making a vague claim that "agents collaborated."

```markdown
| Phase | Role      | Planned owner | Actual agent | Executor   | Context boundary        | Independence   | Status |
| ----- | --------- | ------------- | ------------ | ---------- | ----------------------- | -------------- | ------ |
| 1     | analyst   | pi            | pi           | pi-parent  | current-session         | not-applicable | pass   |
| 2     | architect | pi            | pi           | pi-parent  | current-session         | not-applicable | pass   |
| 4     | developer | codex         | codex        | codex-cli  | local-cli-child-process | not-applicable | pass   |
| 6     | review    | claude        | claude       | claude-cli | local-cli-child-process | independent    | pass   |
```

## Rules illustrated

- The planned owner and actual executor are separate.
- The execution target is explicit; a model name is not treated as a CLI.
- Review independence is recorded rather than assumed.
- Handover comments explain phase transitions.
- If the run degrades to one intelligence, it must be reported as single-agent or disclose self-review where allowed.

## Why this helps

The value is not "more agents." The value is reviewable division of responsibility when specialization or independence matters.
