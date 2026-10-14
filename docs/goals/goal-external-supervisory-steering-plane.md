<!-- agentflow-work:{"kind":"goal","parent":null,"changeClass":null,"admission":null} -->

# Goal: External Supervisory Steering Plane and Multi-Rig OpenRig Topology

**Kind:** goal

## Job

When software teams run parallel, autonomous AgentFlow SDLC squads across multi-project environments using OpenRig, I want an external supervisory steering agent in its own dedicated rig (`<project>-steer`), with clean peer topology, skill de-contamination, strict path-ownership write guards, and typed steering CLI verbs, so that steering occurs cleanly from an out-of-rig agent without in-rig role conflation, session collisions, or unauthorized code mutation.

## Outcome

AgentFlow SDLC establishes an authoritative, out-of-rig supervisory steering agent architecture compatible with OpenRig's native topology and Two-Plane Separation:

1. **Three-Base OpenRig Architecture (`agentflow-steer`)**: Ships `agentflow-steer` base spec (`rig.yaml`, `CULTURE.md`, `configurations.yaml`, `agent.yaml`, `steer-guard.mjs`, `startup/`), defining the `steer.lead` seat (`steer-lead@<project>-steer`) with high-effort reasoning model defaults, read-only repository permissions, and state persistence in `~/.openrig/steer/<rig>/`.
2. **Lifecycle Multi-Squad Atomic Provisioning**: Extends `lifecycle.mjs` with `--kind steer` and `--kind all` to provision `<project>-pm`, `<project>-dev`, and `<project>-steer` in an atomic transaction, generating cross-rig `sibling.md` and `steering.md` records with session isolation.
3. **Skill Partitioning & Decontamination**: Purges `agentflow-steerer` from the delivery squad agent (`adapters/openrig/agentflow/agents/agentflow/agent.yaml`) and adds a runtime seat assertion in `skills/agentflow-steerer/SKILL.md` to fail closed if invoked from an in-rig seat.
4. **Topology & Seam Decoupling**: Redraws `seam-rules.md` to place the Supervisory Steering Plane outside `agentflow-pm`, fixes `adapter-openrig.md` CLI syntax (`--destination`, `--body-file`), removes keystroke interrupts (`^C`), and canonicalizes the role name from `orch.steer` to `steer.lead`.
5. **Path Ownership & Git Guardrails**: Adds `steer-write-guard` in `manifests/path-ownership.json` (`allow: []`, `defaultDeny: true`) so git commits attributed to `steer.lead` are mechanically rejected in CI.
6. **Decider Port & Unfreeze Protocol Hardening**: Canonicalizes `STEERING_SEATS` to `steer.lead`, bars all in-rig seats (`orch.arch`, `rev.review`, `dev.*`, `pm.*`), and hardens `validateUnfreezeResolution` to accept only authorized steering seats and require human approval references for person-waivers/abandonment.
7. **First-Class Steering CLI (`steer` command)**: Introduces typed CLI subcommands (`assign`, `unfreeze`, `triage`, `merge-check`) preventing raw ad-hoc shell execution.

## Release Intent

Ships across `agentflow-sdlc` adapter lifecycle engines (`adapters/openrig/lifecycle.mjs`), OpenRig base templates (`adapters/openrig/agentflow-steer/`), skill definitions (`skills/agentflow-steerer/`), governance manifests (`manifests/path-ownership.json`), provider ports (`lib/providers/decider-port.mjs`), verification libraries (`lib/core/role-collaboration.mjs`), and product CLI commands (`bin/cli.mjs`, `scripts/steer.mjs`). Fully backward compatible with single-project generic rigs.

## Split Judgment

This goal breaks down into six sequenced, independently verifiable capabilities:

### Slice 1: Unfreeze Actor Validation & Decider Port Isolation Hardening (High-Assurance)

