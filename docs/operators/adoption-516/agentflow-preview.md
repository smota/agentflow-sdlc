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
The [desired execution preview](desired-execution.preview.json) is now represented explicitly in
the source adapter policy with `executionPolicy.activation: held`, separate from active logical
role routing. This machine-enforced hold keeps planning available but rejects installed squad
materialization, including the proposed Pi/Munito Qwen builder. Claude's native Sonnet5.5 review route was observed in bounded delivery
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

The held adapter policy applies the same safeguards as Dendro: fresh provision rejects an existing
spec, orphan Pi bridge or steering state before any setup write; existing-squad update requires a
source-bound mutation host and otherwise holds. Public mutation previews expose hashes and selected
contract deltas rather than arbitrary installed YAML. The new source policy does not deploy the
installed tuples above or waive coding calibration, actual-route observation, custody or review.
Generic base template install/update remains a separate explicit maintenance operation whose live
effects require its own setup authority; it is not automatically protected by project activation.

## Installed base parsing hold

A bounded read of the three installed base `configurations.yaml` files found a real pre-existing
setup blocker. Delivery (`agentflow`) and steering (`agentflow-steer`) parsed strictly; product
(`agentflow-product`) did not. The product file repeats `presets.balanced-grok-lead` at lines 17
and 29, producing `DUPLICATE_KEY` at line 29. The two values are identical. No raw installed
configuration, credentials or host paths are included in this record.

| Installed base      | Configuration SHA256                                               | Strict parse  |
| ------------------- | ------------------------------------------------------------------ | ------------- |
| `agentflow`         | `258e5729c807ce6a9f3fdc65fe4211bc8597070513b5434ab1e62d7b34ffdf58` | valid         |
| `agentflow-product` | `21fa31ee311dc2514ad3ed802acbef1bca049869d46cb2325ad7534b640ac908` | duplicate key |
| `agentflow-steer`   | `4b088d2d84916c7c7ea2da44ac4bb166d9029e1602a2eb2cf95593ee3321b87e` | valid         |

The real-home desired plan therefore remains blocked. The lifecycle correctly reports the installed
parse failure rather than silently substituting source defaults and claiming an observed setup.
An ignored, absent staging home instead produced eight held source contracts with `effects: []`
and no home creation. That verifies source planning only.

A minimal repair candidate exists in repository-local scratch for review, not deployment. It removes
only the second identical entry (lines 29–31); strict parsing succeeds and the effective parsed
configuration is unchanged. Candidate SHA256 is
`b183c4f221e10df723ed9701c5cd3258465a0eea82a0b57cdcdc6e13fb258018`; its three-line removal patch
SHA256 is `e161f1c6a45cac0f2da3e420709a8e9299b9922188b1fb4f4a87602176e4578f`.
Recheck the exact before hash and review the patch before any installed write. Base upgrade or
repair is a separate setup action; repairing parsing does not establish runtime readiness, mutate
existing squad authority, qualify Munito, recover custody or resume work. No installed file was
changed during this diagnosis.

## Reviewed parse repair applied

The person confirmed pending setup authorizations with GO. After exact before-hash and regular-file
checks, the three-line identical duplicate preset was removed from the installed product base.
The after hash is `b183c4f221e10df723ed9701c5cd3258465a0eea82a0b57cdcdc6e13fb258018`;
strict parsing and effective-configuration equality passed, and readback matched. A private local
rollback copy preserves the original bytes. No profile, hook, model choice, service or live seat
changed. This supersedes the earlier dated statement that this parse-only repair was unapplied.

The actual public planning command using the real installed bases now succeeds with eight held
contracts and `effects: []`. Installed project rigs, runtime observation, historical custody and
human acceptance remain separate obligations. Repairing YAML syntax does not establish readiness.
