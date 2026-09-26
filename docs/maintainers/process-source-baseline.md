# Process source baseline

Captured by Codex on 2026-09-25 for #261/#262. Source-store implementation is unchanged from worktree base ffcc3ee071dc32aa7a9c600857e177a8cc6264eb. This is measured baseline evidence, not an optimization result or full telemetry qualification.

## Synthetic append workload

Reused the in-memory GitHub fixture from `lib/__tests__/github-run-store.test.mjs` and the actual `createGitHubRunStore`. After initialization, appended ten valid chained checkpoint events. Counts are client request boundaries; request bodies are JSON serialized as UTF-8. No external writes were performed. These are not live HTTP measurements. Response wire bytes were not measured.

| Stored events | Requests per append | Reads | Writes | Serialized request body bytes |
| ------------- | ------------------- | ----- | ------ | ----------------------------- |
| 2             | 12                  | 8     | 4      | 1255                          |
| 3             | 12                  | 8     | 4      | 1600                          |
| 4             | 12                  | 8     | 4      | 1945                          |
| 5             | 12                  | 8     | 4      | 2290                          |
| 6             | 12                  | 8     | 4      | 2635                          |
| 7             | 12                  | 8     | 4      | 2980                          |
| 8             | 12                  | 8     | 4      | 3325                          |
| 9             | 12                  | 8     | 4      | 3670                          |
| 10            | 12                  | 8     | 4      | 4015                          |
| 11            | 12                  | 8     | 4      | 4361                          |

The workload confirms 12 source calls per existing-run append. Increasing request size reflects rewriting event history. Maintained S1 benchmarks must retain comparable workload/units and add transport measurement; this scratch fixture run alone does not prove every source path.

## Live read workload

Read the active process-autonomy-260 run through `createGitHubApiCli` and `createGitHubRunStore` with observe authority. Source revision: `af10194ab32053ef51ed72c42dae69d5c33a4da4`. Stored events: 2. Observed API subprocess calls: 4 GETs. Total UTF-8 stdout payload: 4192 bytes. Total observed subprocess duration: 1656 ms in this single sample.

The wrapper measured structured gh api invocations, stdin/stdout and elapsed time. It did not record credentials, raw paths or response content. Network retries, headers, compressed wire bytes and successful response HTTP status remain unknown. This single sample is not a latency percentile or a host-independent performance guarantee. S1 must distinguish these dimensions and capture repeatable workloads before S4 savings claims.

## Comparison requirements

Preserve baseline revision, exact workload, event counts, UTF-8 byte units, source acknowledgment and failures. Compare accepted checkpoint/delivery counts as denominators; do not substitute shell-command counts or billed-token estimates. Cache gains must not remove admission/revocation/acceptance barriers. Actual HTTP attempts and payload measurements need supported transport instrumentation, with unknown coverage reported explicitly.
