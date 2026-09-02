# Troubleshooting

| Symptom                                      | Current effect                                       | Non-mutating next check                                              |
| -------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Provider is unavailable                      | Optional binding degrades or required binding blocks | `providers inspect <id> --json`                                      |
| Adoption plan is stale                       | Apply refuses all writes                             | Rerun `adopt plan`; review the new token                             |
| Adoption plan has conflicts                  | Apply is blocked                                     | Inspect each reported target; preserve or reconcile it               |
| Lock version is unknown                      | Adoption fails closed                                | Preserve the lock and use a compatible AgentFlow version             |
| Applied file drifted                         | Rollback refuses                                     | Review the local change before choosing a recovery path              |
| Configuration authority fails                | Workflow config duplicates domain policy             | Run `sdlc validate-authority --json` and move the field to its owner |
| Cockpit is unavailable                       | Visual projection is absent                          | Continue with CLI, source records, and validators                    |
| Package-manager signature cannot be verified | Package-manager command does not run                 | Restore trusted registry access; do not bypass integrity guards      |

Errors should state what failed, whether it is optional, the current effect, the next read-only check,
and where approval is required. Never delete a lock, receipt, conflict, or local edit merely to make
a validator green.
