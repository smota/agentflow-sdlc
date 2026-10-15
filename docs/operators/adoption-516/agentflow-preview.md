# AgentFlow setup adoption — 2026-10-15

This source preparation addresses [#527](https://github.com/smota/agentflow-sdlc/issues/527)
after the [held Dendro preview](dendro-preview.md). It does not deploy source into installed
OpenRig, start a service, change profiles/hooks, or claim the Dendro adoption dependency is
satisfied. The same runtime, authority, custody and publication gates remain in force.

## Source routing changes

The actual direct role-routing loader reads `agent-workflow.config.json`. Its former Grok PM,
architecture and review selections and Claude builder selection conflicted with this delivery's
Codex-led plan. The source now explicitly selects native Codex for PM, analysis, architecture,
planning, implementation, testing and PR preparation; native Claude handles review and writing.
Grok is disabled and removed from these fallback chains. Pi is registered but disabled until
coding/tools/runtime qualification supports the proposed Munito Qwen builder route.

The actual `loadProjectConfig`/`resolveRoleRoute` tests exercise these choices with availability
probes disabled, so they prove configuration behavior, not installed access or account readiness.
The selected execution target remains `codex-cli` or `claude-cli` regardless of the launcher's
harness. Persistent effort remains medium, routine search low, and high effort requires a fresh
bounded child. Routing chooses an executor, not a model or a grant. Pass the reviewed desired
tuple explicitly at invocation; record actual model/effort as unknown when unobserved.

The global model catalog is retained as inventory/recommendation history. Its preferred-model
metadata is not promoted into an actual route, especially for the unqualified Qwen builder.
The [desired execution preview](desired-execution.preview.json) is held and separate from that
active source routing. Claude's native Sonnet5.5 review route was observed in bounded delivery
review records; the current main Codex model/effort is not independently attested here.

Source delivery configuration, coordination branch, candidate/check definitions and existing
publication-only delegation policy remain unchanged. Existing grants are not reused or widened
to cover recovery, installed-rig changes or this goal. A route or source config change supplies
no new authority, source state, acceptance or publication approval.

## Installed setup remains separate

The [dated installed preview](installed-preview.snapshot.json) preserves exact before/after
hashes and existing rig identity. Actual `agentflow-dev` declares a Pi/Gemini builder, Pi/Grok QA
and Codex review. `agentflow-pm` declares Pi/Grok PM plus a Claude analyst at high effort with no
pinned model. `agentflow-steer` declares an old Claude model at high effort. None is claimed
updated by the source routing commit.

The proposed installed configuration uses Codex Sol medium for orchestration/PM, low for QA/eval,
Claude Sonnet5.5 medium for review, and a held Pi/Munito Qwen builder. The same preflight contract
used for Dendro must verify actual route, identity, source history, oracle writer capability,
external steering return path and durable custody before admission. An external supervisor does
not need a local steering seat and does not gain authority from that seat's existence.

`agentflow-dev`, `agentflow-pm`, and `agentflow-steer` already match generic naming rules; there
is no doubled-prefix issue for this project. Dendro's existing `dendro-*` names are different and
must be preserved through explicit mutation planning. Desired YAML was staged against each
actual installed rig, with name and working directory preserved and stale model-specific
summary prose replaced by neutral execution-contract guidance. No installed file was written.

## Apply and rollback boundary

After Dendro's accepted adoption checkpoint and a current approved preview, inspect the explicit
installed rig IDs, workload custody and native source bindings. Use the reviewed source-bound
mutation transaction with typed grants, finite deadlines, stopped/fenced old writers, verified
readback and rollback. Unsupported Pi model observation and unqualified coding capability remain
holds. Preserve all human/security/acceptance and publication requirements.

Source rollback is an issue-scoped revert after checking no newer source change would be lost.
Installed rollback restores exact saved before bytes only while after hashes still match, and
reconciles external effects before compensation. Neither operation resets history or touches
unrelated original modifications. The original repository's dirty product skill files and all
Dendro modifications remain outside this source preparation.
