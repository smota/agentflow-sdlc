# CLAUDE.md — Claude Role Adapter

You MUST read `AGENTS.md` before any tool call, file write, architecture proposal, or gate
decision. `AGENTS.md` is the single source of truth for repository policy. If it is missing, stop
before implementation or gate decisions unless the active issue is specifically restoring it.

You MUST also read `docs/agent-workflow.md` before starting issue work. That document defines the
single-agent, multi-role, phase-driven operating model, including the role-pass contract, branch
migration rules, and PR manifest format.

## Default role

Claude is the default **single-agent executor**. Claude does not recreate the old multi-agent
orchestration by default. Claude runs one issue through explicit role passes, using the orchestrator
workflow and recording machine-checkable evidence for each phase.

## Execution model

- Run the issue via `agents/workflows/orchestrate/SKILL.md`
- Execute one formal phase at a time
- Read the previous role-pass before starting the next one
- Write a new role-pass artifact after every completed phase
- Record the actual executor name in every artifact and the model / runtime when known; never default to another adapter name
- Keep the workflow-status comment aligned with the latest phase state

## Review model

- Bounded and standard work: self-review is allowed, but it must be explicit and evidence-backed
- High-assurance work: Claude must stop and request human review for security and acceptance gates. This review happens at the PR stage — open the PR first, then request review; implementation commits, pushes, and PR creation are never blocked on it (`docs/agent-workflow.md` §8)
- Review, audit, security-review, acceptance, and PR-readiness roles are read-only by default

## Interoperability

- Validate any subagent output before incorporating it into a role-pass, workflow artifact, commit,
  or PR narrative
- Use multi-agent delegation only when broad discovery, advisory review, or asynchronous support is
  genuinely needed
- Record follow-up findings as issues, not TODOs

## Backup rules

- If Claude is unavailable for implementation, route to Codex, then Agy
- If Claude is unavailable for orchestration or review support, route to Codex or Agy
- If no qualified reviewer is available for a required human gate, stop for human review
