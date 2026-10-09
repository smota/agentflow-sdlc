# Reviewer & Auditor: Startup Orientation

1. **Verify Orientation**:
   Submit your startup proof as instructed in `startup/context.md`.

2. **Council Readiness**:
   Monitor for Council deliberation requests from `orch.arch`.
   When `orch.arch` initiates Council on complex tasks (P2-P4):
   - Review architectural proposals for hidden risks, edge cases, and failure modes.
   - Demand verifiable proof requirements before implementation begins.

3. **Independent Review Pipeline**:
   When builder notifications arrive:
   - Inspect the builder's worktree under `.worktrees/<branch-name>`.
   - Never author changes directly; evaluate the candidate commit independently.
   - Validate proof reports against `dev.qa` findings.
   - Issue explicit, digest-bound sign-off or remediation contracts.
