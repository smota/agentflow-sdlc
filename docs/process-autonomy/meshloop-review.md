# Meshloop interface review and optional provider adapter — S7

`lib/providers/meshloop-provider.mjs` delivers the optional adapter for Meshloop engineering execution under issue #269, fulfilling checkpoints M1–M6 from `docs/maintainers/process-autonomy-execution-plan.md`.

## Architecture & Guarantees

1. **Bidirectional independence**:
   - AgentFlow core never imports Meshloop packages, reads Meshloop configuration, or accesses its private SQLite database (`.meshloop/state.sqlite`).
   - Meshloop remains independent of AgentFlow; it requires no AgentFlow packages, GitHub workflows, or durable run stores.
   - When Meshloop is absent or unconfigured, AgentFlow completes all SDLC workflows directly through built-in local CLI or API providers (`claude-cli`, `codex-cli`, `agy-cli`, `grok`).

2. **Responsibility & authority boundary**:
   - **AgentFlow**: Owns approved intent, governance policy, delegation grants, phase transitions, evidence evaluation, and authoritative delivery/merge decisions.
   - **Meshloop**: Owns bounded technical task execution, DAG decomposition, and execution verification.
   - **Technical vs SDLC boundary**: Technical execution states (such as `AwaitingHumanAcceptance` or `data.status: 'ok'`) produce technical execution receipts (`status: 'pass'`), but never satisfy AgentFlow SDLC acceptance gates or bypass human review.

3. **Framing & output integrity**:
   - Bounded framing handles both strict JSON output and the known CLI notice prefix (`Note: worktrees are kept...`).
   - Unrecognized preambles, corrupted output, or payloads exceeding 64 KiB (`MAX_OUTPUT_FRAME_BYTES`) are rejected (`UNQUALIFIED_OUTPUT_FRAMING`, `OUTPUT_FRAME_OVERSIZED`).
   - Foreign 16-hex digit hashes (`DefaultHasher`) or foreign `plan_sha256` are treated as unverified correlation markers; all returned artifacts are independently hashed and verified using SHA-256 byte hashing.

4. **Destructive continuation fencing**:
   - ADR0021 and `reset_graph_execution` in Meshloop delete graph events, attempts, and evidence on `--restart` or `--reset`.
   - The adapter strictly prohibits `--restart` and `--reset` as ordinary continuations (`DESTRUCTIVE_CONTINUATION_PROHIBITED`) to prevent data and audit loss.
