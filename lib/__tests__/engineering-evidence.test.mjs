import { describe, expect, it } from 'vitest'
import {
  assertEngineeringEvidenceDisclosure,
  assertPublishableEngineeringEvidence,
  SOURCE_EVIDENCE_DISCLOSURE,
} from '../providers/engineering-evidence.mjs'

const operation = (overrides = {}) => ({
  id: 'edit-operation-1',
  action: 'edit',
  repository: 'owner/repo',
  paths: ['src/change.mjs'],
  arguments: { expectedArtifacts: ['src/change.mjs'] },
  ...overrides,
})
const config = (overrides = {}) => ({
  delivery: {
    source: { kind: 'github', repo: 'owner/repo', branch: 'agentflow-state' },
    engineeringProvider: { id: 'provider', sourceEvidenceDisclosure: SOURCE_EVIDENCE_DISCLOSURE },
    ...overrides,
  },
})
const checkpoint = (output) => ({
  kind: 'engineering-result',
  operationId: 'edit-operation-1',
  receipt: { status: 'pass' },
  output,
})
const output = (artifact) => ({
  stdout: JSON.stringify({ status: 'pass', artifacts: [artifact] }),
  stderr: '',
})

describe('engineering evidence publication boundary', () => {
  it('denies durable dispatch without the exact explicit source-evidence disclosure', () => {
    expect(() =>
      assertEngineeringEvidenceDisclosure(
        {
          delivery: {
            source: { kind: 'github', repo: 'owner/repo' },
            engineeringProvider: { id: 'provider' },
          },
        },
        operation(),
      ),
    ).toThrow(/disclosure required before dispatch/)
    expect(assertEngineeringEvidenceDisclosure(config(), operation())).toBe(true)
  })

  it('binds disclosure to the configured GitHub repository and requires operation path scope', () => {
    expect(() =>
      assertEngineeringEvidenceDisclosure(config(), operation({ repository: 'other/repo' })),
    ).toThrow(/does not match admitted repository/)
    expect(() =>
      assertEngineeringEvidenceDisclosure(
        config(),
        operation({
          arguments: { expectedArtifacts: ['.env'] },
        }),
      ),
    ).toThrow(/within admitted paths/)
    expect(() =>
      assertEngineeringEvidenceDisclosure(
        config(),
        operation({ paths: ['.env'], arguments: { expectedArtifacts: ['.env'] } }),
      ),
    ).toThrow(/exclude private files/)
  })

  it.each([
    ['raw secret', { stdout: 'token=ghp_' + 'a'.repeat(36), stderr: '' }],
    ['absolute private path', { stdout: 'loaded C:\\Users\\samue\\.ssh\\id_rsa', stderr: '' }],
    [
      'absolute POSIX path',
      { stdout: 'read /workspace/team/private.txt before continuing', stderr: '' },
    ],
  ])('rejects %s in raw evidence strings', (_label, raw) => {
    expect(() => assertPublishableEngineeringEvidence(checkpoint(raw), operation())).toThrow(
      /secret or private absolute path/,
    )
  })

  it('rejects a planted secret after decoding artifact base64', () => {
    const secret = 'ghp_' + 'b'.repeat(36)
    const artifact = {
      path: 'src/change.mjs',
      contentBase64: Buffer.from(`const token = '${secret}'`).toString('base64'),
    }
    expect(() =>
      assertPublishableEngineeringEvidence(checkpoint(output(artifact)), operation()),
    ).toThrow(/secret or private absolute path/)
  })

  it('rejects a planted private absolute path after decoding artifact base64', () => {
    const artifact = {
      path: 'src/change.mjs',
      contentBase64: Buffer.from(
        'const localFile = "C:\\\\Users\\\\samue\\\\.ssh\\\\id_rsa"',
      ).toString('base64'),
    }
    expect(() =>
      assertPublishableEngineeringEvidence(checkpoint(output(artifact)), operation()),
    ).toThrow(/secret or private absolute path/)
  })

  it('rejects malformed base64 nested in serialized stdout instead of swallowing the scan error', () => {
    const malformed = output({ path: 'src/change.mjs', contentBase64: 'not canonical??' })
    expect(() => assertPublishableEngineeringEvidence(checkpoint(malformed), operation())).toThrow(
      /base64 is not canonical/,
    )
  })

  it('rejects private artifact paths and artifacts outside admitted paths', () => {
    const bytes = Buffer.from('export const safe = true')
    expect(() =>
      assertPublishableEngineeringEvidence(
        checkpoint(
          output({
            path: '.env',
            contentBase64: bytes.toString('base64'),
          }),
        ),
        operation({ paths: ['.env'] }),
      ),
    ).toThrow(/Private engineering artifact path/)
    expect(() =>
      assertPublishableEngineeringEvidence(
        checkpoint(
          output({
            path: 'docs/private.mjs',
            contentBase64: bytes.toString('base64'),
          }),
        ),
        operation(),
      ),
    ).toThrow(/outside admitted operation paths/)
  })

  it('accepts a bounded artifact that is clean and within the admitted scope', () => {
    expect(
      assertPublishableEngineeringEvidence(
        checkpoint(
          output({
            path: 'src/change.mjs',
            content: 'export const changed = true\n',
          }),
        ),
        operation(),
      ),
    ).toBe(true)
  })
})
