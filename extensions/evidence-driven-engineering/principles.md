# Principles

## Evidence before confidence

A claim is not ready for review until it names the evidence behind it: issue text, acceptance criteria, code diff, test output, validation logs, ADRs, or explicit human decisions.

## Analyze before editing

Non-trivial implementation begins with scope, risk, change surface, assumptions, and validation plan. If open questions affect correctness or safety, stop and ask instead of guessing.

## Decisions are durable

Material architectural or process decisions need a durable record. The record should state context, decision, considered alternatives, consequences, and follow-up needs.

## Tradeoffs are first-class

A plan should name what it optimizes for and what it gives up. Reversibility, blast radius, and operational cost are part of the decision, not afterthoughts.

## Validation is scoped but honest

Run the checks that match the change. If a check cannot run, record the reason and create or reference a follow-up for unresolved risk. Do not report partial validation as full success.

## Follow-up over drift

Out-of-scope improvements become follow-up issues. Avoid TODO comments, silent omissions, and opportunistic scope expansion.

## Project policy stays project-owned

A reusable extension may provide engineering defaults and templates, but stack-specific or domain-specific rules belong in the consuming project.
