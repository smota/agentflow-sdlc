# AgentFlow SDLC agent package changelog

## Unreleased

- Removed the optional AI Foundry Desk provider and its pin check. This is compatibility-impacting
  for projects that used that provider: shipped discovery no longer lists it, and inspecting it
  fails like any other unknown provider. No replacement provider is added. See ADR 014.
- Added canonical `AgentFlow SDLC Agent` package structure.
- Added maturity scorecard, knowledge/tool contracts, runtime capability matrix, handoff and execution model, guardrails, validation checklist, eval plan, and continuous-improvement plan.
