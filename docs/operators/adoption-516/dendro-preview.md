# Dendro adoption preview — 2026-10-15

This is a reviewed preparation candidate for [#526](https://github.com/smota/agentflow-sdlc/issues/526),
not an applied migration, a resumed backlog, or verified runtime readiness. The proposed
[execution policy](desired-execution.preview.json), [installed field preview](installed-preview.snapshot.json),
and [bounded calibration results](model-calibration.json) retain explicit holds.

## Current evidence

Dendro HEAD was `81f5a90c4432c08b5a59797edfc3e3c23d63eaa0`. Its pre-existing dirty AGENTS
content was preserved, SHA256 `9115f41d1970fd48c613a08be54d82b433195ec06ce8405b608340200dc7993e`.
The workflow baseline was SHA256 `2fd497eb824052590ac6841c9562135f1fcff7fe231421b2f508b5e6707d0a74`.
PRs [56](https://github.com/smota/dendro/pull/56) and [58](https://github.com/smota/dendro/pull/58)
were both merged; the earlier description of PR58 as a current draft is obsolete. Their merge
states do not establish recovery of historical G2 custody or authorize backlog continuation.

Installed `dendro-dev` declares Codex orchestration/review and Pi Antigravity Gemini builder,
QA and eval. `dendro-pm` declares Pi/Gemini PM and analysis. AGENTS prose instead names Grok
builders, Codex QA and Claude PM, and says high-assurance work needs no human approval.
Actual `sdlc.config.json` requires human approval for high-assurance work and external actions.
That conflict is corrected in the proposed targeted prose patch. Managed culture and unrelated
Rust rules remain byte-preserved.

Logical `routing.defaultMode: single-agent` is deliberate compatibility behavior; it does not
prove the physical fleet has one seat. The desired adapter execution policy is added to the
existing workflow configuration, which the authority loader supports. This avoids a wholesale
configuration consolidation while direct routing callers still read the legacy workflow file.
No model inventory, probe, desired tuple or configured pin becomes actual execution evidence.

`CODEX.md` and `docs/guiding-principles.md` were absent. The concrete patch proposes a scoped
consumer adapter and principles derived from the seeded governance and existing Rust policy,
without importing framework-internal implementation paths. These missing documents remain
an adoption obligation until the outside-repository patch is reviewed and applied.

## Desired role policy and qualification

| Role                    | Desired route                | Effort        | Admission                                                |
| ----------------------- | ---------------------------- | ------------- | -------------------------------------------------------- |
| Orchestrator and PM     | Codex CLI, GPT-6.1 Sol       | medium        | verified source authority and current execution required |
| Builder                 | Pi, Munito, Qwen 3.8 27B     | medium        | held for coding/tools/runtime qualification              |
| QA and eval             | Codex CLI, GPT-6.1 Sol       | low           | read-only verification; no oracle-authoring authority    |
| Independent review      | Claude CLI, Sonnet 5.5       | medium        | exact candidate and independence required                |
| Protected oracle author | bounded `dev.test-eng`       | task-selected | separate task authority and oracle custody required      |
| External steering       | authenticated external owner | task-selected | return route, scope, challenge and decision verified     |

All actual runtime/model/effort observations remain unknown for this adoption preview. Sonnet
5.5 is a tested native CLI route in delivery review evidence; it is not a general provider-API
availability claim. Persistent high effort is removed from proposed project policy. High effort
remains limited to fresh bounded design or adversarial review work.

The [fixed extraction oracle](model-calibration-oracle.json) was frozen before one no-tool,
no-session request per Munito model. Qwen3.8, GLM5.3 Flash, DeepSeekV4 Flash and Qwen3.6 35B A3B
matched; Gemma4 12B did not. The earlier DeepSeek recovery-analysis semantic failure remains
recorded. These tiny passes qualify only that extraction task. None establishes coding ability,
provider-family identity, runtime observation, protected oracle authority, or recovery judgment.
GLM/Gemma/Qwen3.6 remain inventory/extraction candidates at supported effort `off`; Gemma's
failed task prevents promotion. Munito models share a provider route and are not independent
quota failover. Keep at most one Munito worker until actual route health is verified.

## Transaction preview and rollback

1. Recheck the exact repository HEAD, dirty AGENTS bytes, workflow hash and installed rig hashes.
   A mismatch invalidates this preview; rebuild it without overwriting the changed files.
2. Preserve the current dirty AGENTS baseline as rollback bytes. Apply only the targeted prose,
   scoped missing documents and workflow adapter override from the reviewed patch. No native
   run, epoch, fence, candidate manifest or historical binding is initialized.
3. Stage desired YAML from each existing installed rig, retaining its name, pod/member identity
   and working directory. Use explicit `dendro-dev`/`dendro-pm` rig IDs in the source-bound mutation
   preview. Generic provisioning would instead name `agentflow-dendro-*`; that is not this migration.
4. Review profile/permission changes separately. A referenced test-engineering profile is not
   a granted capability. Installed profile bridges, hooks, services and live seats are unchanged
   by this preparation. No new local steering seat is required to authenticate an external owner.
5. Recover G2 run/source/epoch/fence and queue custody from existing records. The current delivery
   configuration says `local-preview` with empty candidate inputs; it cannot establish those
   historical bindings. Missing history and unsupported Pi observation keep admission held.
6. After explicit outside-repository/setup approval and prerequisite evidence, use source-bound
   mutation admission and readback. Source and installed configuration changes remain distinct.
   Preserve the backlog pause, all existing publication holds, failed oracle audits and partial work.
7. Roll back only the exact files written by the accepted transaction, after confirming their
   current bytes still match the transaction's after hashes. Restore the saved before bytes;
   never use checkout/reset to erase the pre-existing AGENTS delta. Reconcile any external
   mutation before compensation. Rollback does not reset source history or fencing.

The concrete repository patch passed `git apply --check` against the dirty Dendro baseline.
A separate staging copy applied it and ran the actual public squads planning CLI: eight coherent
contracts, `effects: []`, `observation: not-performed`, no staging home created. The installed
preview uses the actual source materializer against existing rig text, preserving IDs and working
directories; it does not provision or restart anything. Required runtime, custody, authority and
human review gaps remain visible rather than being replaced with success claims.
