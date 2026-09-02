# AI Foundry Desk provider

AI Foundry Desk is an optional external project-harness provider. AgentFlow does not embed or copy
its orchestration.

The reviewed contract is pinned to commit
`d5cb4588c33d4fb2ed7fdf589e42782e64b741fb` (AFD 0.6.4). No tag points exactly to that commit, so
the commit is authoritative.

Hashes use the raw Git blob bytes at the pinned commit, without newline conversion.

Recompute all pins against a local AFD checkout with:

```bash
node scripts/verify-afd-pin.mjs --repo /path/to/ai-foundry-desk
```

| Evidence path                            | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `README.md`                              | `864458D96A28CC701A41E3BFF4F4DF5B10D10E396F16AA7E83EDF2C735D8C287` |
| `docs/PROJECT-HARNESSES.md`              | `4BB30CDFEF7D4770122C1FD14C9714ACE5549477E5133D5FC91D901438BFBF23` |
| `docs/CLI.md`                            | `2C11655B5C660F17265543D078C5246791E9EB1947C459679322F8F3BDFDCFF4` |
| `agent-manager/src/harness-contracts.ts` | `106870F61DFE75177C6F5394192E091C83CDDCFF6D219609860C01CAC16A82ED` |
| `agent-manager/src/contracts.ts`         | `4FD60AC6ECC9CCDC1E817265C285973AAE4E2DD3BAFB1077E7BDFD7D4541AA6A` |
| `agent-manager/src/cli.ts`               | `1FD97816C4563B807AFB63D7935740EF30DE70C40B8EE33B9E02F8C55A4C57F7` |

Proven facets are inventory, project adapters, and evidence. Workspace fingerprint data may appear
inside evidence, but AFD does not advertise the operational `workspace` facet. The public integration
shape is `afd harness <operation> <project> --json`
for `audit`, `plan`, `stage`, `test`, `apply`, `verify`, and `rollback`.

AFD does not own AgentFlow roles, lifecycle gates, readiness, source operations, or general agent task
execution or workspace management. At the pinned revision, Grok and Hermes project instruction
discovery are explicitly unsupported. A future AFD version must be repinned and reconfirmed before
its capability claims are expanded.
