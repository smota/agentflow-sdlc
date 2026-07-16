# Release versioning

`agentflow-sdlc` uses a configurable release versioning strategy so humans and agents can agree on the next release before tags, package versions, or GitHub Releases are created.

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

Release closeout evidence, recorded after the release PR merges, must also record:

- target merge commit;
- tag name and tag target;
- GitHub Release title;
- release notes source file;
- publish timestamp;
- `gh release list` or `gh release view` verification URL/output.

Agents must not infer breaking releases silently. If the correct bump is ambiguous, record the options and ask for a decision before tagging or publishing.

## Release note voice

Release notes are user-facing product communication for adopting projects and maintainers. They must lead with capabilities and outcomes, not issue bookkeeping.

Write release notes so they:

- explain what users can now do, configure, validate, or update;
- group changes by capability area when useful;
- mention issue or PR numbers only as supporting references;
- include upgrade/update guidance such as `sync`, `doctor`, or assisted update when consumers need it;
- state validation confidence and compatibility or migration notes;
- avoid headings or bullets such as `Implemented #123` or `Issue #123` as the primary narrative.

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

Validate post-merge closeout after the tag and GitHub Release are created:

```bash
node scripts/validate-release-closeout.mjs --tag v0.4.0 --target <merge-commit> --notes docs/releases/v0.4.0.md
```

This check verifies the local tag, the GitHub Release, the expected target commit, and basic user-facing release-note wording.

## Promotion workflow

1. Confirm all included issues are integrated into the configured integration branch.
2. Choose the bump using the project strategy.
3. Preview the next version and tag.
4. Draft release notes using the user-facing voice rules above.
5. Validate version, tag, package metadata, and notes.
6. Open a release/promotion PR to the configured trunk branch.
7. After approval, merge the release PR.
8. Fetch the updated trunk branch and identify the merge commit.
9. Create and push the tag / GitHub Release.
10. Verify the published release is visible.
11. Record release closeout evidence in the issue, PR, or session notes.

Promotion from `development` to `main` remains separate from implementation issue closure. Release notes should reference implemented issues with `Closes #...` only when the release PR intentionally closes or promotes them; use `Refs #...` for non-closing context.

### Post-merge closeout checklist

Run these steps after the release PR merges:

```bash
git fetch origin --tags --prune
git rev-parse origin/main
# Confirm the merge commit and release notes before publishing.
git show origin/main:docs/releases/v0.4.0.md
# Publish the public artifact. This is not preview-only.
gh release create v0.4.0 \
  --target <merge-commit> \
  --title "v0.4.0 — <user-facing capability title>" \
  --notes-file docs/releases/v0.4.0.md
# Verify visibility.
gh release view v0.4.0 --json tagName,name,url,publishedAt,targetCommitish,isDraft,isPrerelease
gh release list --limit 5
node scripts/validate-release-closeout.mjs --tag v0.4.0 --target <merge-commit> --notes docs/releases/v0.4.0.md
```

`release-plan` and `validate-release-versioning` are preview/validation commands. `gh release create` publishes an irreversible public artifact unless it is deleted manually; run it only after the release PR is merged and approved.
