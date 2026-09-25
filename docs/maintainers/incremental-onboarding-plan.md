# Plan: incremental adoption with runtime-owned installation

Status: execution authorized for this workstream; repository setup and initial Agy
dispatch are being activated under the authority below. Product slices require their
own phase evidence and gates before advancement.
Date: 2026-09-25. Planning method: TechLead Planner.

This document replaces the earlier conversational backlog. It is a design and delivery
plan, not an implementation record. The current unrelated `SPEC.md` is not its specification.
The maintainer subsequently authorized repository setup, GitHub tracking and execution
with Agy CLI plus Codex adversarial review. Release, merge and shared installation
changes remain outside that authorization.

## Goal and acceptance

Make adoption incremental from an empty machine through complete, partial, old, or
unknown installations. AgentFlow declares required capabilities and manages adoption
inside the selected project. The connected runtime discovers availability and decides
how and where to install or update tools and skills. The default installation scope is
the current runtime; additional runtimes require an explicit user request.

Separate the repository's development instructions from the instructions delivered to
consumers. Preserve existing project policy and externally managed installations.

### Confirmed decisions and scope

- The root `AGENTS.md` governs development of AgentFlow itself. A separate adoption
  template supplies consumer instructions; shared workflow policy has one authoritative
  source and reachable references, rather than two manually maintained copies.
- Installed skills are execution guidance under repository policy. `skills/` contains
  product source. Testing a development version explicitly selects that checkout source.
  Editing source does not authorize installing or refreshing a shared deployment.
- AgentFlow provides generic capability requirements and handoff instructions. Runtime
  installation destinations, package-manager commands, host discovery paths, and
  multi-agent distribution belong to the runtime, not AgentFlow's onboarding code.
- Always offer an update assessment. Propose an update when a newer version is verified;
  unavailable release information is reported as unknown, not up-to-date.
- Updating a shared CLI or skill library is a separate decision from adopting a project.
  Deferring an update does not block adoption when the available version is compatible.
- Support tested legacy migrations and assisted recovery of unknown installations.
  Preserve unattributed files and recover selectively. Archival or replacement requires
  an explicit disposition in the reviewed plan.

In scope: instruction separation, runtime handoff, project inventory, compatibility and
update assessment, incremental planning, project transactions, known migrations,
unknown-state recovery, verification, documentation, and regression coverage.

Out of scope: embedding a Skills Manager client, host-specific install directories or
recipes, automatic installation for every detected agent, global inventory of all
projects, external library cleanup, live installation on this machine, release or npm
publication, and rebuilding all existing execution-provider integrations. Existing
role-execution adapters are distinct from installation mechanisms.

Acceptance criteria:

- AC1: Consumer adoption never copies the development repository's root `AGENTS.md`;
  existing authored instructions survive adoption and upgrade.
- AC2: The generic onboarding route has no host-specific skill destination or installer
  recipe and never invokes broad adapter sync as an installation fallback.
- AC3: Available compatible components are reused. Only missing project configuration
  and explicitly selected upgrades appear as changes.
- AC4: Runtime responses distinguish declared, observed, unavailable, and unknown
  evidence, including whether the host actually discovered a skill.
- AC5: Shared updates and extra-runtime installation are separately scoped choices.
- AC6: A second apply against unchanged desired and observed state performs zero content
  mutations, including avoidable lockfile churn.
- AC7: Links to external installations may be inspected but are never traversed for
  project writes. Root, content, or ownership changes invalidate an approved plan.
- AC8: Known historical formats have fixture-backed transformations. Unknown files
  remain intact until individually classified and dispositioned.
- AC9: Interrupted project operations recover without overwriting subsequent authored
  changes; external outcomes are reconciled before a repeat request.
- AC10: Reports distinguish runtime readiness, project adoption, and readiness for a
  governed change. Installation alone proves neither tests nor acceptance.

### Repository evidence

