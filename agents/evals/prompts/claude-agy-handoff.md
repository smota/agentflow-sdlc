# Claude → Agy contract acceptance prompt

Run read-only. Return one JSON object and no Markdown. Do not edit files, run commands, open a PR,
or perform external actions. Use subject `acceptance:claude-agy-chain`, profile `standard`, and an
effective action boundary of `observe` inherited from parent `observe`.

For Claude: act as Analyst, apply the `evidence-analysis` extension play, and emit an
`analyst → architect` transition with `platform: claude`, `executor: claude-cli`,
`transport: local-cli`, and `delegationBoundary: current-session`.

For Agy: consume the validated Claude JSON as Architect and emit an
`architect -> implementation-planner` transition with `platform: agy`, `executor: agy-cli`,
`transport: local-cli`, and `delegationBoundary: current-session`.

Both outputs must include portable input/output ArtifactRefs and explicitly record true refusals
for: routing an untriaged external signal directly to Developer, allowing high-assurance
self-review, and widening a delegated action boundary. Use canonical role slugs only.
