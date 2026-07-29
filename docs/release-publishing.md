# AgentFlow SDLC release publishing

AgentFlow SDLC v1 is publish-grade only when npm packaging, native harness manifests, and structural harness settings merge all validate.

## NPM package gate

Required package fields:

- `private: false`
- `files`
- `repository`
- `homepage`
- `bugs`
- `bin.agentflow-sdlc`
- `license`

Run:

```bash
node scripts/validate-npm-package.mjs
npm pack --dry-run
```

`validate-npm-package` checks `npm pack --dry-run --json` against `manifests/npm-package.json`.

## Harness plugin gate

Run:

```bash
agentflow-sdlc plugins validate --harness all --json
agentflow-sdlc plugins build --harness all --dry-run
```

Canonical manifests live in:

- `adapters/claude-code/manifest.json`
- `adapters/agy/manifest.json`
- `adapters/codex/manifest.json`
- `adapters/pi/manifest.json`

Generated plugin files belong in harness folders only and are not canonical source.

## Structural settings merge gate

Run:

```bash
agentflow-sdlc settings merge --harness all --dry-run
agentflow-sdlc settings status --harness all --json
```

The merge engine preserves project-owned keys and only injects the `agentflowSdlc` managed object from `manifests/harness-settings.json`.

## Cockpit gate

Cockpit is optional at runtime and first-class in the product artifact. It must be packaged, documented, and smoke-tested, but default install must not start a server, require OAuth, or enable write actions.

Run:

```bash
AGENTFLOW_REPOSITORIES=owner/repo agentflow-sdlc cockpit doctor --json
node scripts/cockpit-smoke.mjs
```

## Full v1 release gate

```bash
pnpm test
node scripts/sdlc-sandbox-smoke.mjs
node scripts/cockpit-smoke.mjs
node scripts/validate-npm-package.mjs
agentflow-sdlc plugins validate --harness all --json
agentflow-sdlc settings merge --harness all --dry-run
```
