# Run operations

Use the CLI from the installed package or `node bin/cli.mjs` in an authorized source checkout. These commands do not replace the required project policy, issue, role passes or human review.

## Inspect and configure

```text
node bin/cli.mjs doctor-env --inspect --target <project> --json
node bin/cli.mjs run --help
```

Configure `agent-workflow.config.json.delivery` with a source (`local-preview` or `github`), candidate input manifest, named checks, per-role acceptance files and per-role collaboration bundles. For GitHub also supply the exact `repo` and optional coordination `branch`. Local preview never claims durable GitHub acknowledgment.

Before creating a GitHub coordination ref, run `run source-plan <id>`, inspect the repository rules and workflow references in its plan, and authorize that exact destination. Pass its current digest to `run start` with `--setup-confirm <digest>`. A changed baseline/rules/workflow snapshot requires a new setup plan. This does not modify protections or prove permissions that the provider cannot inspect.

```json
{
  "delivery": {
    "source": { "kind": "local-preview" },
    "candidate": { "inputs": ["app.cjs", "app.test.cjs", "package-lock.json"] },
    "checks": {
      "suite": {
        "id": "suite",
        "criterionId": "query",
        "executable": "node",
        "args": ["--test", "--test-reporter=junit", "app.test.cjs"],
        "assertions": ["normalizes query"],
        "timeoutMs": 30000,
        "format": "junit-stdout"
      }
    },
    "contracts": { "product-manager": "requirements/acceptance.json" },
    "collaboration": { "product-manager": "requirements/collaboration.json" }
  }
}
```

The acceptance file uses `delivery-acceptance-v2.schema.json`. Its criterion `definitionDigest` is `recordDigest({...check, ...delivery.candidate})` from the packaged `lib/core/record-digest.mjs`. The frozen `collaborationContractDigest` identifies the existing bilateral contract, and `ownerRole` identifies its accountable owner. The collaboration bundle contains `handoff`, `contract`, `delivery`, `decision` and any required council records, as described in [role collaboration](role-collaboration.md). Run verification supplements this protocol rather than replacing its owner decision.

Input files must exist. Include the actual project dependency lock, not an invented filename. Freeze criteria before running checks. Updating a requirement or check means freezing its new version and collecting current evidence again.

For a GitHub source, `--goal` must be `issue:<number>` or an issue URL in the configured repository. The acceptance file's `goalRevision` is `recordDigest({repo, number, title, body, updatedAt})` from the current GitHub issue, with `updatedAt` taken from `updated_at`. The CLI re-fetches it when freezing and accepting; a human edit invalidates the frozen revision. A local preview uses its local contract digest and does not claim external source verification.

## Execute and inspect

```text
node bin/cli.mjs run start demo --goal issue:123 --writer operator --generation 0 --execute --target <project>
node bin/cli.mjs run freeze demo --writer operator --generation 0 --execute --target <project>
node bin/cli.mjs run verify demo --check suite --writer operator --generation 0 --execute --target <project>
node bin/cli.mjs run status demo --target <project> --json
node bin/cli.mjs run next demo --target <project> --json
```

`next` returns the current status and, when possible, an `advancePlan` with a confirmation digest. Save the plan object to a project-local file, review it, then apply it with `run advance demo --plan <file> --confirm <digest> --writer operator --generation 0 --execute`. Confirmation checks staleness; host permissions still apply. Missing bilateral acceptance remains blocked even when tests pass. The stock CLI cannot certify human review; high-assurance advancement needs an integration that resolves actual human authority.

All run output is a versioned JSON envelope. Exit codes: `0` success, `2` invalid input, `3` blocked/evidence missing, `4` stale/conflict, `5` unavailable dependency, `6` external outcome unknown. An absent run is reported explicitly.

## Checkpoint, pause and recover

`run checkpoint` records a progress boundary. `run pause --reason <text>` pauses Agentflow state; it does not pretend an arbitrary external process was stopped. Record the actual writer PID at startup with `--writer-pid` when the invoking parent is not the workspace writer.

`run resume demo --writer replacement --writer-pid <pid>` previews recovery. Save the returned plan and apply with `--plan <file> --confirm <digest> --generation <old-generation> --execute`. The plan includes the replacement identity. An unknown prior writer, changed preconditions or unresolved operation blocks transfer. Use the returned generation for subsequent commands. Never remove a lock merely because it is old.

