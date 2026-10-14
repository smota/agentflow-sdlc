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
