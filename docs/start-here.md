# Start here

Use this page to reach the right depth without reading the documentation front to back.

## Pick your path

| You are…                  | Start with                                 | Then use                                                                                                                  |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Adopting or evaluating    | [Adopter path](adopters/index.md)          | [Get started](get-started.md), [profiles](adopters/profiles.md), and [upgrade/rollback](adopters/upgrade-and-rollback.md) |
| Maintaining AgentFlow     | [Maintainer path](maintainers/index.md)    | [Modular architecture](modular-architecture.md), [workflow](agent-workflow.md), and [ADRs](adr/)                          |
| Authoring a provider      | [Provider author path](providers/index.md) | [Provider matrix](providers/provider-matrix.md) and [authoring contract](providers/authoring.md)                          |
| Operating an installation | [Operator path](operators/index.md)        | [Troubleshooting](operators/troubleshooting.md), [Cockpit](cockpit.md), and [evidence contracts](evidence-contracts.md)   |

## The model at a glance

```mermaid
flowchart LR
  Need["Need"] --> Issue["Issue / acceptance criteria"]
  Issue --> Roles["Role-based delivery"]
  Roles --> Checks["Validation & review"]
  Checks --> PR["Evidence-backed PR"]
  PR --> FollowUp["Release or follow-up"]
```

## New-user essentials

You only need four ideas to begin:

1. AgentFlow wraps your existing project; it does not generate or replace it.
2. One agent normally carries the work through explicit roles, scaling from a single CLI (`S0`) to multi-CLI orthogonal routing (`S1`) or an OpenRig squad (`S2`) only when your setup benefits from it.
3. Issues and PRs hold durable evidence; `.agent-runs/` remains local scratch.
4. High-assurance work keeps human review before merge.

### Onboarding & configuration funnel

| Step in your journey                               | Canonical guide                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Understand in 5 minutes**                     | [AgentFlow in 5 minutes](agentflow-in-5-minutes.md) — problem, role model, and evidence flow                                                |
| **2. First governed change (6 commands)**          | [Get started](get-started.md#existing-project-with-tests-first-local-evidence-in-6-commands) — inspect, preview, confirm, apply, and verify |
| **3. Agent-guided initial setup**                  | [Assisted onboarding](assisted-onboarding.md) — copy-paste prompt for any coding agent to run the read-only-first preview                   |
| **4. Choose substrate (`S0`/`S1`/`S2`) & routing** | [Project setup](project-setup.md) — single-CLI subagents (`S0`), multi-CLI Four-Eyes (`S1`), or OpenRig Lean 4-Seat Squad (`S2`)            |
| **5. Day-2 refinement & MCP maintenance**          | [Refine your setup](assisted-configuration.md) — preview-confirmed updates to posture, branches, checks, and routing                        |

## Advanced-user map

| Concern                                            | Canonical document                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Continuous configuration and maintenance           | [Assisted configuration](assisted-configuration.md) and [project setup](project-setup.md)                      |
| Phase transitions and composite Phase 3–5 pass     | [Agent workflow](agent-workflow.md)                                                                            |
| Platform identity, execution target, and transport | [Runtime platforms](runtime-platforms.md) and [execution targets](execution-targets.md)                        |
| Role routing, effort calibration, and Four-Eyes    | [Agent routing](agent-routing.md)                                                                              |
| Portable execution intents and provider inspection | [Capabilities](capabilities.md)                                                                                |
| Collaboration modes, L2 subagents, and Effort Law  | [Intelligent collaboration](intelligent-collaboration.md)                                                      |
| Handover acceptance, rework, and councils          | [Role collaboration](role-collaboration.md)                                                                    |
| OpenRig Lean 4-Seat Squad (`S2` substrate)         | [OpenRig integration](../OPENRIG.md)                                                                           |
| Artifact and lifecycle schemas                     | [Evidence contracts](evidence-contracts.md) and [lifecycle boundaries](lifecycle-boundaries.md)                |
| Extension and adapter distribution                 | [Extension packs](extension-packs.md), [default skills](default-skills.md), and [packaging](sdlc-packaging.md) |
| Lifecycle roles and configurable methods           | [Lifecycle roles](roles/index.md) and [role methods](roles/methods.md)                                         |
| Release governance                                 | [Release versioning](release-versioning.md) and [publishing](release-publishing.md)                            |
| Evals and metrics                                  | [Agent evals](agent-evals.md) and [outcome metrics](outcome-metrics.md)                                        |

For the complete categorized inventory, use the [documentation index](index.md).
