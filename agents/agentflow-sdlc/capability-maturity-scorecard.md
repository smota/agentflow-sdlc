# Capability maturity scorecard

| Level                               | Status        | Evidence                                                                                                                                                                                                                                                                                | Gaps / next proof                                                                                                |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0 Prompt-only                       | Passed        | `AGENT.md`, `../../README.md` explain goal, users, non-goals.                                                                                                                                                                                                                           | Keep prompt semantics stable across adapters.                                                                    |
| 1 Structured instructions           | Passed        | `../../AGENTS.md`, `../../docs/agent-workflow.md`, `../../agents/templates/role-pass.md`.                                                                                                                                                                                               | Keep role-pass fields synchronized with validators.                                                              |
| 2 Tool-aware                        | Mostly passed | `tools-actions.md`, `../../agents/tools/registry.md`, `../../scripts/validate-spec.mjs`, `../../scripts/resolve-capability.mjs`, `../../scripts/resolve-collaboration-plan.mjs`.                                                                                                        | Add executable schema validation if MCP/OpenAPI contracts become first-class.                                    |
| 3 Safe mutation                     | Mostly passed | Branch rules in `../../agent-workflow.config.json`, review rules in `../../docs/agent-workflow.md`, PR template in `../../agents/templates/pr-manifest.md`.                                                                                                                             | More automated rollback evidence for mutating GitHub operations would strengthen this level.                     |
| 4 Orchestration and handoffs        | Strong        | `runtime-capabilities.md`, `handoff-contract.md`, `execution-model.md`, `../../docs/capabilities.md`, `../../docs/execution-targets.md`, `../../docs/intelligent-collaboration.md`, `../../scripts/validate-role-attribution.mjs`, `../../scripts/validate-collaboration-evidence.mjs`. | Keep no-false-multi-agent/council-claim checks enforced in PR manifests and validators.                          |
| 5 Learning / continuous improvement | Partial+      | `evals.md`, `continuous-improvement-plan.md`, `../../agents/evals/README.md`, `../../agents/evals/suites/intelligent-collaboration.md`, `../../agents/evals/datasets/intelligent-collaboration/mode-selection.json`, release docs under `../../docs/releases/`.                         | Implement executable eval runner, richer benchmark fixtures, feedback triage reports, and regression dashboards. |

## Current maturity judgment

AgentFlow SDLC Agent is Level 4 strong and Level 5 partial+. It can orchestrate reviewable SDLC work with durable evidence and now has intelligent-collaboration planning, evidence validation, role-agent packages, workflow-skill scaffolding, and eval fixtures. It still lacks an executable eval runner and benchmark dashboard sufficient to claim full Level 5 maturity.

## Validation evidence to cite

```bash
pnpm test:workflow
node scripts/validate-role-routing.mjs
node scripts/validate-branch-strategy.mjs
node scripts/validate-extension-packs.mjs --allow-empty
node scripts/resolve-collaboration-plan.mjs --profile bounded --risk low --effort low --uncertainty low --json
node scripts/validate-collaboration-evidence.mjs --path <evidence.json>
```
