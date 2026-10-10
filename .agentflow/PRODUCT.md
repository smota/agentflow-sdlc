# Product Definition: AgentFlow SDLC

## 1. Vision & Core Job-to-be-Done
- **Primary Customer Job**: When engineering teams deploy autonomous AI coding agents on complex codebases, I want to govern agent transitions through deterministic state machines and verifiable evidence contracts, so I can accelerate software delivery without regressions, compliance violations, or process chaos.
- **Target User / Customer**: Software architects, engineering leaders, and multi-agent squads in regulated or high-velocity environments.
- **Value Proposition**: Bounded agent autonomy with tamper-evident auditability, cross-platform portability, and human supervisory comprehension.

## 2. System Invariants (Non-Negotiables)
- `INVARIANT 1`: Autonomy without auditability is a liability; governance without ergonomics is abandoned.
- `INVARIANT 2`: Extensibility and harness neutrality; core SDLC logic must remain strictly decoupled from vendor-specific session formats or CLI targets.
- `INVARIANT 3`: Separation of Duties; product management proposes outcomes, builders mutate worktrees, and testers/reviewers strictly observe.
- `INVARIANT 4`: Zero Deadlock; all asynchronous verification gates and return loops must resolve within deterministic bounds.

## 3. Intentions & Tradeoffs
- **Core Values**: Deterministic governance over unconstrained prompt-chasing; human supervision at boundaries over opaque autonomy.
- **Tradeoff Priorities**:
  - Prefer explicit, verifiable receipts over fast, unverifiable mutations.
  - Optimize for portability and crash recovery before local performance.

## 4. Capability Map & Boundaries
| Capability ID | Module Responsibility | Boundary & Dependencies |
| :--- | :--- | :--- |
| `phase-state-machine` | SDLC phase graph, forward steps, and loop guards | Pure JavaScript (`lib/core/phase-graph.mjs`) |
| `audit-ledger` | Cryptographic role-flow span chaining and receipts | `lib/audit/` |
| `evidence-contracts` | Verification observations, test receipts, and gates | `lib/core/verification-observation.mjs` |
| `openrig-adapter` | Thin-layer execution seats, process bridges, and squad topology | `adapters/openrig/` |
| `product-discipline` | JTBD discovery, Spec-Driven Development, and capability maps | `docs/sources/product-discipline.md` |

## 5. Active Horizon & Anti-Goals
- **Active Initiatives**:
  - Bidirectional coordination seam between product management and delivery.
  - Codification of minimal product standards and Spec-Driven Development.
- **Anti-Goals (Explicitly Forbidden)**:
  - Do not mix engineering toolchains into product management roles.
  - Do not reference external runtime URLs inside agent prompt instructions.
  - Do not hardcode execution-seat identifiers into core AgentFlow state machines.
