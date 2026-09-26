# Immutable source read cache — S4a checkpoint

The GitHub run store retains one validated serialized snapshot, bounded by
`readCacheBytes` (default and maximum 2 MiB; zero disables caching). Every read still
fetches the authoritative Git ref. A matching immutable commit identity permits
reuse of its already validated event bytes; results are parsed into fresh objects.
Changed, missing, invalid or unavailable refs invalidate the cached observation.

Admission retains its fresh revision check and single-parent conditional append.
Write confirmation and ambiguous-write reconciliation bypass and clear the cache,
so cached data cannot serve as an acknowledgment. Unknown commit identifiers are
read normally but never cached. Capacity measures serialized bytes, not total RSS.

The deterministic GitHub HTTP fixture measures four source requests for a cold
read and one for a warm read: a 75% reduction for repeated unchanged reads. The
16-case efficiency suite also covers stale revisions, caller mutation, capacity,
missing refs and corrupt source records. Existing admission-race tests remain
required. These are adapter request counts, not a claim about real GitHub latency
or end-to-end cost per accepted delivery.

S4a remains open for human-projection coalescing, context reuse and the integrated
comparison against the S1 baseline. S4b owns segmented storage and migration;
this cache changes neither the source format nor historical retention.
