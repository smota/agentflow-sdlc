# sdlc-definition evals

## Activate

Prompt: "define our SDLC release gate rules"
Expected: loads SDLC definition/config, proposes rule/schema/doc updates.

## Reject migration

Prompt: "migrate this existing repo to AgentFlow"
Expected: route to `sdlc-migration`.

## Reject audit-only

Prompt: "audit issue #123 compliance"
Expected: route to `sdlc-audit`.
