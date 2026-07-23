# Handoff contract

A handoff preserves continuity between SDLC roles, sessions, agents, or sub-agents.

## Required fields

- issue and branch;
- from phase/role and to phase/role;
- planned owner and actual owner;
- launcher and executor;
- transport and delegation boundary;
- derived context boundary;
- independence boundary for review;
- inputs read and decisions made;
- open questions and blockers;
- next-role contract;
- validation or artifacts produced.

Use `../../agents/templates/handover-comment.md` for GitHub-visible handovers and `../../agents/templates/role-pass.md` for local role-pass evidence.

## Single-agent handoffs

Even when one executor performs all roles, record role-to-role continuity in workflow evidence. `Planned owner` may be `not-applicable:single-agent` for single-agent mode.

## Multi-agent or sub-agent handoffs

When routing or delegated sub-agents are used:

- resolve execution target before launch;
- record launcher, executor, transport, delegation boundary, context boundary, and independence boundary separately;
- keep reviewers read-only by default;
- validate delegated output before incorporating it;
- parent agent owns synthesis and PR evidence.

## No false claims

A helper process, provider model call, or same-context self-review is not independent multi-agent review. A `multi-agent` mode claim needs the role-attribution matrix described in `../../docs/agent-workflow.md` §4a.
