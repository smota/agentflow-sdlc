# Governance map

Asset: `assets/agentflow-governance-map.svg`

The governance map is the single picture of how one issue moves through AgentFlow SDLC. It exists
to make three structural properties visible that prose tends to bury:

1. **Authority is enforced per phase and is not monotonic.** It drops at review by construction.
2. **Person gates do not bind to phases.** They bind to subjects, so the governance layer is
   deliberately detached from the stage axis.
3. **Failure is first-class.** Eight return routes, capped, then human escalation.

A reader who takes nothing else from the diagram should take those three.

## Canonical values

Every string in the asset is a canonical value. The tables below are the contract between the
diagram and the source. Re-verify a citation before changing the value it backs.

### Role passes

Source: `manifests/role-catalog.json` (`roles[]`, `identityFormat`), `lib/core/phase-graph.mjs`
(`PHASES`), `lib/sdlc-vocabulary.mjs` (`CORE_ROLES`).

| Phase | Role slug                | Kind      | Action boundary   | Mutation scope         |
| ----- | ------------------------ | --------- | ----------------- | ---------------------- |
| —     | `requester`              | bootstrap | `propose`         | `request-records`      |
| 00    | `product-manager`        | lifecycle | `propose`         | `goal-records`         |
| 01    | `analyst`                | lifecycle | `propose`         | `issue-requirements`   |
| 02    | `architect`              | lifecycle | `propose`         | `architecture-records` |
| 03    | `implementation-planner` | lifecycle | `propose`         | `planning-evidence`    |
| 04    | `developer`              | lifecycle | `mutate-worktree` | `approved-plan-files`  |
| 05    | `tester`                 | lifecycle | `observe`         | none                   |
| 06    | `reviewer`               | lifecycle | `observe`         | none                   |
| 07    | `technical-writer`       | lifecycle | `mutate-worktree` | `documentation-files`  |
| 08    | `pr-readiness`           | lifecycle | `open-pr`         | `pr-records`           |
| —     | `qa-expert`              | sidecar   | `observe`         | none                   |

Qualified identities are `agentflow:<slug>`. The sidecar links are
`tester → qa-expert` carrying `exploratory-charter` and `qa-expert → reviewer` carrying
`exploratory-findings` (`manifests/role-catalog.json`, `sidecarLinks`).

### Evidence namespaces

Source: `manifests/role-catalog.json` (`roles[].owns`). These are the diagram's lanes. A lane is a
kind of evidence, never a vendor tool — harness neutrality is the point, so tool lanes would
misrepresent the model.

