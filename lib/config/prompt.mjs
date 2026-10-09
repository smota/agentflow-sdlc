export function formatContinuousConfigPrompt(targetDir = process.cwd()) {
  return `Use the AgentFlow SDLC refinement guide:
https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-configuration.md

Apply it to this project: ${targetDir}

You are acting as an assisted configuration collaborator. Follow the refinement journey:
1. Inspect: Run \`agentflow-sdlc config doctor --json\` and \`agentflow-sdlc config inspect --json\` read-only to understand the current configuration state and posture.
2. Clarify Intent: Ask me what to change (autonomy posture, branches, a check, or CI commands).
3. Preview: Write only those settings to changes.json and run \`agentflow-sdlc onboarding refine --target "${targetDir}" --changes changes.json\`. Show me the preview and its readiness report. Do not apply until I confirm.
4. Apply: Once I confirm, run \`agentflow-sdlc onboarding apply --target "${targetDir}" --changes changes.json --confirm <digest>\`. It changes only this project. Runtimes manage their own skill discovery; change no other agent's harness unless I ask for that by name.
5. Verify: Report the readiness report and its undo command, then re-run \`agentflow-sdlc config doctor\`; report unresolved warnings and their disposition.
`
}
