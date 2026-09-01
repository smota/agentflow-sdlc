import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateRequirementNamespaces } from '../capabilities.mjs'
import { runEvalManifest } from '../agent-evals.mjs'
import { validateArtifactRef, validateTransitionEnvelope } from '../evidence-contracts.mjs'
import {
  validateActionBoundary,
  validateDeliveryHandoff,
  validateExternalSignal,
} from '../lifecycle-contracts.mjs'
import { deriveOutcomeMetrics } from '../outcome-metrics.mjs'
import { validateClaudeAgyAcceptance } from '../multi-agent-acceptance.mjs'
import {
  canonicalRole,
  CORE_ROLES,
  DEFAULT_PROFILE_REQUIREMENTS,
  sdlcVocabulary,
} from '../sdlc-vocabulary.mjs'

const config = JSON.parse(readFileSync(new URL('../../defaults/sdlc.config.json', import.meta.url)))
const cliTransitionSchema = JSON.parse(
  readFileSync(new URL('../../schemas/transition-envelope.cli.schema.json', import.meta.url)),
)
const ref = (kind = 'goal', relationship = 'input') => ({
  kind,
  system: 'github',
  uri: 'https://example.test/1',
  authority: 'authoritative',
  relationship,
  revision: 'abc',
})

describe('canonical SDLC vocabulary', () => {
  it('preserves the guiding-principle invariants', () => {
    expect(config.principles).toEqual(
      expect.arrayContaining([
        'AgentFlow concepts lead; source systems are substrate.',
        'Durable evidence is required for delivery claims.',
        'Single-agent is default; multi-agent claims require attribution.',
        'High-assurance work requires a human approval gate.',
        'Skipped-by-path roles do not reduce readiness.',
        'Follow-up issues replace hidden TODOs.',
        'Harness directories contain generated adapters only.',
      ]),
    )
    expect(config.actionPolicy.externalActionRequiresHumanApproval).toBe(true)
    expect(config.actionPolicy.delegationMayNotWidenBoundary).toBe(true)
  })

  it('includes every configured profile and canonicalizes legacy input only', () => {
    expect(sdlcVocabulary(config).profiles).toContain('exploratory')
    expect(canonicalRole('product-manager', config)).toBe('product-manager-jtbd')
    expect(canonicalRole('developer-plan', config)).toBe('developer-planning')
    expect(canonicalRole('techwriter', config)).toBe('tech-writer')
  })

  it('keeps runtime and Cockpit defaults in parity with machine configuration', () => {
    expect(CORE_ROLES.map((role) => role.slug)).toEqual(config.roles.map((role) => role.slug))
    expect(Object.keys(DEFAULT_PROFILE_REQUIREMENTS)).toEqual(Object.keys(config.paths))
    for (const [profile, requirements] of Object.entries(DEFAULT_PROFILE_REQUIREMENTS)) {
      expect(requirements.required).toEqual(config.paths[profile].requiredRoles)
      expect(requirements.optional).toEqual(config.paths[profile].optionalRoles)
    }
  })

  it('separates workflow capabilities, tool permissions, and controls', () => {
    expect(validateRequirementNamespaces({ requiredCapabilities: ['shell'] })).toMatchObject({
      ok: true,
    })
    expect(
      validateRequirementNamespaces({
        requiredToolPermissions: ['shell'],
        controlRequirements: ['single-writer'],
      }),
    ).toMatchObject({ ok: true, errors: [] })
    expect(validateRequirementNamespaces({ requiredWorkflowCapabilities: ['shell'] }).ok).toBe(
      false,
    )
  })
})