| Lane            | Owned namespaces                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INTAKE`        | `intake.request`                                                                                                                                                                                                                                 |
| `PRODUCT`       | `product.problem`, `product.outcome`, `product.release-intent`                                                                                                                                                                                   |
| `ANALYSIS`      | `analysis.requirements`, `analysis.acceptance-criteria`, `analysis.scope`                                                                                                                                                                        |
| `ARCHITECTURE`  | `architecture.design`, `architecture.risk`, `architecture.workflow-profile`                                                                                                                                                                      |
| `DELIVERY`      | `delivery.plan`, `delivery.rollback-plan`, `delivery.implementation`, `delivery.change-evidence`, `delivery.pr-manifest`, `delivery.merge-readiness`, `delivery.follow-up-status`                                                                |
| `ASSURANCE`     | `assurance.validation-plan`, `assurance.test-verdict`, `assurance.validation-evidence`, `assurance.coverage-notes`, `assurance.review-verdict`, `assurance.review-findings`, `assurance.independence-boundary`, `assurance.exploratory-findings` |
| `DOCUMENTATION` | `documentation.user-guidance`, `documentation.onboarding`, `documentation.release-language`                                                                                                                                                      |

The evidence baton enters `DELIVERY` at phase 03, leaves it for `ASSURANCE` and `DOCUMENTATION`,
and returns to `DELIVERY` at phase 08. That non-monotonic weave is the signature of the diagram.
Phase 03 also owns `assurance.validation-plan` while sitting in `DELIVERY`; the diagram shows such
cross-lane ownership with a hollow ghost ring rather than by moving the baton.

### Action boundary ladder

Source: `lib/sdlc-vocabulary.mjs`, `schemas/action-boundary.schema.json`.

Ordered, weakest first: `observe` < `propose` < `mutate-worktree` < `open-pr` < `external-action`.

The diagram renders this as a step chart, not a row of badges, because the value falls as well as
rises. Phases 05 and 06 are demoted to `observe`: review independence is structural, not a
convention. `external-action` is drawn detached, reachable only under the `autonomous` posture or
`high-assurance` change class, and always behind a person gate.

### Return routes

Source: `lib/core/phase-graph.mjs` (`RETURNS`, `MAX_RETURN_CYCLES`).

| From | To  | Diagram label      |
| ---- | --- | ------------------ |
| 08   | 04  | `readiness-rework` |
| 07   | 04  | `doc-rework`       |
| 06   | 04  | `review-rework`    |
| 04   | 03  | `replan`           |
| 04   | 01  | `requirements-gap` |
| 03   | 01  | `plan-blocked`     |
| 02   | 01  | `design-blocked`   |
| 01   | 00  | `intent-unclear`   |

`MAX_RETURN_CYCLES = 2`; exceeding it requires human escalation
(`lib/core/phase-graph.mjs`, `validateTransition`).

The labels in the right-hand column are diagram wording, not canonical identifiers. The edges they
sit on are canonical. Keep this distinction when refining.

### Person gates

Source: `lib/core/gate.mjs`, `docs/person-gates.md`, `defaults/sdlc.config.json`
(`gateways.humanApproval`).

| Gate class             | Bound subjects                    |
| ---------------------- | --------------------------------- |
| `adequacy-of-intent`   | `goalRevision`, `admission`       |
| `release-of-candidate` | `candidateDigest`                 |
| `agent-escalation`     | `goalRevision`, `candidateDigest` |

Gates cannot bind to a phase number (`lib/core/gate.mjs`). The diagram therefore draws the gate
rail detached, with **no connector lines to any phase column**. The absence of tethers carries the
meaning; do not "improve" the diagram by adding them.

`agent-escalation` derives from four crossings: `authority-escalation`, `budget-exhaustion`,
`evidence-expiry`, `independence`. Gate statuses are `waiting`, `agreed`, `refused`, `stale`, and
only an `agree` decision from a reviewer on a `human` platform satisfies a gate.

### Change classes and postures

Sources: `defaults/sdlc.config.json` (`paths`, `actionPolicy.profileMaximums`),
`lib/core/posture.mjs`, `lib/sdlc-vocabulary.mjs` (`POSTURES`, `DEFAULT_POSTURE`).

| Change class     | Required roles | Self-review | Human approval | Boundary ceiling  |
| ---------------- | -------------- | ----------- | -------------- | ----------------- |
| `light`          | 6              | yes         | no             | `open-pr`         |
| `bounded`        | 6              | yes         | no             | `open-pr`         |
| `standard`       | 7              | yes         | no             | `open-pr`         |
| `high-assurance` | 9              | no          | yes            | `external-action` |
| `exploratory`    | 4              | yes         | no             | `propose`         |

| Posture      | Boundary ceiling  | Self-review | Budget ceiling |
| ------------ | ----------------- | ----------- | -------------- |
| `advisory`   | `propose`         | no          | 0.5            |
| `assisted`   | `open-pr`         | yes         | 1              |
| `delegated`  | `open-pr`         | yes         | 1.5            |
| `autonomous` | `external-action` | yes         | 2              |

`standard` is the default change class; `assisted` is the default posture. The effective boundary is
the **stricter of posture and change class** (`lib/core/posture.mjs`), which the diagram states
explicitly because it is the rule most often got wrong.

### Work altitude

Source: `docs/sdlc-definition.md`. Altitudes are `goal`, `capability`, `spec`. Phases 00–08 run
inside a single `spec`. The diagram carries a small locator for this so the nine phases are not
mistaken for the whole lifecycle.

### Foundation strip

- Harness adapters: `claude-code`, `codex`, `agy`, `openrig`, `pi` (`adapters/`). Swappable; the
  pipeline does not change.
- Deterministic floor: `pnpm test`, `pnpm test:workflow`, `pnpm format:check`
  (`agent-workflow.config.json`, `ciCommands`).
- Invariants rendered: `exclusive-ownership`, `authority-may-only-narrow`, `single-writer`,
  `review-independence-for-high-assurance`, `digest-bound-handoffs`
  (`manifests/role-catalog.json`, `invariants`).

## Deliberate omissions

Recorded so they are not re-added by mistake:

- **No vendor tool lanes.** Harness neutrality is principle 1; lanes are evidence namespaces.
- **No per-phase gate badges.** Gates bind to subjects. See above.
- **No "second-model gate".** The term does not exist in this repository. The high-assurance human
  approval, with `Scope` of `security` or `acceptance`, is the real control.
- **No Meshloop surface.** Removed by `docs/adr/013-remove-optional-meshloop-adapter.md`.

## Render brief

The asset is generated from this brief. Regenerating with an agent is the expected path; the brief
is written to be executed verbatim.

### Canvas

Standalone SVG 1.1, `viewBox="0 0 1800 1230"`, `role="img"` with `<title>` and `<desc>`. Prose font
`Inter, 'Segoe UI', Helvetica, Arial, sans-serif`; technical labels
`'JetBrains Mono', 'Cascadia Mono', Consolas, monospace`. Light paper `#f7f9fb`, white cards,
hairline `#d7dee8`, muted text `#64748b`. Faint 40px grid `#e8edf3` at 0.5px behind everything.
Precision engineering-drawing look: hairline rules, generous whitespace, 10px corner radii. Not a
dark dashboard, not neon, not a terminal pastiche. Minimum type size 8.5px.

