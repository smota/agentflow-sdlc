# Upgrade and rollback

## Bring an installation forward

Upgrading an installation is the [adoption journey](../get-started.md): preview, make the choices
it asks for, confirm, and read the readiness report. A legacy lock needs an explicit
[migration choice](../get-started.md#a-legacy-lock), an unknown lock an explicit
[recovery choice](../get-started.md#an-unknown-or-malformed-lock), and a file both sides changed a
[preserve or replace choice](../get-started.md#a-file-both-agentflow-and-the-project-changed).
A compatible update may be [deferred](../get-started.md#defer-a-framework-update).
[Undo](../get-started.md#undo) restores the exact prior bytes.
Do not remove a lock or overwrite content merely to make the transaction pass.
Shared CLI/skill updates are proposed separately from project setup.
The runtime chooses installation locations and manages shared links.

The rest of this page documents the low-level `adopt` transaction commands under that journey,
for scripts and maintainers. They are not a separate way in.

## Preview

```bash
agentflow-sdlc adopt plan --profile standard --target /path/to/project --json
```

The plan reads a v2 lock. Other versions, malformed entries, target conflicts,
unsafe paths, and stale state fail closed.

Use physical absolute paths for transaction storage. Receipt paths reject symlinked parents, including macOS's `/var` alias. For a temporary consumer, resolve the existing temporary directory first (for example, Node's `realpathSync(tmpdir())`) and create the target and receipt under that physical directory. This does not permit symlinks or junctions inside an adoption target or receipt path.

## Apply

Keep the receipt outside the target repository:

```bash
agentflow-sdlc adopt apply \
  --profile standard \
  --target /path/to/project \
  --confirm <plan-token> \
  --receipt /outside/path/agentflow-receipt.json \
  --json
```

Apply recomputes the plan, journals the file and any missing parent directories before creating
them, stages each write, replaces files, and writes lockfile v2 last. Any failure restores prior
bytes and removes transaction-created empty directories. If the external receipt cannot be written,
the applied target is immediately rolled back.

Apply keeps `.agentflow-adoption-journal.json` in the target until the lock is replaced and backups
are resolved. A new plan refuses an unfinished journal. Use its `recoveryToken` for explicit recovery:

```bash
agentflow-sdlc adopt recover \
  --target /path/to/project \
  --confirm <recovery-token> \
  --json
```

## Verify

```bash
agentflow-sdlc adopt plan --profile standard --target /path/to/project --json
agentflow-sdlc sdlc validate --target /path/to/project --json
agentflow-sdlc sdlc validate-authority --target /path/to/project --json
```

## Roll back

Use the `receiptToken` returned by apply. Rollback refuses any applied file that has drifted.

```bash
agentflow-sdlc adopt rollback \
  --target /path/to/project \
  --confirm <receipt-token> \
  --receipt /outside/path/agentflow-receipt.json \
  --json
```

Successful rollback restores exact prior bytes and directory topology and removes the consumed
receipt. Project-owned files outside the transaction are not touched.

## Contained transaction storage

The delivery update adds `adopt plan --storage project` and matching `adopt apply --storage project`. A unique transaction directory under ignored `.agentflow/transactions/` retains the receipt outside the managed payload. External storage remains available with `--receipt`. All API callers must supply an absolute external `receiptDestination` when project storage is not selected. Apply finalization waits for durable receipt storage; explicit rollback has a restartable journal. Follow the returned receipt path and tokens, and see [run operations](../run-operations.md).
