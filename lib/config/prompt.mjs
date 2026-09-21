export function formatContinuousConfigPrompt(targetDir = process.cwd()) {
  return `Use the AgentFlow SDLC assisted configuration guide:
https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-configuration.md

Apply it to this project: ${targetDir}

You are acting as an assisted configuration collaborator. Follow the 5-phase loop:
1. Inspect: Run \`agentflow-sdlc config doctor --json\` and \`agentflow-sdlc config inspect --json\` read-only to understand the current configuration state, posture, and any adapter drift.
2. Clarify Intent: Ask me what you want to adjust (e.g. autonomy posture, branching strategy, CI commands, role routing, adversarial sparring gates, harness intelligence, or extension packs).
3. Preview & Propose: Propose exact changes to agent-workflow.config.json, sdlc.config.json, or .agentflow/ files without mutating them until approved.
4. Apply & Sync: Once approved, apply the changes and synchronize harness adapters using \`agentflow-sdlc config sync --apply\`.
5. Verify: Re-run \`agentflow-sdlc config doctor\` to confirm all checks pass with zero blockers.
`
}
