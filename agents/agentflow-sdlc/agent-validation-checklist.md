# Agent validation checklist

## Package completeness

- [ ] `AGENT.md` defines goal, users, non-goals, inputs, outputs, mutation authority, and review policy.
- [ ] Knowledge, tool/action, runtime, handoff, execution, guardrail, maturity, eval, changelog, and improvement-loop docs exist.
- [ ] Package docs link to canonical repository authorities instead of redefining them.

## Required commands

```bash
pnpm test:workflow
node scripts/validate-role-routing.mjs
node scripts/validate-branch-strategy.mjs
node scripts/validate-extension-packs.mjs --allow-empty
node scripts/run-agent-evals.mjs --manifest agents/evals/manifests/framework-contracts.json
```

## Recommended commands before PR readiness

```bash
pnpm test
pnpm format:check
node scripts/verify-hooks.mjs
```

## Evidence checks

- [ ] Active `SPEC.md` validates.
- [ ] Role-pass evidence records launcher, executor, transport, delegation boundary, and model/runtime.
- [ ] Capability evidence exists when PLAN/WORKFLOW/LOOP/SUB-AGENTS are requested.
- [ ] Capability, tool-permission, and control-requirement namespaces are not conflated.
- [ ] New cross-harness passes use canonical roles, `ArtifactRef`, a valid transition envelope, and
      an effective action boundary that does not exceed its parent/profile.
- [ ] External signals enter through Product manager / JTBD or Analyst; delivery handoffs preserve
      external ownership and validation/rollback evidence.
- [ ] PR manifest includes implemented issue lines, validation status, agent review fields, merge owner, and follow-up status.
- [ ] Multi-agent mode claims include a valid role-attribution matrix.
