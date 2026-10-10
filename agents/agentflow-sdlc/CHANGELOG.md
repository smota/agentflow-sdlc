# AgentFlow SDLC agent package changelog

## Unreleased

- Person gates now appear on the work record. `agentflow-sdlc gates open`, `answer`, `on-behalf`,
  and `waiting` record and list gates on GitHub (a product-owned issue-body block) and on the
  filesystem medium (`gates.json`). Each gate shows waiting, agreed, refused, or stale, with who must
  answer (the role on the human platform). On-behalf actions name the person as principal and the
  agent as actor and never satisfy a gate. `gates answer` takes no platform from the caller and
  refuses to run under an agent runtime. The record is not proof of identity. `satisfyGate` is
  unchanged.
- Every work item now shows one process state: Backlog, Readiness, WIP, or Delivered. The state is
  projected from the phase record and one integration fact, the same way on GitHub and on the
  filesystem medium. `agentflow-sdlc board` shows the four groups; `board backfill` previews the
  GitHub label corrections and applies them only with `--apply`. GitHub issues carry exactly one
  `state:*` label, kept current by `phase append` and the integration lifecycle. The filesystem
  medium records integration in `integration.json` with `agentflow-sdlc phase integrate`. Packs and
  profiles cannot add or rename a state. `status:in-progress`, `status:backlog`, `status:v1-ready`,
  and `status:superseded` are retired: an adopter config whose `labels.progress` still names
  `status:in-progress` gets a migration finding.
- Added `agentflow-sdlc adapters` to install, update, and operate an execution adapter on macOS,
  Linux, and Windows. An adapter opts in with a `lifecycle` entry in its own manifest; OpenRig is
  the first. `providers` stays discovery only. The OpenRig shell scripts `install-rig.sh` and
  `spawn-squad.sh` are removed and are no longer the supported path:

  | Old script journey                                  | Product command                                                                                      |
  | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
  | Install: `install-rig.sh [--preset <p>] [repo]`     | `agentflow-sdlc adapters install openrig [--preset <p>] [repo]`                                      |
  | Recover: re-run `install-rig.sh`                    | `agentflow-sdlc adapters install openrig` again                                                      |
  | Update bases: re-run `install-rig.sh`               | `agentflow-sdlc adapters update openrig`                                                             |
  | Provision: `spawn-squad.sh <project> [path]`        | `agentflow-sdlc adapters squads provision openrig <project> [path]`                                  |
  | Product squad: `spawn-squad.sh --kind product ...`  | `agentflow-sdlc adapters squads provision openrig --kind product [--sibling <rig>] <project> [path]` |
  | Update a squad: `spawn-squad.sh --update <project>` | `agentflow-sdlc adapters squads update openrig <project>`                                            |
  | List: `spawn-squad.sh --list`                       | `agentflow-sdlc adapters squads list openrig [--json]`                                               |
  | Remove: `spawn-squad.sh --remove <project>`         | `agentflow-sdlc adapters squads remove openrig <project>`                                            |

  Remove now stops a running squad with `rig down <rig>` before deleting it; the old script's stop
  call passed an option `rig down` does not accept and never stopped anything.

- Removed the optional AI Foundry Desk provider and its pin check. This is compatibility-impacting
  for projects that used that provider: shipped discovery no longer lists it, and inspecting it
  fails like any other unknown provider. No replacement provider is added. See ADR 014.
- Added canonical `AgentFlow SDLC Agent` package structure.
- Added maturity scorecard, knowledge/tool contracts, runtime capability matrix, handoff and execution model, guardrails, validation checklist, eval plan, and continuous-improvement plan.
