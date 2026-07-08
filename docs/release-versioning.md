# Release versioning

`multi-agent-sdlc` uses a configurable release versioning strategy so humans and agents can agree on the next release before tags, package versions, or GitHub Releases are created.

## Default: `main.minor.fix`

The default format is:

```text
<main>.<minor>.<fix>
```

It is intentionally equivalent in shape to SemVer `major.minor.patch`, but uses project-language terms:

| Segment | Meaning                         | Bump when                                                                                                                                              |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main`  | Mainline compatibility boundary | A release changes framework contracts, generated file compatibility, policy semantics, CLI behavior in a breaking way, or migration expectations.      |
| `minor` | Additive capability             | A release adds backwards-compatible features, docs surfaces, commands, templates, roles, validations, optional integrations, or configuration options. |
| `fix`   | Correction                      | A release fixes bugs, clarifies docs, improves validation accuracy, or makes backwards-compatible maintenance corrections.                             |

## Configuration

Projects can keep the default or add `releaseVersioning` to `agent-workflow.config.json`:

```json
{
  "releaseVersioning": {
    "strategy": "main.minor.fix",
    "segments": ["main", "minor", "fix"],
    "tagFormat": "v${version}",
    "packageVersionSource": "package.json",
    "requireExplicitApproval": true,
    "allowPrerelease": true
  }
}
```

Common overrides:

### SemVer names

```json
{
  "releaseVersioning": {
    "strategy": "semver",
    "segments": ["major", "minor", "patch"],
    "tagFormat": "v${version}",
    "packageVersionSource": "package.json"
  }
}
```

### Calendar versioning

```json
{
  "releaseVersioning": {
    "strategy": "calver",
    "segments": ["year", "month", "fix"],
    "tagFormat": "release-${version}",
    "packageVersionSource": null
  }
}
```

### Internal app releases

```json
{
  "releaseVersioning": {
    "strategy": "main.minor.fix",
    "tagFormat": "app-${version}",
    "packageVersionSource": null,
    "requireExplicitApproval": true
  }
}
```

## Release decision evidence

A release PR or release manifest should record:

- intended version and tag;
- bump type: `main`, `minor`, or `fix` by default;
- rationale for the bump;
- included integrated issues;
- excluded/deferred issues;
- validation commands;
- release notes path;
- explicit human/operator approval when tags or GitHub Releases will be pushed.

Agents must not infer breaking releases silently. If the correct bump is ambiguous, record the options and ask for a decision before tagging or publishing.

## Preview-first helpers

Use the CLI to preview a release without mutating files:

```bash
node bin/cli.mjs release-plan --target . --bump minor
node bin/cli.mjs release-plan --target . --bump fix --json
```

The command reports `mutated: false`; it does not update package files, create tags, push branches, or create GitHub Releases.

Validate an intended release:

```bash
node scripts/validate-release-versioning.mjs --current 0.2.0 --next 0.3.0 --bump minor --notes .agent-runs/scratch/release-0.3.0.md
node scripts/validate-release-versioning.mjs --next 0.3.0 --json
```

## Promotion workflow

1. Confirm all included issues are integrated into the configured integration branch.
2. Choose the bump using the project strategy.
3. Preview the next version and tag.
4. Draft release notes.
5. Validate version, tag, package metadata, and notes.
6. Open a release/promotion PR to the configured trunk branch.
7. After approval, merge, tag, push, and create the GitHub Release according to project policy.

Promotion from `development` to `main` remains separate from implementation issue closure. Release notes should reference implemented issues with `Closes #...` only when the release PR intentionally closes or promotes them; use `Refs #...` for non-closing context.
