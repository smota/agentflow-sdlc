# Assisted update

Assisted update is the guided workflow for a project that already adopted **AgentFlow SDLC** and wants to update its installed framework files from a known `agent-framework-lock.json` state to a newer framework checkout/version.

Use assisted onboarding for first-time adoption. Use this guide when the target project already has framework files, a lockfile, or earlier hand-merged framework content.

For the proposed next iteration of this flow, see [`deterministic-assisted-update.md`](deterministic-assisted-update.md). The target direction is to make update planning machine-readable and deterministic, so an LLM session presents and verifies CLI output instead of improvising file classifications or write commands.

## Core rule: deterministic plan before sync

The update assistant must start read-only. It may inspect files, run read-only validators, and propose commands. It must not run `sync`, edit conflicts, mark files merged, commit, push, or open a PR until the operator approves the update plan.

Until a dedicated deterministic `update-plan` command exists, the agent must treat `doctor`, `doctor-env`, lockfile state, and the classification checklist in this guide as evidence to present for approval. The long-term target is for a CLI-generated update plan to become the source of truth for these classifications.

Low-level sync semantics stay deterministic:

- unchanged framework-owned files may be fast-forwarded by `sync`;
- locally modified framework-owned files are reported as conflicts and are not overwritten;
- seed-once files such as `AGENTS.md` and `docs/stack-conventions.md` are created only when missing and are not overwritten after they exist;
- hand-merged files recorded with `mark-merged` are reported separately and are never fast-forwarded;
- project-owned files outside the framework file list are not touched by the framework CLI;
- extension-pack discovery is automatic but activation is explicit: `doctor` reports enabled, missing, invalid, discovered-disabled, and duplicate-id extension states, while `sync` must not silently enable newly shipped packs.

## Copy-paste agent handoff

```text
Use the AgentFlow SDLC assisted update guide:
https://github.com/smota/agentflow-sdlc/blob/main/docs/assisted-update.md

Apply it to this already-adopted project: <target-project-path>

Start read-only. Inspect agent-framework-lock.json, existing agent instructions, project docs, and local workflow configuration. Run read-only environment/framework checks, including `migrate-rename` check mode. Compare the installed framework state with this source framework checkout/version. Classify every proposed update as safe fast-forward, rename migration, conflict, seed-once skip, hand-merged, removed/missing, or validation blocker. Present an update plan and ask for approval before running `migrate-rename --write`, sync, editing files, marking hand merges, committing, pushing, or opening a PR. Preserve project-owned conventions and record update evidence in the PR.
```

Prefer command output? Print the same update prompt locally:

```bash
node bin/cli.mjs update-prompt --target /path/to/your-project
```

## Deterministic workflow

### 1. Confirm this is an update, not onboarding

Read-only checks:

```bash
test -f /path/to/project/agent-framework-lock.json && echo "lockfile found"
node /path/to/agentflow-sdlc/bin/cli.mjs doctor --target /path/to/project
node /path/to/agentflow-sdlc/bin/cli.mjs doctor-env --target /path/to/project
```

If the project has no lockfile and no recognizable framework files, switch to [`docs/assisted-onboarding.md`](assisted-onboarding.md). If the project has framework files but no lockfile, treat the update as a recovery/migration and require explicit operator approval before deciding between `init`, manual merge, or follow-up work.

### 2. Run the AgentFlow SDLC rename migration when needed

Projects adopted before the product rename may still contain old framework repository, command, or docs references in framework-managed files. Check first, then write only after approval:

```bash
node /path/to/agentflow-sdlc/bin/cli.mjs migrate-rename --target /path/to/project
node /path/to/agentflow-sdlc/bin/cli.mjs migrate-rename --target /path/to/project --write
```

`migrate-rename` updates known framework-owned/adopter guidance files from the old repository and command slug to `agentflow-sdlc`. It is intentionally narrow: it does not rewrite arbitrary project product text or files outside its deterministic allowlist.

### 3. Record installed and source framework state

Inspect and summarize:

