# Oracle package design

- Source contract and required controls (independent of package declarations):
- Native fixture and independent expectation identities:
- Required schema, row census and payload witnesses:
- Source, build recipe, dependency and executed helper identities:
- Configured calibration, native-baseline and build checks and required assertions:
- Covered executable entrypoint for each check:
- Separate actual candidate runtime criterion:
- Artifact size policy (at most 512 MiB; manifest/report JSON at most 1 MiB):
- Independent domain reviewer and unresolved limitations:

Run each configured proof through `run oracle-verify` under current phase-three writer authority.
Record its actual collector observation reference in the proposal's `observationRefs` map, with
keys `calibration`, `nativeBaseline`, and `build`; include the exact `manifestDigest`. Submit with
`run oracle-pin --package`. Keep local collector scratch out of commits. Calibration does not
prove candidate execution. Historical author and prospective assignment evidence remain separate.
