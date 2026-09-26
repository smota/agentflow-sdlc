# Reusable harness dispatch and bounded artifact contracts — S6

`lib/providers/harness-dispatch.mjs` implements provider dispatch validation, capability preflights, context budgeting, and bounded artifact return verification for autonomous execution harnesses.

## Architecture & Guarantees

1. **Capability preflight and provenance**:
   - Inspects the execution provider before dispatch via `inspect()` to confirm provider availability.
   - Enforces declared `executionTarget` against supported `provider.targets`.
   - Explicitly validates all required capability intents (e.g., `plan-before-edit`, `workflow-orchestration`) against `provider.intentSupport`.
   - Records explicit requested target and model without silent substitutions.

2. **Bounded control context**:
   - Strictly enforces the bounded control context budget `<= 32 KiB` (`MAX_CONTROL_CONTEXT_BYTES = 32 * 1024`).
   - Prevents prompt bloat and context poisoning by refusing payloads exceeding the limit.

3. **Permission boundary enforcement**:
   - Rejects write capabilities (`file-edit`, `commit`, `workspace-edit`) when the dispatch permission boundary is restricted to `observe`.

4. **Cryptographic artifact verification**:
   - Output artifacts must declare safe relative workspace paths (`safePath`). Path traversals or prohibited system paths are rejected (`INVALID_ARTIFACT_PATH`).
   - Per-artifact size limit enforced `<= 10 MiB` (`MAX_ARTIFACT_BYTES`).
   - All returned artifacts are cryptographically verified against SHA-256 digests (`ARTIFACT_DIGEST_MISMATCH`).
   - Verifies presence of all declared `expectedArtifacts`.

5. **No silent truncation**:
   - Output containing explicit truncation indicators (`truncated: true` or `[truncated]` markers) is rejected (`OUTPUT_TRUNCATED`) to prevent corrupt or partial code application.
   - Empty or unparseable output is rejected (`EMPTY_OUTPUT`, `MALFORMED_OUTPUT`).
