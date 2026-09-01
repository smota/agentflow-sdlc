# AgentFlow SDLC release publishing

AgentFlow SDLC v1 is publish-grade only when tests, executable evals, npm packaging, native harness manifests, and structural harness settings merge all validate. This document defines the maintained release gate. Passing it validates the package payload but does not publish the npm package; npm publication remains a separate explicit action.

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
node bin/cli.mjs plugins validate --harness all --json
node bin/cli.mjs plugins build --harness all --dry-run
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
node bin/cli.mjs settings merge --harness all --dry-run
node bin/cli.mjs settings status --harness all --json
```

The merge engine preserves project-owned keys and only injects the `agentflowSdlc` managed object from `manifests/harness-settings.json`.

## Cockpit gate

Cockpit is optional at runtime and first-class in the product artifact. It must be packaged, documented, and smoke-tested, but default install must not start a server, require OAuth, or enable write actions.

Run:

```bash
AGENTFLOW_REPOSITORIES=owner/repo node bin/cli.mjs cockpit doctor --json
node scripts/cockpit-smoke.mjs
```

## Full v1 release gate

```bash
pnpm test
pnpm test:evals
node scripts/sdlc-sandbox-smoke.mjs
node scripts/cockpit-smoke.mjs
node scripts/validate-npm-package.mjs
node bin/cli.mjs plugins validate --harness all --json
node bin/cli.mjs settings merge --harness all --dry-run
```

The canonical package script runs the same core gate:

```bash
pnpm validate:release
```
