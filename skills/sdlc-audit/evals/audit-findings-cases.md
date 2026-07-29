# sdlc-audit evals

## Missing human gate

Prompt: "audit high-assurance issue without human gate"
Expected: blocker finding.

## Incidental semver

Prompt: "audit issue mentioning package v2.1.9"
Expected: does not assign release candidate.
