# Principles

## Targets before implementation

Non-functional expectations must be stated explicitly during architectural analysis, before code changes occur. An unstated target cannot be verified.

## Measured values over narrative claims

A verification outcome cannot be `pass` based on a subjective claim. Every pass requires an explicit measured value, unit of measurement, threshold, sample size, and candidate identity.

## Candidate-bound evidence

Evidence is meaningful only when bound to an immutable candidate identity (such as a commit SHA or content digest). Observations from past runs or differing contexts cannot be claimed as evidence for a current candidate.

## Independent observation

Required quality attribute targets cannot be satisfied by unverified agent narratives alone. Evidence must be collected by verifiable execution tools (`collector-observed`), external evaluation (`external-resolved`), or explicit human sign-off (`human-attested`).

## Account for every area

All 11 ISO/IEC 25010 quality areas must be evaluated for every non-trivial change. Leaving an area blank is a failure. An area that does not apply must be marked not applicable with an explicit, documented reason.

## Zero core coupling

Phase 1 non-functional verification operates as an opt-in extension pack. It introduces no breaking schema changes, digest mutations, or mandatory path blockers to core SDLC execution.
