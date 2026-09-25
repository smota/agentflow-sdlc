# Meshloop integration discovery — S7 / issue #269

Status: preliminary read-only evidence, not qualification or acceptance. Inspected 2026-09-25 by Codex; source revision `59e69e8988c70ea90e8d4ed87d67f4326e6258cd`. Existing AGENTS.md and docs/install.md edits preserved. No Meshloop files changed.

## Verified surfaces

- `crates/meshloop-engine/src/ports.rs` defines harness probe/invoke/cancel/collect, recovery liveness, workspace and check ports. These support an adapter boundary without importing AgentFlow into the engine.
- `crates/meshloop-cli/src/args.rs` exposes plan, review-plan, run, resume, status, cancel, inspect and other session operations. Installed `meshloop --version` reports 0.1.0; `--help` succeeds. Binary/source equivalence and live execution remain unproven.
- `crates/meshloop-cli/src/json_out.rs` exports ok/command/origin/error/data. There is no explicit envelope schema version: negotiate/version the integration profile instead of assuming stable structure.
- `crates/meshloop-engine/src/run_loop.rs` function digest uses Rust DefaultHasher and formats 16 hexadecimal digits, then supplies plan_sha256 fields. This is not SHA-256 or an interoperable artifact integrity contract. AgentFlow must calculate and verify actual bytes independently; Meshloop remediation needs a separately scoped issue.
- `accept_human` in that file checks nonempty supplied identity and task state. It does not establish authenticated human origin. Imported technical acceptance cannot satisfy AgentFlow human or delegated acceptance gates.
- Default `try_collect` delegates to blocking collect. Nonblocking capability must be proven per concrete adapter rather than inferred from trait name.

## Required next checks

1. Read accepted Meshloop runtime/CLI ADRs; map public extension points and concrete process cancellation/output drain behavior.
2. Define a neutral versioned request/result profile translated by the optional AgentFlow adapter; preserve standalone execution of both products.
3. Run neutral-client and alternate-executor conformance tests plus real standalone/integrated scenarios. Mocks alone cannot qualify a live facet.
4. Verify duplicate requests, lost acknowledgments, invalid paths/digests, stale candidates, cancellation races and fresh-instance continuation.
5. Capture supported capability/version/host matrix and separate remediation backlog. This discovery does not mark any of those tests passed.

Owner split: Agy engineering implementation; Codex authority/evidence review; Grok architecture adversarial. The approved execution plan remains the acceptance authority.

## Standalone fixture and lifecycle findings

Codex exercised the installed Windows binary on 2026-09-25 in a fresh temporary Git
repository, using Meshloop's deterministic `fixture_harness` and a single-node plan.
The repository contained no AgentFlow configuration or imports. The public `run`
command with explicit plan acceptance, configuration, database, worktree directory,
`--fixture-only` and `--json` exited zero and reported `AwaitingHumanAcceptance`.
No `accept` or integration command was invoked. This proves the installed binary can
execute that fixture independently of AgentFlow project configuration; it does not
prove live model execution, clean-machine installation independence, source/binary
equivalence, or completed engineering acceptance.

Binary identities: Meshloop SHA-256
`97781768f14e160481ef241d6a6d7daed3563f34b9ca2510c8380002f67dd573`;
fixture SHA-256 `40d4a40215bd7116fb960c7b714c99240450ee274dda0bd131ee7b428ac89717`.
The fixture had zero retries and a 15-second task timeout; the outer command was
bounded to 30 seconds. Local raw evidence remains scratch, with private paths omitted here.

Two additional integration constraints are confirmed:

- The observed `--json` stdout begins with human-readable notes before the JSON
  envelope. A whole-stream JSON parser therefore fails. The adapter needs a qualified
  bounded framing strategy or a Meshloop change guaranteeing machine-only stdout;
  arbitrary brace extraction is insufficient because malformed or conflicting output
  must not become accepted evidence. Track this with the envelope/version remediation.
- Accepted ADR0021 and `reset_graph_execution` in
  `crates/meshloop-adapters/src/store.rs` explicitly delete graph events, attempts and
  evidence on restart. `resume --restart` and `run --reset` are destructive engineering
  operations, not ordinary continuation or an idempotent retry. The integration must
  preserve required evidence before any separately authorized restart, or leave that
  facet unsupported. Never map AgentFlow continuation to those flags implicitly.

ADR0022 replaces the earlier Herdr execution assumption with direct CLI execution.
Current adapters and binary tests must determine transport capabilities; ADR0017's
older live-transport description alone cannot qualify them. Process-tree and output
drain guarantees from ADR0025 still require concrete adapter fault tests.

## Grok advisory review and Codex disposition

Review completed 2026-09-25 through local `grok-cli`, requested `grok-4.7`, reported usage model `grok-4.7-build`; launcher Codex, separate local session. Reviewer consumed this supplied discovery report and boundary brief only, with no independent repository inspection or runtime qualification. Original response is advisory, not implementation acceptance. Raw runtime logs are excluded from product documentation.

- Accepted: independently hash retrieved bytes; treat foreign `plan_sha256` as opaque correlation until algorithm-tagged integrity is proven. No technical/human-like Meshloop status can satisfy an AgentFlow authority gate.
- Accepted: version the binding/profile, negotiate required capabilities, bind receipts to intent/candidate/operation identity, and reconcile unknown outcomes before retry.
- Accepted: concrete nonblocking collect, cancellation/output draining, process recovery and artifact containment require real facet qualification. Version/help output does not identify the binary with reviewed source.
- Accepted: preserve existing CollaborationIntent, ProviderBinding and ExecutionReceipt instead of introducing another SDLC orchestration kernel. Both products must build and run independently.
- Adjusted: the advisory recommendation for a separately shipped adapter package is not a prerequisite. The approved plan permits an optional adapter module behind existing ports; prove dependency isolation before deciding whether extraction is useful.
- Adjusted: blanket rejection of every added envelope field would prohibit compatible evolution. Reject incompatible versions, missing or retyped required fields and unknown required capabilities; handle optional extensions according to an explicit profile compatibility rule.
- Severity calibration: integrity and authority findings block claiming those integration capabilities; they do not establish an exploitable current AgentFlow integration, which is not implemented or qualified yet.

Add live validation cases for duplicate intent, lost completion acknowledgment, missing artifacts, unchanged foreign hash with changed bytes, forged identity/origin, cancellation races, stale scope, symlink escape, replayed receipt and fresh-instance recovery. Keep neutral-client and absent-product tests alongside integrated runs. Proposed Meshloop remediations remain a separately scoped backlog: envelope/version policy, truthful algorithm-tagged digest naming, documented identity assurance, concrete lifecycle capability contracts and neutral fixtures.
