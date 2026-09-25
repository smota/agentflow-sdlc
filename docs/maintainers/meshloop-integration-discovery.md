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