| Finding                                                              | Evidence                                                                    | Design consequence                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Root instructions are currently consumer seed content                | [payload manifest](../../manifests/product-payload.json), entry `AGENTS.md` | Change the source mapping, not just wording in the root file      |
| Existing configuration makes init skip early                         | [init](../../lib/init.mjs), `runInit`                                       | Presence of one file cannot mean setup is complete                |
| Skills are written directly to named harness directories             | [skill adapters](../../lib/skill-adapters.mjs)                              | Remove this mechanism from automatic onboarding                   |
| Config sync composes mutations sequentially                          | [config sync](../../lib/config/sync.mjs)                                    | Replace onboarding's broad sync with planned project operations   |
| Adoption already handles plans, receipts, containment, recovery      | [transaction](../../lib/adoption/transaction.mjs)                           | Reuse proven mechanisms behind an application boundary            |
| Legacy locks are intentionally rejected                              | [lockfile](../../lib/lockfile.mjs), [breaking changes](breaking-changes.md) | Add explicit migrations; do not silently relax validation         |
| Generic prompt currently prescribes global npm installation and sync | [assisted onboarding](../assisted-onboarding.md), [CLI](../../bin/cli.mjs)  | Both generated and documented prompts must change together        |
| Runtime and project policy boundaries already exist                  | [modular architecture](../modular-architecture.md)                          | Extend the separation; avoid a new host-management subsystem      |
| Source identities and generated payloads have tests                  | [skill adapter tests](../../lib/__tests__/skill-adapters.test.mjs)          | Preserve identity while separating distribution from installation |
| CI covers three operating systems and Node 20/24                     | [validation workflow](../../.github/workflows/validate-pr.yml)              | Reuse this matrix for physical path and recovery tests            |

## Blocking questions

None blocking for this plan. The maintainer settled ownership, update policy, shared
update scope, and unknown-installation recovery. Technical defaults below remain
falsifiable assumptions, not additional product approvals.

## Assumptions

1. **A1 — Data:** Runtime evidence can be represented as bounded plain records with
   capability identity, observed version/revision, owner, scope, provenance and status.
   Missing or malformed fields produce unknown/invalid evidence, never implied success.
   Display labels or directory names alone do not establish ownership.
2. **A2 — Failure:** A runtime may lack installation or discovery APIs. Generic guided
   instructions and a manual response remain supported. After an ambiguous external
   operation, collect fresh evidence before suggesting a retry.
3. **A3 — Boundaries:** AgentFlow writes only reviewed project changes. The runtime owns
   executable resolution and host installation. A read-only capability result can be
   consumed without trusting arbitrary commands or paths supplied in that result.
4. **A4 — State:** One writer operates on a project transaction. Plans bind root identity,
   required versions, observations and before hashes. A multi-root monorepo requires an
   explicit project scope; a worktree retains its own root identity.
5. **A5 — Environment:** Existing Node 20/24 and Windows/Linux/macOS support is retained.
   Before Node exists, the connected agent follows the generic bootstrap handoff using
   its environment; the Node CLI cannot bootstrap its own missing runtime.
6. **A6 — Scope:** Generic compatibility thresholds come from supported contracts and
   versions, not equality with the development checkout. Existing explicit generator
   commands may remain as separately documented maintainer tools during deprecation;
   they are not onboarding installers. Broader removal needs separate delivery scope.
7. **A7 — Testing:** Fixtures represent old and unknown states without mutating real
   installations. Automated tests prove AgentFlow's protocol and project behavior;
   actual runtime discovery is only claimed when observed in a host trial.
8. **A8 — Recovery:** Known migrations require immutable source fixtures and provenance.
   Unknown installations remain recoverable through selective user decisions without
   promising automatic classification or a universal rollback of runtime changes.

## Slices

