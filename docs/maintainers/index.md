# Maintainer path

Maintainers own product boundaries, compatibility, release claims, and validator quality.

1. Read the [modular architecture](../modular-architecture.md) and [ADRs](../adr/index.md).
2. Preserve the current payload and profile contracts in `manifests/`.
3. Add contracts before provider- or source-specific behavior.
4. Keep profile dependencies closed and add reusable files to the smallest applicable profile.
5. Run unit, workflow, eval, sandbox, Cockpit, package, extension, and format gates.
6. Compute `node scripts/review-digest.mjs --json` only after the candidate stops changing.
7. Require digest-bound independent reviews and the high-assurance human PR gate.

Do not claim npm publication, provider support, hosted CI success, or external harness capability
from local configuration alone. Pin exact upstream revisions and validate the invoked public contract.