describe('portable evidence contracts', () => {
  it('keeps the CLI schema self-contained and aligned with canonical ArtifactRef vocabulary', () => {
    expect(cliTransitionSchema.$schema).toBeUndefined()
    expect(JSON.stringify(cliTransitionSchema)).not.toContain('"$ref"')
    for (const field of ['inputRefs', 'outputRefs', 'validationRefs']) {
      const properties = cliTransitionSchema.properties[field].items.properties
      expect(properties.kind.enum).toEqual(config.vocabulary.artifactKinds)
      expect(properties.authority.enum).toEqual(config.vocabulary.sourceAuthorities)
      expect(properties.relationship.enum).toEqual(config.vocabulary.artifactRelationships)
    }
  })

  it('accepts ArtifactRefs and an allowed canonical transition', () => {
    expect(validateArtifactRef(ref(), config).ok).toBe(true)
    expect(
      validateTransitionEnvelope(
        {
          version: 1,
          subject: 'issue:1',
          fromRole: 'analyst',
          toRole: 'architect',
          decision: 'pass',
          nextContract: 'Produce technical design',
          timestamp: '2026-08-31T10:00:00Z',
          inputRefs: [ref()],
          outputRefs: [ref('requirement', 'output')],
          validationRefs: [],
          openQuestions: [],
          provenance: {
            platform: 'claude',
            executor: 'claude-cli',
            transport: 'local-cli',
            delegationBoundary: 'current-session',
          },
        },
        config,
      ).ok,
    ).toBe(true)
  })

  it('rejects embedded artifacts and disallowed transitions', () => {
    expect(validateArtifactRef({ ...ref(), uri: 'data:text/plain,secret' }, config).ok).toBe(false)
    expect(
      validateArtifactRef({ ...ref(), uri: 'https://user:password@example.test/1' }, config).ok,
    ).toBe(false)
    expect(
      validateTransitionEnvelope(
        {
          version: 1,
          subject: 'x',
          fromRole: 'analyst',
          toRole: 'developer',
          decision: 'pass',
          nextContract: 'code',
          timestamp: 'bad',
          inputRefs: [],
          outputRefs: [],
          validationRefs: [],
          provenance: { platform: 'x', executor: 'x', transport: 'x', delegationBoundary: 'x' },
        },
        config,
      ).ok,
    ).toBe(false)
    expect(
      validateTransitionEnvelope(
        {
          version: 1,
          subject: 'x',
          fromRole: 'analyst',
          toRole: 'architect',
          decision: 'pass',
          nextContract: 'design',
          timestamp: '2026-08-31T10:00:00Z',
          inputRefs: {},
          outputRefs: [],
          validationRefs: [],
          provenance: {
            platform: 'claude',
            executor: 'claude-cli',
            transport: 'local-cli',
            delegationBoundary: 'current-session',
          },
        },
        config,
      ).ok,
    ).toBe(false)
  })
})

describe('boundary contracts', () => {
  it('requires signal triage before development', () => {
    expect(
      validateExternalSignal(
        {
          version: 1,
          id: 's1',
          state: 'accepted',
          previousState: 'triaged',
          summary: 'signal',
          triageRole: 'analyst',
          goalRef: ref('goal', 'output'),
          nextRole: 'developer',
          evidenceRefs: [],
        },
        config,
      ).ok,
    ).toBe(false)
  })

  it('accepts a properly triaged external signal into the normal Analyst path', () => {
    expect(
      validateExternalSignal(
        {
          version: 1,
          id: 's2',
          state: 'accepted',
          previousState: 'triaged',
          summary: 'validated need',
          triageRole: 'product-manager-jtbd',
          goalRef: ref('goal', 'output'),
          nextRole: 'analyst',
          evidenceRefs: [],
        },
        config,
      ).ok,
    ).toBe(true)
  })

  it('requires validated, owned delivery handoff evidence', () => {
    const report = validateDeliveryHandoff(
      {
        version: 1,
        id: 'h1',
        state: 'ready',
        previousState: 'proposed',
        sourceRole: 'pr-readiness',
        externalOwner: 'release-team',
        artifactRefs: [ref('release', 'output')],
        validationRefs: [ref('validation', 'verifies')],
        approvalRefs: [],
        rollbackNotApplicableReason: 'documentation-only',
      },
      config,
    )
    expect(report.ok).toBe(true)
    expect(
      validateDeliveryHandoff(
        {
          version: 1,
          id: 'bad',
          state: 'proposed',
          sourceRole: 'pr-readiness',
          artifactRefs: {},
          validationRefs: [],
          approvalRefs: [],
        },
        config,
      ).ok,
    ).toBe(false)
  })

  it('prevents profile and delegation boundary widening', () => {
    expect(
      validateActionBoundary(
        {
          version: 1,
          profile: 'exploratory',
          requested: 'external-action',
          effective: 'open-pr',
          parent: 'propose',
        },
        config,
      ).ok,
    ).toBe(false)
    expect(
      validateActionBoundary(
        {
          version: 1,
          profile: 'standard',
          requested: 'open-pr',
          effective: 'mutate-worktree',
          parent: 'open-pr',
        },
        config,
      ).ok,
    ).toBe(true)
  })

  it('keeps action validation compatible with v1 configs that predate actionPolicy', () => {
    const legacyConfig = structuredClone(config)
    delete legacyConfig.actionPolicy
    delete legacyConfig.vocabulary
    expect(
      validateActionBoundary(
        {
          version: 1,
          profile: 'standard',
          requested: 'open-pr',
          effective: 'mutate-worktree',
        },
        legacyConfig,
      ).ok,
    ).toBe(true)
  })
})

