# Runtime platform identities

Workflow evidence records runtime platform identity separately from execution mechanics. Platform says
**which harness or runtime produced evidence**. Executor, transport, delegation boundary, and model
say **how work ran**. Never infer one from another.

## Registry

`manifests/runtime-platforms.json` is framework source of truth. Built-in slugs:

| Platform slug | Display name | Kind          | Built-in role routing |
| ------------- | ------------ | ------------- | --------------------- |
| `chatgpt`     | ChatGPT      | harness       | no                    |
| `cowork`      | Cowork       | harness       | no                    |
| `antigravity` | Antigravity  | harness       | no                    |
| `pi`          | Pi           | agent runtime | yes                   |
| `claude`      | Claude       | agent runtime | yes                   |
| `codex`       | Codex        | agent runtime | yes                   |
| `agy`         | Agy          | agent runtime | yes                   |
| `human`       | Human        | human         | no                    |

Identity-only platforms remain truthful when work uses another execution surface. Example: Cowork may
record `Implemented by: cowork`, `Executor: pi-subagent-model`, `Transport: provider-api`, and actual
model identifier. Antigravity may record `Implemented by: antigravity` with `Executor: agy-cli`.
Those fields must not be collapsed or forced to share a brand.

## Project extensions

Projects may register a new evidence identity without changing templates or validators:

```json
{
  "platformRegistry": {
    "additionalPlatforms": [
      {
        "slug": "future-runtime",
        "displayName": "Future Runtime",
        "kind": "harness",
        "routable": false
      }
    ]
  }
}
```

Slug must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`. Duplicate or malformed entries fail validation.
Project additions are identity-only and must set `routable: false`; they cannot invent execution
targets or adapters. Add role-routing support separately in framework registry and execution-target
implementation before using new platform under `routing.agents`.

Validate registry-backed evidence with:

```bash
node scripts/validate-pr-manifest.mjs --path <manifest.md>
node scripts/validate-role-attribution.mjs --path <evidence.md>
node scripts/validate-sdlc-role-pass.mjs --path <role-pass.md>
```

`schemas/runtime-platform-registry.schema.json` defines registry shape. Init/sync installs registry,
schema, library, and validators together so consumers use same vocabulary.
