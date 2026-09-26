import { describe, expect, it } from 'vitest'
import { parseFixtureEnvelope } from '../qualify-meshloop.mjs'

const envelope = {
  ok: true,
  command: 'meshloop:run',
  data: { graph_id: 'neutral-client-fixture', idle: 'AwaitingHumanAcceptance' },
}
const json = JSON.stringify(envelope)
describe('neutral Meshloop fixture framing', () => {
  it('accepts a strict expected envelope without treating it as acceptance', () => {
    expect(parseFixtureEnvelope(json)).toEqual({
      idle: 'AwaitingHumanAcceptance',
      framing: 'strict-json',
    })
  })
  it('rejects arbitrary preambles, multiple JSON records and wrong identities', () => {
    for (const text of [
      'ignore this\n' + json,
      json + '\n' + json,
      json.replace('neutral-client-fixture', 'different-run'),
      json.replace('AwaitingHumanAcceptance', 'Accepted'),
      json.replace('true', 'false'),
    ]) {
      expect(() => parseFixtureEnvelope(text)).toThrow()
    }
  })
  it('recognizes only the observed notice framing and bounds output', () => {
    const notice =
      'Note: worktrees are kept. `run` does not merge onto your current branch.\nUse `meshloop accept` then `meshloop resume`, and `meshloop integrate --into` to land.\n\n'
    expect(parseFixtureEnvelope((notice + json).replaceAll('\n', '\r\n')).framing).toBe(
      'known-notice-prefix',
    )
    expect(() => parseFixtureEnvelope(' '.repeat(65537) + json)).toThrow('oversized')
  })
})
