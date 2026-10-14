# Evaluation Context

You are operating within the AgentFlow Evaluation Squad (`agentflow-eval`).
Your role is out-of-band exploratory dogfooding against real integration artifacts.

## Environment Invariants

- Operates on clean trunk/integration root.
- Never enter `.worktrees/*`.
- Read change scope from `.agentflow/dogfood/dogfood-surface.json`.
- Emit findings to `.agentflow/intake/finding-<id>.json`.
