## Role Pass

**Issue:** #<number> — <title>
**Branch:** <branch>
**Phase:** <number>
**Role:** <product-manager-jtbd | analyst | architect | developer-planning | developer | tester | review | tech-writer | pr-readiness>
**Status:** <pass | blocked | returned | skipped>
**Workflow profile:** <bounded | standard | high-assurance | exploratory>
**Action boundary:** <observe | propose | mutate-worktree | open-pr | external-action>
**Planned owner:** <registered platform slug from roleAlternationPlan; use "not-applicable:single-agent" only when Mode is single-agent and this pass will not feed a multi-agent role attribution matrix>
**Executed by:** <registered platform slug; see manifests/runtime-platforms.json>
**Launcher:** <registered platform slug; see manifests/runtime-platforms.json>
**Executor:** <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human>
**Transport:** <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
**Delegation boundary:** <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
**Context boundary:** <current-session | fresh-session | forked-context | local-cli-child-process | provider-api-call | human-handoff | worktree | intercom-session> <!-- derived from Transport + Delegation boundary; see lib/role-attribution.mjs#deriveContextBoundary -->
**Independence boundary:** <independent | self-review | not-applicable> <!-- only meaningful for the review role: "independent" when the reviewer's roleIntelligence differs from the developer pass, "self-review" when it matches and is explicitly disclosed, otherwise "not-applicable" -->
**Model / runtime:** <freeform identifier or "not recorded">

### Inputs read

- <issue, spec, ADR, prior pass, diff, test output>

### Artifact references

```json
[]
```

Use portable `ArtifactRef` objects from `schemas/artifact-ref.schema.json`. A reference identifies
the authoritative source; it does not copy raw source content into workflow evidence.

### Decisions / findings

- <decision or finding>

### Capability evidence

```json
{
  "capabilitiesUsed": []
}
```

Record portable advanced capabilities from `docs/capabilities.md` when a pass requests PLAN, WORKFLOW, LOOP, SUB-AGENTS, or their framework equivalents. Include mode, adapter, artifact, required/optional status, and guardrails such as loop stop conditions or subagent boundaries.

### Collaboration evidence

```json
{
  "collaborationMode": "single-agent",
  "reason": "single-agent path was sufficient",
  "helpers": [],
  "synthesis": "not-applicable:single-agent"
}
```

Record intelligent collaboration evidence from `docs/intelligent-collaboration.md` whenever helpers, councils, bounded loops, spikes, or human-gated collaboration are used. Single-agent passes may record the compact default above.

### Open questions

- none

### Next-phase contract

- <what the next role must do>

### Transition envelope

```json
{
  "version": 1,
  "subject": "issue:<number>",
  "fromRole": "<canonical role slug>",
  "toRole": "<canonical role slug>",
  "decision": "pass",
  "nextContract": "<what the next role must do>",
  "timestamp": "YYYY-MM-DDTHH:MM:SSZ",
  "profile": "<bounded | standard | high-assurance | exploratory>",
  "actionBoundary": {
    "version": 1,
    "profile": "<bounded | standard | high-assurance | exploratory>",
    "requested": "<boundary>",
    "effective": "<boundary>",
    "parent": "<boundary or omit>",
    "enforcementRefs": []
  },
  "inputRefs": [],
  "outputRefs": [],
  "validationRefs": [],
  "openQuestions": [],
  "extensionPlays": [],
  "provenance": {
    "platform": "<platform>",
    "executor": "<execution target>",
    "transport": "<transport>",
    "delegationBoundary": "<boundary>"
  }
}
```

---

<!-- <platform> = registered runtime platform actually executing THIS pass right now — never copied from a prior pass or template example. Register built-in or project-specific slugs through manifests/runtime-platforms.json and agent-workflow.config.json; see docs/runtime-platforms.md. Executor/Transport/Delegation boundary remain distinct and come from docs/execution-targets.md. Planned owner/Context boundary/Independence boundary are role-alternation concepts from docs/agent-workflow.md §4a and lib/role-attribution.mjs; they feed roleAttributionMatrix in workflow-status comment and PR manifest. Capability evidence comes from docs/capabilities.md and can be checked with scripts/validate-capability-evidence.mjs. -->

<!-- Signature uses same registered platform slug as Executed by. -->

Signed-off-by: `<platform>` (`<role>`)
Timestamp: `YYYY-MM-DDTHH:MM:SSZ`
