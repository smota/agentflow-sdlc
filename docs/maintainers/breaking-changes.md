# Unreleased breaking changes

Issue #188 intentionally removes the retired install/update command surface, static harness
capability matrix, v1 install lockfiles, and runtime compatibility aliases. The product owner
confirmed that there are no other active adopters and approved removal instead of maintaining shims.

The supported product adopts through the onboarding journey (`onboarding plan`, `apply`, `verify`)
over the transactional `adopt` primitives, with v2 lockfiles, portable execution intents, and
canonical prefixed role/skill identities. Existing legacy state is migrated only by an explicit
choice; it is never silently rewritten.

This work branch is not a published replacement for v1.0.0. Before publishing or promoting it,
obtain an explicit version/release decision, include these removals in release notes, and run the
full release gate. No version bump, tag, registry publication, or release is authorized by the
implementation approval alone.
