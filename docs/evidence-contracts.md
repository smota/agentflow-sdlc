# Portable evidence contracts

AgentFlow uses versioned JSON contracts as the machine authority for handoffs. Markdown role passes
are human-readable projections; creating a file never advances a phase by itself.

## Canonical vocabulary

Roles and profiles come from `sdlc.config.json`. Canonical roles are `product-manager-jtbd`,
`analyst`, `architect`, `developer-planning`, `developer`, `tester`, `review`, `tech-writer`, and
`pr-readiness`. `product-manager`, `developer-plan`, and `techwriter` are accepted only as
deprecated input aliases. Outputs use canonical slugs. Profiles are `bounded`, `standard`,
`high-assurance`, and `exploratory`.

## ArtifactRef and transition envelope

An `ArtifactRef` identifies evidence without copying the source into AgentFlow. It records artifact
kind, source system, URI, authority, relationship, and—when available—revision or digest. Only one
authoritative reference may exist for the same kind and scope. Referencing an external source never
transfers its ownership to AgentFlow.

A version-1 transition envelope records subject, canonical current and next roles, decision,
next-role contract, timestamp, input/output/validation references, open questions, and actual
platform/executor/transport/delegation provenance. The current-role decision and configured graph
remain authoritative. Existing role-pass v1 Markdown remains readable; new portable outputs add
this envelope.

```text
node bin/cli.mjs sdlc validate-evidence --type artifact-ref --path artifact.json
node bin/cli.mjs sdlc validate-evidence --type transition-envelope --path transition.json
```

## Three requirement namespaces

- Workflow capability: requested behavior such as planning or orchestration.
- Tool permission: allowed operation such as read, shell, edit, network, external write, or deploy.
- Control requirement: independently enforced or evidenced boundary such as single-writer,
  review independence, branch protection, or human approval.

Legacy extension `requiredCapabilities` remains readable with a deprecation warning. New manifests
use `requiredWorkflowCapabilities`, `requiredToolPermissions`, and `controlRequirements`. Prose
alone cannot satisfy a control.
