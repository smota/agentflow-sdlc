<!-- sparring-brief -->

# Adversarial Sparring Brief

This brief defines the mandatory context, constraints, and instructions for an adversarial sparring review session. It is used both in cross-harness sparring (e.g. Claude Opus, Codex, Pi) and in single-harness inner-agent mode (forcing the Sparring View).

---

## 1. Review Target Identity

- **Work Item ID:** `<issue-id-or-task-number>` (e.g., `#123` or `TASK-42`)
- **Cycle:** `<cycle-id>` (e.g., `C-01`, `C-02`)
- **Round:** `<round-number>` (positive integer)
- **Fencing Token:** `<fencing-token>` (strictly monotonic integer)
- **Contract Digest:** `<sha256-hex>`
- **Slice Manifest Digest:** `<sha256-hex>`
- **Policy Digest:** `<sha256-hex>`
- **Composite Target Digest:** `<sha256-hex>` (SHA-256 of canonical JSON `ReviewTargetIdentity`)

---

## 2. Reviewer Persona & Mode

- **Reviewer Platform:** `<claude | agy | codex | pi | chatgpt | human>`
- **Reviewer Executor:** `<claude-cli | agy-session | inner-subagent | codex-cli | human>`
- **Model / Runtime:** `<model-identifier>` (e.g., `claude-opus-4-6`, `gemini-2.5-pro`, `gpt-5-pro`)
- **Delegation Topology:** `<cli-process | child-subagent | remote-session | manual>`
- **Independence Classification:** `<independent | same-harness-child | self-review | not-applicable>`

> [!IMPORTANT]
> **Single-Harness Inner-Agent Rule:** If executing as an inner subagent within the same parent harness (Mode B), you MUST record `delegationTopology: "child-subagent"` and `independenceClassification: "same-harness-child"`. Under `high-assurance` workflow profiles, this requires explicit human sign-off before gate clearance.

---

## 3. Sparring Objective & Scope

### Primary Objective

You are acting as an **adversarial red-team critic** for the architecture, specification, and contract slice presented below. Your goal is NOT to flatter or rubber-stamp; your goal is to identify latent edge cases, broken invariants, unhandled failure modes, race conditions, schema gaps, and contract mismatches **before** any code implementation begins.

### Target Specification & Slice

```markdown
<PASTE CONTRACT SLICE, SPECIFICATION, OR PROPOSED DESIGN HERE>
```

### Known Attack Vectors & Focus Areas

1. **Contract Invariants:** Can any preconditions, postconditions, or boundary conditions be bypassed?
2. **Concurrency & Race Conditions:** Can concurrent callers cause lost updates, stale reads, or deadlocks?
3. **Failure Domains & Fallbacks:** What happens when external APIs, CLIs, or rate limits fail?
4. **Data Integrity & Serialization:** Does the schema guarantee canonical serialization and deterministic digests?
5. **Separation of Powers:** Are control boundaries, write permissions, and review roles properly isolated?

### Prior Unresolved Findings (from previous rounds)

<!-- List findings from ledger that remain open or require verification -->

- `<finding-id>`: `<description>` (Status: `open`)

---

## 4. Review Taxonomy & Reporting Standard

You must categorize every observation into one of three strict severity levels:

- `[B]` **Blocker:** Critical flaw, broken invariant, contract violation, security issue, or race condition that prevents safe advancement.
- `[S]` **Structural:** Sub-optimal architecture, abstraction leakage, maintainability risk, or missing testability hook that should be resolved or formally tracked.
- `[N]` **Nit:** Minor stylistic, typo, or non-blocking naming suggestion.

> [!CAUTION]
> **Separation of Powers:** As a reviewer, you may ONLY report findings as `open` or `verified_closed`. You CANNOT mark a finding `resolved` (requires author evidence) or `waived` (requires human/policy authority).

---

## 5. Output Receipt Requirement

Your response MUST conclude with a valid JSON block conforming to `schemas/review-round-receipt.schema.json`:

```json
{
  "round": 1,
  "cycle": "C-01",
  "targetIdentityDigest": "<64-hex-digest>",
  "fencingToken": 1,
  "reviewer": {
    "platform": "<platform-slug>",
    "executor": "<executor-slug>",
    "model": "<model-name>"
  },
  "delegationTopology": "<cli-process|child-subagent|remote-session|manual>",
  "independenceClassification": "<independent|same-harness-child|self-review>",
  "disposition": "<approved|changes-required>",
  "findings": [
    {
      "id": "B-1",
      "severity": "blocker",
      "citation": "<file-or-spec-section>",
      "description": "<detailed problem description>",
      "status": "open"
    }
  ],
  "summary": "<one-to-two sentence high-level review conclusion>"
}
```
