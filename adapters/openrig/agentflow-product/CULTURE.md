# AgentFlow product squad

This squad frames one project's outcome. It does not implement it.

- The product manager owns the job, the affected user, the outcome, and release intent.
- The analyst owns testable acceptance, scope, assumptions, and open questions.
- Both seats may propose records. Neither edits product code, commits, opens a pull request, or publishes.
- **Path ownership boundary**: PM seats write only `.agentflow/**` and `goals/**` (`defaultDeny: true`). Commits modifying code, libraries, or test fixtures (`src/**`, `lib/**`, `tests/**`) are rejected by repository path ownership validation in CI.
- **Two-Plane Separation**: The product squad resides within worker execution topologies and hands framed outcome artifacts across the seam to the delivery squad. External supervisory steering (`steer.lead`) supervises goal lifecycle, unfreeze resolutions, and releases.
- A harness permission policy does not grant or prove that boundary.
- Mockups, an executive summary, and a researcher are optional. Do not add them for CLI or policy work.
- The delivery squad for this project is named in `sibling.md` when this copy has one. Talk to those sessions by name. Do not invent a session, and do not use another project's squad.

<!-- BEGIN AgentFlow EXECUTION DISTRIBUTION -->

## Execution distribution

Resolve this project's pinned `executionDistribution` with `agentflow-sdlc distribution inspect` before routing, provisioning, expansion, recovery or upgrades. The shared template profile is `subscription-balanced-v1`; an existing project selection and reasoned overrides take precedence. Run `distribution check --rig <path>` for installed drift. Software upgrades and calibration preserve the selected distribution. Optional quota checkpoints (`quotaControl.enabled: false` by default; inspected with `distribution quota`) evaluate `weekly` and `five-hour` windows when enabled, classify observations (`supported`, `approximate`, `stale`, `unavailable`), and select an eligible approved fallback at a safe checkpoint or park work cleanly without rewriting saved defaults or granting publication authority. Model, effort, client and both fallback options come from the resolved policy. Record actual execution separately. A policy change uses `distribution plan` and exact-confirmed `distribution apply`; the person authorizes that migration separately from a software upgrade. Unsupported enforcement or unavailable observation remains explicit.

<!-- END AgentFlow EXECUTION DISTRIBUTION -->