describe('evals and derived outcome metrics', () => {
  it('validates the semantic Claude to Agy acceptance chain', () => {
    const claude = JSON.parse(
      readFileSync(new URL('../../agents/evals/fixtures/claude-analyst.txt', import.meta.url)),
    )
    const agy = JSON.parse(
      readFileSync(new URL('../../agents/evals/fixtures/agy-architect.txt', import.meta.url)),
    )
    expect(validateClaudeAgyAcceptance({ claude, agy }, config).ok).toBe(true)
    agy.provenance.platform = 'antigravity'
    expect(validateClaudeAgyAcceptance({ claude, agy }, config).ok).toBe(false)
  })

  it('runs deterministic assertions', () => {
    const report = runEvalManifest(
      {
        version: 1,
        id: 'sample',
        owner: 'review',
        subject: { kind: 'framework', path: 'defaults/sdlc.config.json' },
        cases: [
          {
            id: 'canonical-output',
            actual: '../fixtures/canonical-output.txt',
            assertions: [
              { type: 'contains', value: 'product-manager-jtbd' },
              { type: 'not-contains', value: 'techwriter' },
            ],
          },
        ],
      },
      {
        manifestPath: fileURLToPath(
          new URL('../../agents/evals/manifests/framework-contracts.json', import.meta.url),
        ),
      },
    )
    expect(report.ok).toBe(true)
  })

  it('fails malformed eval manifests and paths that escape the eval root', () => {
    expect(
      runEvalManifest({
        version: 1,
        id: 'bad',
        owner: 'review',
        subject: { kind: 'x', path: 'x' },
        cases: [{ id: 'x', actual: '../../../outside.txt', assertions: [{ type: 'unknown' }] }],
      }).status,
    ).toBe('invalid')
    const escaped = runEvalManifest(
      {
        version: 1,
        id: 'escape',
        owner: 'review',
        subject: { kind: 'x', path: 'x' },
        cases: [
          {
            id: 'x',
            actual: '../../../outside.txt',
            assertions: [{ type: 'contains', value: 'x' }],
          },
        ],
      },
      {
        manifestPath: fileURLToPath(
          new URL('../../agents/evals/manifests/framework-contracts.json', import.meta.url),
        ),
      },
    )
    expect(escaped.cases[0].failures).toContain('actual output escapes eval root')
  })

  it('deduplicates, orders, and preserves unknown metrics as null', () => {
    const report = deriveOutcomeMetrics([
      { id: '2', subject: 'x', type: 'pr-ready', timestamp: '2026-08-31T11:00:00Z' },
      { id: '1', subject: 'x', type: 'work-started', timestamp: '2026-08-31T10:00:00Z' },
      { id: '1', subject: 'x', type: 'released', timestamp: '2026-08-31T12:00:00Z' },
    ])
    expect(report.eventCount).toBe(2)
    expect(report.samples[0]).toMatchObject({
      cycleTimeSeconds: 3600,
      releaseLeadTimeSeconds: null,
      firstPassValidation: null,
    })
  })

  it('does not fabricate zero durations for reversed or incomplete events', () => {
    const report = deriveOutcomeMetrics([
      { id: 'a', subject: 'x', type: 'work-started', timestamp: '2026-08-31T12:00:00Z' },
      { id: 'b', subject: 'x', type: 'pr-ready', timestamp: '2026-08-31T11:00:00Z' },
      { id: 'c', type: 'released', timestamp: '2026-08-31T13:00:00Z' },
    ])
    expect(report.samples[0].cycleTimeSeconds).toBeNull()
    expect(report.eventCount).toBe(2)
  })
})
