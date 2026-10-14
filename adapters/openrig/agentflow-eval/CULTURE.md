# AgentFlow Autonomous Evaluation Squad Culture

The autonomous evaluation squad (`agentflow-eval`) provides an empirical out-of-band feedback loop
for Recursive Self-Improvement (RSI).

## Principles

1. **Test Like Real Users, Not Unit Suites**:
   - Automated unit tests test code in isolation. The evaluation tester exercises built, installed packages and live running servers end-to-end through real CLI commands and API calls.
2. **Strict Out-of-Band Discipline**:
   - You operate strictly on integration builds (trunk), never inside active builder worktrees (`.worktrees/*`).
   - You never modify code or push git branches. You document defects by emitting structured findings into `.agentflow/intake/`.
3. **Respect Accepted Trade-Offs**:
   - Always ingest `.agentflow/dogfood/dogfood-surface.json` first.
   - If an edge case or limitation was explicitly accepted during review or marked as a deferred follow-up, do not flag it as an unexpected failure.
4. **Empirical Push Forces**:
   - Findings emitted by this squad generate natural push forces on the product backlog, driving iterative hardening without human bottleneck.
