# Versioned snapshots, immutable event segments, and bounded batching — S4b

`createSegmentedRunStore` in `lib/sources/segmented-run-store.mjs` delivers segmented
persistence, immutable event segments, and snapshot checkpoints for AgentFlow runs.

## Architecture

1. **Format versioning**:
   - `schemaVersion: 2`, `format: 'segmented-v2'`
   - Runs are indexed by `runs/${runId}-manifest.json` on the coordination ref.
   - Legacy readers fail closed: `runs/${runId}.json` contains a non-array fail-closed
     marker that prevents older binaries from misinterpreting segmented data as empty
     or corrupted v1 history.

2. **Immutable event segments**:
   - When the active tail reaches `segmentSize` (default 500 events) or `segmentBytes`
     (default 256 KiB), the tail is sealed into an immutable segment `runs/${runId}-seg-${index}.json`.
   - Each segment carries a content digest and references the `parentDigest` of the prior
     segment, establishing an immutable cryptographic segment chain.
   - Missing or tampered segments fail closed with clear diagnostics.

3. **Snapshots**:
   - A snapshot is persisted at segment boundaries in `runs/${runId}-snapshot.json`.
   - The snapshot records the reduced state at that segment's end revision.
   - Replay can be verified from full segments or accelerated via snapshot + tail events.
   - A 10,000-event property replay proves exact identity with the reference reducer.

4. **Two-writer CAS & Kill Safety**:
   - Commits are parented at the observed Git commit SHA and updated via non-force PATCH.
   - Concurrent writers conflict on CAS (HTTP 422).
   - Interruptions before CAS leave the remote ref untouched.
   - Interruptions after CAS are reconciled by re-reading the event identity.

5. **Migration**:
   - `previewMigration`: inspects an existing v1 run, partitions it into proposed segments,
     and verifies that replaying the segmented events matches the reference reducer before any writes.
   - `migrateRunStore`: executes atomic conversion of v1 to v2 in a single commit, preserving
     replay equality.
