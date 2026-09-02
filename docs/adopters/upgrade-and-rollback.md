# Upgrade and rollback

## Preview

```bash
node bin/cli.mjs adopt plan --profile standard --target /path/to/project --json
```

The plan reads a v2 lock. Other versions, malformed entries, target conflicts,
unsafe paths, and stale state fail closed.

## Apply

Keep the receipt outside the target repository:

```bash
node bin/cli.mjs adopt apply \
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
node bin/cli.mjs adopt recover \
  --target /path/to/project \
  --confirm <recovery-token> \
  --json
```

## Verify

```bash
node bin/cli.mjs adopt plan --profile standard --target /path/to/project --json
node bin/cli.mjs sdlc validate --target /path/to/project --json
node bin/cli.mjs sdlc validate-authority --target /path/to/project --json
```

## Roll back

Use the `receiptToken` returned by apply. Rollback refuses any applied file that has drifted.

```bash
node bin/cli.mjs adopt rollback \
  --target /path/to/project \
  --confirm <receipt-token> \
  --receipt /outside/path/agentflow-receipt.json \
  --json
```

Successful rollback restores exact prior bytes and directory topology and removes the consumed
receipt. Project-owned files outside the transaction are not touched.