`run publish demo --issue <number>` previews a versioned issue comment for a GitHub-backed run. Apply the saved plan with `--confirm`, the current writer/generation, `--execute` and `--boundary external-action`, under applicable publication authority. It preserves the issue body. A repeated invocation reconciles the original operation and does not submit another comment. If source acknowledgment succeeds but projection publication fails, inspect the pending operation before retrying.

Cockpit exposes the same source-derived run at `/runs/<id>` and JSON at `/runs/<id>.json`, within its configured repository and authorization boundary. It is optional and does not unlock a gate unavailable in the CLI.

`run context <id>` returns the current phase's contract, writer, candidate, findings, operation references and policy links. It avoids replaying a full transcript. Status lists missing observations explicitly; a displayed passing observation still needs fresh source resolution at acceptance.

Completed runs can still publish their final issue projection without reopening development. Pending projections remain visible and take priority in `nextAction`, including after completion.

## Integration ports

The stock `run verify` command executes project checks using the structured-report or native JUnit collector. Hosts can use `collectGitHubCheck` and `resolveGitHubCheck` for exact commit/check/app observations. `observeGitHubLifecycle` resolves merge, tag and release identity. Deployment and exercised rollback use `observeDeployment` and `observeRollback`, with provider-supplied runtime identity and required behavior assertions; a plan alone cannot satisfy exercised rollback. Feed re-resolved observations into `resolveLifecycle` separately from numbered role completion. These APIs observe outcomes; they do not deploy or operate a scheduler.

The run service accepts host `observeUsage` and `requestSafeStop` ports. Usage must be verified in the configured budget unit. The CLI has no provider usage meter, so an admission-enforced or provider-enforced budget with unknown usage pauses before launching another check. Advisory budgets disclose unknowns. A host with a verified meter can admit bounded attempts, and one with cancellation can request safe stop. Pausing the stock CLI records the checkpoint without claiming it stopped an arbitrary provider process.

Each configured budget admission records the observed usage, next-attempt estimate and their separate certainty. Status and Cockpit replay the same record. The run's budget is fixed at creation; changing its configuration requires a new reviewed run. Obsolete writers cannot consult or stop providers through admission. Budget denial first persists the local pause, even if external cancellation is unavailable or unauthorized. An authorized provider stop is journaled before calling `requestSafeStop(state, {authority, revision, operationId})`; the provider must fence its action by generation and use the operation ID for reconciliation. Only `{verified:true, stopped:true}` confirms termination. A failed or uncertain response remains an operation that the host's `reconcileOperation` must resolve before recovery.

Metrics distinguish observed evidence from accepted delivery, setup/planning from activated execution, and retries from planned promotions. Attempt records include run, phase, criterion and candidate. Missing intervention counts, unsupported-claim audits and usage remain explicit unknowns; they are not reported as zero.

Domain constraints belong in `sdlc.config.json.deliveryPolicy`. Set `requiredJourneyCoverage: true` to require journeys when freezing criteria. `deterministicOrigins` can restrict the accepted observed origins. `budgetMaxima`, for example `{"tokens":10000}`, requires an enforced operational budget in that unit at or below the ceiling; the initial implementation supports one budget unit per run. The v2 contract, source acknowledgment, human-review phase and unknown-writer/usage protections cannot be disabled. The stock local-preview source remains explicitly non-durable.

A compact acceptance file can include `journeys: [{"id":"search","required":true,"criteria":["query"]}]`. Every required journey must reference currently verified criteria. Non-UI changes can omit journeys. Coverage keeps verified, accepted and deployed states separate.

## Adoption storage and recovery

```text
node bin/cli.mjs adopt plan --profile standard --storage project --target <project> --json
node bin/cli.mjs adopt apply --profile standard --storage project --confirm <plan-token> --target <project> --json
node bin/cli.mjs adopt rollback --receipt <returned-receipt-path> --confirm <receipt-token> --target <project> --json
node bin/cli.mjs adopt recover --confirm <recovery-token> --target <project> --json
```

The returned receipt path is authoritative; transaction IDs differ from plan tokens. External storage remains available through `--receipt <absolute-outside-file>`. A pending journal blocks new adoption. Keep receipts for the required rollback window and clean them only after confirming transaction completion and retention needs. Project-local receipts disappear if the project is deleted.