The workstream is tracked by [epic #249](https://github.com/smota/agentflow-sdlc/issues/249).
Setup is [S0 / #250](https://github.com/smota/agentflow-sdlc/issues/250). Product issues:
[S2 / #251](https://github.com/smota/agentflow-sdlc/issues/251),
[S1 / #252](https://github.com/smota/agentflow-sdlc/issues/252),
[S3 / #253](https://github.com/smota/agentflow-sdlc/issues/253),
[S4 / #254](https://github.com/smota/agentflow-sdlc/issues/254),
[S5 / #255](https://github.com/smota/agentflow-sdlc/issues/255),
[S6 / #256](https://github.com/smota/agentflow-sdlc/issues/256), and
[S7 / #257](https://github.com/smota/agentflow-sdlc/issues/257).

### Execution authority and activity breakdown

This is a repository execution choice, not a host-specific product installation rule.
The maintainer explicitly selected `agy-cli` for execution and Codex for adversarial
review and technical acceptance. Existing installed tools are reused. Source commands
are selected explicitly to execute this checkout's development version.

| Activity                                              | Accountable actor            | Permitted actions                                                                                                       | Acceptance / stop boundary                                                                 |
| ----------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S0 setup, epic/child registration, state coordination | Codex coordinator            | Edit scoped setup/plan, validate, maintain GitHub issues and evidence, commit/push scoped branch and open reviewable PR | Report setup authorship as Codex; not independent Codex review of its own setup            |
| Product framing and requirements, each slice          | Agy CLI                      | Read issue, plan and source; produce product-manager and analyst passes                                                 | Codex challenges omissions; record sender acceptance before transition                     |
| Architecture and implementation plan                  | Agy CLI                      | Propose contracts, placements, tests and bounded implementation plan                                                    | Codex pre-code adversarial review; resolve structural/blocking objections                  |
| Implementation                                        | Agy CLI, sole product writer | Change files in the active issue's accepted scope; run checks; remediate returned findings                              | No automatic expansion of scope or executor substitution                                   |
| Test execution and documentation                      | Agy CLI                      | Run actual checks, record candidate-bound evidence, update scoped docs                                                  | Codex evaluates evidence and limitations; output alone is not acceptance                   |
| Adversarial review and technical acceptance           | Codex                        | Read-only review, accept/reject technical delivery, request bounded rework                                              | Cannot certify human security/acceptance or review its own authored subject as independent |
| Phase coordination and PR readiness                   | Codex coordinator            | Validate handoffs/receipts, publish durable status, prepare PR and attribution matrix                                   | Advance only after deterministic and semantic gates pass                                   |
| High-assurance security/acceptance; merge/release     | Human maintainer             | Explicit review of current PR candidate; separately authorize merge/release                                             | Codex technical acceptance does not replace this gate                                      |

Per slice: refine issue → record role pass → accept handoff → design → pre-code
review → implement → test → adversarial review/rework → docs → PR readiness. Execute
one phase at a time. Empty routing fallbacks preserve the requested agents; an
unavailable/quota-limited Agy or Codex pauses that dispatch for explicit resolution.
No same-harness substitute may be relabeled as Agy or independent Codex review.

The initial real dispatch is #251 phase 0 (product-manager), bounded to read-only
framing. Starting it does not claim that S2 implementation or the entire epic is complete.
Each subsequent phase receives its own action boundary and candidate-bound criteria.
The configured GitHub source is `smota/agentflow-sdlc`, coordination branch
`agentflow-state`; work happens on `work/incremental-onboarding-plan`, targeting
`development`. Coordination setup requires the existing source-plan preflight and digest.
Local `.agent-runs/` artifacts remain ignored; GitHub issues and the state branch carry
durable records. No unattended scheduler is implied by a run being started.

### Activation evidence and current gate

On 2026-09-25, S0 reused the existing CLIs, configured the role routes and four local
harness pillars, and created the GitHub-backed run `onboarding-251`. The initial
documentation criterion was frozen and its real process observation passed. This is
setup evidence, not acceptance of the runtime-handoff product feature.

Agy actually completed two phase-0 framing attempts through the local CLI using supplied
read-only snapshots. The first tool-based attempt was permission-denied; the subsequent
snapshot route required no permission bypass. Codex adversarial review returned the
first delivery for invalid references and unsupported model provenance. The revised
delivery fixed those claims but still failed the canonical artifact vocabulary and
delegated action-boundary validators. In particular, its declared effective `propose`
boundary exceeded its declared parent `observe` boundary.

The repeated-rejection limit is reached. The run must remain at phase 0 with no
accepted transition until the handoff contract/response is corrected and reviewed.
No product source implementation, completed analyst phase, or human approval is claimed.
The next bounded action is to provide the canonical vocabulary and issued parent
boundary in the runtime handoff and validate the returned artifacts before advancing.
The schemas alone did not communicate the narrower effective vocabulary to this runtime.

The active acceptance file is an issue-revision-bound snapshot. Issue edits/comments or
candidate changes require an explicit refresh of the contract revision and fresh
observations before acceptance. Never reuse the activation observation as proof of a
later implementation candidate. Review rejected artifacts in #251; raw local scratch
is not committed.

| ID  | Behavior delivered                                                                  | Acceptance check                                                                                                                     | Test level                     | Size | Blast radius               | Depends on |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---- | -------------------------- | ---------- |
| S1  | Separate development policy from consumer template                                  | Adoption uses the dedicated template; authored consumer text and all template references survive                                     | Payload/integration + docs     | M    | Instructions and packaging | None       |
| S2  | Generic runtime handoff with evidence and update choices                            | Fake runtimes cover available, missing, old, unavailable and unknown capabilities without host paths or installer commands in policy | Unit + protocol integration    | M    | New public boundary        | None       |
| S3  | Read-only diagnosis of exact project state                                          | New, partial, complete, conflicting, linked, old and unknown fixtures yield stable classifications and zero writes                   | Unit + filesystem integration  | M    | Discovery and input trust  | S2         |
| S4  | Incremental reviewed plan, including project choices and selective recovery preview | Same input gives same digest; missing choices are explicit; shared requests are separate; drift invalidates plan                     | Unit + CLI preview             | M    | Planning contract          | S1, S3     |
| S5  | Transactional project setup and resume                                              | Missing pieces are completed, authored config preserved, second apply is a no-op, injected interruption recovers                     | Integration + CLI              | L    | Project writes and locks   | S4         |
| S6  | Upgrade known states and recover unknown ones selectively                           | Fixture migrations and individual recovery dispositions preserve unrelated bytes; rejected decisions perform no writes               | Historical-fixture integration | L    | Migration and archival     | S5         |
| S7  | Unified generic onboarding and verified end-to-end experience                       | Prompt and CLI routes cover the scenario matrix, never dispatch install sync, and report verification limits                         | E2E + package + docs           | M    | Public onboarding behavior | S1–S6      |

## Order and rationale

Run S2's protocol walking skeleton first to resolve the highest uncertainty: can a
runtime return useful evidence without AgentFlow encoding host internals? It adds an
isolated contract and fake runtime, not a replacement production route. Then S1 resolves
instruction ownership before any new project-writing behavior. Proceed S3 → S4 → S5 →
S6 → S7 by dependency. S1 and S2 are independently mergeable; this is not a requirement
for parallel agents.

Expand with new template/contract/readers; migrate through reviewed plans; then switch
the public onboarding route. Keep each intermediate commit compatible with its active
entrypoint. Do not remove old explicit generator commands as a side effect of switching
the onboarding route.

### Scenario matrix

| Starting state                                          | Required result                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Empty machine, CLI unavailable                          | Connected runtime receives generic requirements, chooses installation mechanism, then returns availability evidence |
| Compatible installation                                 | Reuse; assess and propose verified updates; declining optional update permits setup                                 |
| Skill available only globally or through a manager link | Runtime verifies visibility; project planner does not create duplicate deployment                                   |
| Installed files but host discovery unverified           | Report files/availability evidence separately from host readiness                                                   |
| Partial project configuration                           | Preserve choices and fill missing requirements without force regeneration                                           |
| Complete project                                        | No project mutations; update proposal may still be present                                                          |
| Recognized old installation                             | Show tested migration and version compatibility before apply                                                        |
| Unknown installation or mixed authored content          | Inventory, classify, review individual dispositions, preserve unresolved content                                    |
| Shared update deferred                                  | Continue if compatible; explain specific missing capability if incompatible                                         |
| Extra runtimes explicitly requested                     | Runtime handles that distribution; report scope per requested runtime                                               |
| Runtime offline or unable to install                    | Report unavailable/unknown status with a guided next step; no invented completion                                   |
| Wrong subdirectory, monorepo, worktree or changed link  | Resolve explicit project scope; reject changed or ambiguous write destinations                                      |
| Prior operation interrupted                             | Reconcile journal/receipt and current files before further mutations                                                |

## Placement

Paths below are proposed module names, not existing capabilities.

| Module or surface                                          | Layer                               | New imports (direction)                                        | Boundary and reason                                                                                            |
| ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lib/core/onboarding-state.mjs`, `onboarding-plan.mjs`     | Domain policy                       | Existing pure core contracts only                              | Pure compatibility, ownership and action rules; no filesystem, process, host brand or manager client           |
| `lib/application/onboarding-service.mjs`                   | Use cases                           | Core contracts inward; injected ports                          | Inspect/plan/apply/verify/recover operations use plain request/response data                                   |
| `lib/onboarding/project-reader.mjs`                        | Filesystem adapter                  | Application-owned observation contract                         | Resolve physical paths and read project metadata without discovering host installation folders                 |
| `lib/onboarding/project-writer.mjs`                        | Transaction adapter                 | Application ports plus existing adoption implementation        | Reuse containment, journals, locks and rollback; keep transaction details outside decision rules               |
| `lib/onboarding/runtime-handoff.mjs`                       | Interface adapter                   | Application/core handoff contract                              | Render generic requests and parse responses; contains no installer or per-host registry                        |
| `lib/onboarding/migrations/`                               | Transformation adapters             | Core migration records                                         | Explicit fixture-backed versions and selective recovery operations                                             |
| `schemas/onboarding-*.schema.json`                         | Public data contracts               | No runtime imports                                             | Validate needs, observations, plans and outcomes; assess reuse of existing evidence types before adding fields |
| `bin/cli.mjs`, `lib/init.mjs`, `lib/config/prompt.mjs`     | Entry/composition layer             | Application inward; instantiate concrete project adapters here | Existing routes share the new policy; command names finalized during implementation                            |
| Root `AGENTS.md` and existing runtime policy adapters      | Development instructions            | References to shared workflow policy                           | Distinguish source editing, installed guidance and explicit source testing                                     |
| Proposed `defaults/AGENTS.md` and `docs/agent-workflow.md` | Consumer template and shared policy | Consumer-reachable references                                  | Template augments authored instructions through a reviewed merge; root is never installed                      |
| Payload/profile manifests and their readers                | Packaging adapters                  | Source-to-target mappings                                      | Support template source differing from target; validate all smallest-profile references                        |

Use functions and injected port objects; no new framework, service, or package split.
The application defines port shapes. Concrete adapters depend on those contracts; core
and use cases never import the concrete implementations. Runtime handoff is a protocol,
not an AgentFlow installer plugin for each host.

The source mapping change must account for existing consumer locks whose recorded
source is root `AGENTS.md`. Preserve modified consumer instructions and expose a merge
preview; merely changing the manifest does not migrate existing seed-once files.

Clean Architecture design review: the proposed boundaries address all seven planner
checks (isolated rules, inward imports, replaceable persistence, delivery independence,
external drivers, acyclic graph, one composition root). This is a design target, not a
measured score for current or future code.

## NFR check

| Area                            | Applies? | Target or decision                                                                                                                                                                                                 |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security                        | Yes      | Zero writes outside selected project through project ports; reject symlink/junction write traversal and stale plans; runtime evidence is data, never executable instructions                                       |
| Privacy and compliance          | Yes      | No secrets, personal absolute paths or raw environment dumps in shareable/committed evidence; local detail is explicitly scoped                                                                                    |
| Performance and capacity        | Yes      | Inventory only the chosen project and runtime-returned evidence; no whole-disk scan. Provisional fixture target: 10,000 managed entries under 5 seconds on a recorded reference machine, excluding external probes |
| Reliability                     | Yes      | Single project writer; zero content mutations on repeat; fault injection at each transaction boundary; unknown external effects require reconciliation                                                             |
| Observability                   | Yes      | Every action has stable identity, reason, owner, before/after state, outcome and next step; unknown differs from failed and skipped                                                                                |
| Operability                     | Yes      | Preview precedes mutation; journal/receipt provides recovery; guided runtime fallback is first-class; no claim of atomicity across project and shared runtime                                                      |
| Compatibility and versioning    | Yes      | Versioned handoff/plan records; unknown versions fail closed for mutation; known migrations have fixtures; no legacy alias restoration                                                                             |
| Cost                            | Yes      | No mandatory hosted service, paid API, or extra model call; local project diagnostics run offline                                                                                                                  |
| Usability and accessibility     | Yes      | Text and JSON expose equivalent decisions; no color-only errors; ask only missing/conflicting choices and explicit extra-runtime scope                                                                             |
| Maintainability and testability | Yes      | Core tests need no filesystem/process; port-contract tests and import-boundary checks prevent host-specific installation logic entering core                                                                       |
| Portability and environment     | Yes      | Existing Windows/Linux/macOS, Node 20/24 matrix; Windows junction and case behavior, POSIX links and physical temporary paths covered                                                                              |

## Quality gates

- **Per slice:** Pass the stated acceptance checks with observable output; update relevant
  schemas, fixtures and docs together. Run focused tests first, then the relevant existing
  validators. Run `pnpm validate:release` for integrated PR readiness, not for this plan.
- **Instruction gate:** Validate payload source/target mapping, all template pointers,
  preservation of authored consumer policy and installed/source distinction. The root
  development policy must not be in the consumer adoption payload.
- **Runtime gate:** Two synthetic runtimes with different opaque installation strategies
  must work with the same requirements and application policy. An actual host trial
  reports what was observable; mocks cannot establish real host discovery.
- **Review points:** S2 contract design; S4 ownership and stale-plan rules; S5/S6 path,
  recovery and migration behavior; S7 packaging and user-facing flow. Propose standard
  profile for isolated documentation/diagnosis, high-assurance for mutation/ownership
  contract changes, subject to the repository's classification validators. High-assurance
  human security and acceptance review remains a pre-merge PR gate.
- **Rollback:** Before project commit, restore transaction-owned mutations; after commit,
  use a receipt-bound inverse only if touched content still matches. Preserve subsequent
  edits as conflicts. Archive only specifically approved files with exact bytes and a
  manifest. Runtime rollback belongs to the runtime; never promise it if unsupported.
- **ADRs:** Separate development and consumer policy; runtime-owned installation and
  evidence contract; incremental adoption ownership/recovery; explicit reopening of
  legacy migration support. Link and supersede affected decisions without rewriting history.
- **Publication:** The subsequent maintainer request authorizes scoped GitHub tracking,
  execution evidence, workstream commits/push and reviewable PR preparation. Merge, tag,
  release, package publication and shared installation/update need separate authority.

## Goal conditions

The test filenames below are planned acceptance surfaces to be created in their slices.
They are not currently available checks. Each future command must exit 0 and its result
must be shown in the conversation. A turn limit triggers scope review, not a success claim.

- **S1:** Consumer policy is independently packaged and root development instructions
  are excluded from adoption. Prove with `pnpm exec vitest run lib/__tests__/onboarding-template.test.mjs`,
  `pnpm validate:docs`, and `pnpm test:package`. Preserve authored fixtures and runtime
  installations. Stop if A6 cannot be met or after 20 turns.
- **S2:** Generic requests and evidence support both synthetic runtimes and manual fallback.
  Prove with `pnpm exec vitest run lib/__tests__/onboarding-runtime.test.mjs` including
  shared-update choices, malformed evidence and unknown outcomes. No host installer
  execution. Stop if A1, A2 or A3 fails or after 20 turns.
- **S3:** Every scenario has an explicit read-only classification. Prove with
  `pnpm exec vitest run lib/__tests__/onboarding-inventory.test.mjs`, including before/after
  hashes and a bounded 10,000-entry measurement. No real installation probes with side
  effects. Stop if A4, A5 or A7 fails or after 20 turns.
- **S4:** Plans are deterministic, minimum-change, scoped and stale-sensitive. Prove with
  `pnpm exec vitest run lib/__tests__/onboarding-plan.test.mjs`. Unknown ownership remains
  unresolved until explicit disposition. Stop if A1, A3, A4 or A8 fails or after 20 turns.
- **S5:** New and partial projects converge and interrupted operations recover. Prove with
  `pnpm exec vitest run lib/__tests__/onboarding-apply.test.mjs lib/__tests__/contained-adoption.test.mjs`.
  Repeat apply changes zero content; external links and authored data stay intact.
  Stop if A3, A4 or A7 fails or after 25 turns.
- **S6:** Known migrations and unknown-state selective recovery preserve unselected bytes.
  Prove with `pnpm exec vitest run lib/__tests__/onboarding-migration.test.mjs`, including
  old instruction mappings, explicit archival and subsequent-edit rollback refusal.
  No real consumer migration. Stop if A6 or A8 fails or after 25 turns.
- **S7:** Generic entrypoints cover the scenario matrix and distinguish all readiness states.
  Prove with `pnpm exec vitest run lib/__tests__/onboarding-e2e.test.mjs` and
  `pnpm validate:release`; report CI results separately by OS/Node. Any live host trial
  needs its own authorized target and provenance. Stop if A2, A5 or A7 fails or after 25 turns.

## Stop conditions

Return the affected slice to planning if it requires host-specific installation policy
inside AgentFlow, writes outside project scope, guesses ownership of unknown content,
cannot preserve authored policy, lacks historical fixtures for a proposed automatic
migration, or finds an incompatible runtime evidence contract. Report affected assumptions
and continue independent read-only work where useful. Network unavailability alone is
an explicit unknown state, not permission to guess an update result.

The original planning task changed only this document. The later execution request
authorizes setup and governed workstream execution. A dispatch must still identify its
issue, phase, scope and action boundary; it never inherits permission to change shared
installations or bypass the human review gate.

## Approval

Scope and execution setup were authorized by the maintainer in the current session.
Record real phase outcomes and remaining gates on the linked issues; do not replace
evidence with this authorization statement.