- **Target**: `lib/core/role-collaboration.mjs`, `lib/providers/decider-port.mjs`
- **Issue**: #478
- **Contract**: `validateUnfreezeResolution` enforces `record.actor` matches authorized steering seat (`steer.lead`, `human:<login>`) and fails closed on in-rig seats. For `person-waiver` or `abandonment`, requires explicit human approval reference. `decider-port.mjs` canonicalizes `STEERING_SEATS` to `steer.lead` and bars `orch.arch` and `rev.review`.

### Slice 2: Skill De-contamination & Seam Rules Decoupling (Standard)

- **Target**: `adapters/openrig/agentflow/`, `skills/agentflow-steerer/`
- **Issue**: #479
- **Contract**: Purges `agentflow-steerer` from delivery agent definition and vendored directory. Adds runtime seat identity assertion in `SKILL.md`. Redraws `seam-rules.md` with steering plane outside product squad. Fixes OpenRig CLI syntax (`--destination`, `--body-file`), removes `^C` interrupts and `operator.agent`.

### Slice 3: Path-Ownership Steer Write Guard & Seat Renaming (High-Assurance)

- **Target**: `manifests/path-ownership.json`, `scripts/validate-path-ownership.mjs`, policy docs
- **Issue**: #480
- **Contract**: Renames `orch.steer` to `steer.lead` across `AGENTS.md`, `docs/`, and `CULTURE.md`. Adds `steer-write-guard` (`allow: []`, `defaultDeny: true`) rejecting commits from steering seats. Adds `dev.qa` and `rev.review` to `knownSeats`.

### Slice 4: AgentFlow-Steer Base Rig & Session Guard (Standard)

- **Target**: `adapters/openrig/agentflow-steer/`
- **Issue**: #481
- **Contract**: Authors base rig spec (`rig.yaml`), culture (`CULTURE.md`), agent definition (`agent.yaml`), presets (`configurations.yaml`), startup guidance with negative tests, and `steer-guard.mjs` PreToolUse guard blocking file writes, git commits, and `handoff deliver`.

### Slice 5: OpenRig Lifecycle Three-Rig Provisioning & Sibling Binding (Standard)

- **Target**: `adapters/openrig/lifecycle.mjs`, `manifest.json`, `OPENRIG.md`
- **Issue**: #482
- **Contract**: Registers 3rd base (`steer: 'agentflow-steer'`). Implements `--kind steer` and `--kind all` for atomic provisioning of `<project>-pm`, `<project>-dev`, and `<project>-steer`. Generates `steering.md` and updates `sibling.md`. Manages `~/.openrig/steer/<rig>/` state directory.

### Slice 6: First-Class Steering CLI Verbs & Merge-Check (Standard)

- **Target**: `bin/cli.mjs`, `scripts/steer.mjs`
- **Issue**: #483
- **Contract**: Implements typed CLI commands (`steer assign`, `unfreeze`, `triage`, `merge-check`), verifying review verdicts, CI status, and human approvals before merge.

## Child Work & History

> **Status:** Slices in progress — 2 capabilities delivered
> **Progress:** 2/6 capabilities delivered (33.3%)

| Part | Kind       | Title                                                                      | Status    | Replacement | Delivery PR | Commit    | Date       |
| :--- | :--------- | :------------------------------------------------------------------------- | :-------- | :---------- | :---------- | :-------- | :--------- |
| #478 | capability | capability: unfreeze actor validation and decider port isolation hardening | Delivered | —           | #491        | `c56ef60` | 2026-10-14 |
| #479 | capability | capability: skill de-contamination and seam rules decoupling               | Delivered | —           | #492        | `5c3926a` | 2026-10-14 |
| #480 | capability | capability: path-ownership steer write guard and seat renaming             | Backlog   | —           | —           | —         | —          |
| #481 | capability | capability: agentflow-steer base rig and session guard                     | Backlog   | —           | —           | —         | —          |
| #482 | capability | capability: openrig lifecycle three-rig provisioning and sibling binding   | Backlog   | —           | —           | —         | —          |
| #483 | capability | capability: first-class steering cli verbs and merge-check                 | Backlog   | —           | —           | —         | —          |