Layer groups, in order: `title-block`, `altitude`, `gate-rail`, `profile-rail`, `spine`, `lanes`,
`returns`, `authority`, `foundation`.

### Layers

1. **Title block.** Coral pill `AGENTFLOW SDLC`; headline `GOVERNED DELIVERY`; sub
   `One agent · nine role passes · the record outlives the session`. Right: the coral check motif
   from the banner, with `PROVIDER-NEUTRAL` and `EVIDENCE-FIRST`.
2. **Altitude locator.** `goal` → `capability` → `spec`, with `spec` filled teal and the note
   `phases 00–08 run inside one spec`.
3. **Gate rail.** Detached card above the spine, dashed coral top border, labelled
   `PERSON GATES · BIND TO SUBJECTS, NEVER TO A PHASE NUMBER`. Three coral lozenges with their
   bound subjects beneath. No connectors to any column.
4. **Profile and posture rail.** Left: the five change-class chips, `standard` selected. Right: the
   four-posture table with `assisted` marked default, and the boxed rule
   `effective boundary = stricter of ( posture , change class )`.
5. **Spine.** Dashed bootstrap cap `Requester`, then nine plates on a shared x-grid. Teal left edge
   bars on 04 and 07, coral on 05 and 06. Real brackets above: `DEFINE` over 00–03, `BUILD` over
   04, `ASSURE` over 05–06, `LAND` over 07–08. A coral padlock in the 03/04 gap with
   `oracle digest pinned` / `tests/oracles/** · SHA-256` / `builders barred from this path`. A teal
   bracket under 03–05 reading `composite pass · P0/P1 only · one turn`. The dashed `QA expert`
   sidecar bubble below the 05/06 gap.
6. **Lanes.** Seven washed bands with hairline top edges, named at the left with a round swatch. One
   continuous 7px baton, gradient `#0b2f61` → `#36c7b2`, weaving by owned namespace with smooth
   cubic beziers. A 13px white node per column stroked in the lane hue, with the owned namespaces
   stacked beneath. Ghost rings for cross-lane ownership.
7. **Return routes.** Eight coral dashed arcs right-to-left, each with a visible 14–18px shoulder,
   at eight distinct depths, labelled above their horizontal run. The box
   `MAX_RETURN_CYCLES = 2 → human escalation required` sits at the band's top right.
8. **Authority band.** The five-tier step chart aligned to the nine columns, teal except the coral
   `observe` dip at 05 and 06, annotated `authority DROPS at review` /
   `independence is structural, not optional`. A detached dashed `external-action` step at the far
   right.
9. **Foundation strip.** Four cells: `HARNESS ADAPTERS`, `DETERMINISTIC FLOOR`, `DURABLE RECORD`,
   `INVARIANTS`, each with its values and a muted footnote.

### Layout discipline

Layers 5, 6 and 8 share one x-grid. Compute the column centres once and reuse them; misalignment
between the plates, the lane nodes and the authority steps is the failure mode that most damages the
diagram. Nothing may overflow the viewBox and no two text elements may overlap.

### Verification

1. Well-formed XML.
2. Nine numbered plates plus one unnumbered bootstrap cap.
3. The baton enters `DELIVERY`, leaves, and returns at column 08.
4. The authority chart dips to `observe` at 05 and 06.
5. Eight return arcs, none overlapping, none touched by the cycle-cap box.
6. No connector lines from the gate lozenges to any column.
7. No `font-size` below 8.5.