- target project path;
- source framework checkout path;
- source framework package version from `package.json`;
- target `agent-framework-lock.json` presence and relevant metadata;
- current target branch and git status;
- existing workflow configuration in `agent-workflow.config.json`, especially `extensions.enabledPacks`;
- extension discovery/validation output from `node /path/to/agentflow-sdlc/bin/cli.mjs extensions list --target /path/to/project` and `extensions validate`;
- project-specific instructions in `AGENTS.md`, adapter files, and `docs/stack-conventions.md`.

Do not paste secrets or private local-only data into issues, PRs, or handover comments.

### 4. Classify update results

Use `doctor` output and, after approval, `sync` output with these classifications:

| Classification                      | Meaning                                                                       | Default action                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `safe fast-forward`                 | framework-owned file still matches lockfile and can be updated automatically  | allow `sync`                                                                |
| `conflict`                          | framework-owned file changed locally since install/sync                       | manually review and merge; never overwrite silently                         |
| `seed-once skip`                    | project-owned starter exists and should not be overwritten                    | preserve target file                                                        |
| `hand-merged`                       | framework path intentionally marked with `mark-merged`                        | preserve target file; review only when needed                               |
| `removed/missing`                   | file is absent in target                                                      | distinguish intentionally removed from never-installed older framework file |
| `validation blocker`                | required tool, config, or check prevents safe update                          | stop or create follow-up issue                                              |
| `extension discovered-disabled`     | extension pack is available under `extensions/` or `contrib/` but not enabled | present as an explicit adoption choice; do not auto-enable                  |
| `extension enabled-missing/invalid` | configured pack is missing, malformed, has duplicate ids, or fails validation | stop or create follow-up issue before claiming update readiness             |

### 5. Propose the update plan

Before writes, present a plan containing:

- source framework version/checkout;
- installed framework state summary;
- expected `doctor` categories;
- files likely to fast-forward;
- conflicts requiring manual review;
- seed-once files to preserve;
- hand-merged files and whether they need review;
- validation commands to run after update;
- extension choices: packs newly discovered but not enabled, missing/invalid enabled packs, duplicate ids, and whether any explicit `extensions enable`/`disable` command is proposed;
- rollback/stop rule if unexpected conflicts appear.

Ask for explicit approval before running `sync` or editing any file.

### 6. Apply approved sync

After approval, run:

```bash
node /path/to/agentflow-sdlc/bin/cli.mjs sync --target /path/to/project
```

If conflicts are reported, inspect each conflict and choose one of:

- merge the framework changes into the project-owned custom file;
- leave the conflict unresolved and create a follow-up issue;
- if the file should remain intentionally hand-merged at a framework path, record it:

```bash
node /path/to/agentflow-sdlc/bin/cli.mjs mark-merged <path> --target /path/to/project
```

Run `doctor` again after conflict handling.

### 7. Validate the updated project

Minimum validation:

```bash
node /path/to/agentflow-sdlc/bin/cli.mjs doctor --target /path/to/project
node /path/to/agentflow-sdlc/bin/cli.mjs doctor-env --target /path/to/project
```

Then run the consuming project's configured CI-equivalent commands from `agent-workflow.config.json` and `docs/stack-conventions.md`, for example lint, test, typecheck, build, workflow validators, or project-specific smoke tests.

If a validation failure is expected or out of scope, record it with a follow-up issue rather than hiding it in a TODO.

### 8. Prepare update PR evidence

The update PR body should include:

- source framework version/checkout;
- target project path/repository;
- previous lockfile state and updated lockfile summary;
- update classifications: safe fast-forwards, conflicts, seed-once skips, hand-merged files, removed/missing files, validation blockers;
- files changed by sync and files manually merged;
- `mark-merged` commands run, if any;
- validation commands and results;
- follow-up issues for deferred conflicts or validation failures;
- merge owner and release/promotion impact when relevant.

Use the normal project PR manifest and workflow-status requirements. Update PRs should still cite issues with the correct `Implements`/`Closes`/`Refs` behavior for the target project's branch strategy.

## Stop rules

Stop and ask the operator before continuing when:

- `doctor` reports many conflicts and no clear project policy for merging them;
- project-owned policy files conflict with framework defaults;
- `agent-framework-lock.json` is missing, malformed, or appears manually edited;
- the target working tree has unrelated uncommitted changes;
- validation requires credentials, secrets, or private environment access;
- the update would change branch strategy, review gates, or release behavior beyond the approved scope.
