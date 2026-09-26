import { describe, expect, it } from 'vitest'
import { createLocalCliProvider } from '../providers/local-cli.mjs'
import { createProviderApiProvider } from '../providers/provider-api.mjs'
import { createProviderExecutionReceipt } from '../providers/provider-receipt.mjs'

describe('provider model provenance', () => {
  it('does not turn the local CLI requested model into observed execution evidence', () => {
    const provider = createLocalCliProvider({
      id: 'agy-cli',
      platform: 'agy',
      executable: 'agy',
      executionTarget: 'agy-cli',
      spawn: () => ({ status: 0, stdout: '', stderr: '' }),
    })
    const plan = provider.plan({ model: 'requested-model', observedModel: 'caller-claim' })
    expect(provider.execute(plan, { confirm: plan.token }).actual.model).toBeNull()
  })

  it('does not infer an API model from the request or arbitrary provider output', async () => {
    const provider = createProviderApiProvider({
      id: 'xai-api',
      platform: 'grok',
      executionTarget: 'xai-api',
      invoke: async () => ({ model: 'unqualified-output-field' }),
    })
    const plan = provider.plan({ model: 'requested-model' })
    expect((await provider.execute(plan, { confirm: plan.token })).actual.model).toBeNull()
  })

  it('accepts model evidence explicitly supplied by the receipt-producing adapter', () => {
    const receipt = createProviderExecutionReceipt({
      provider: 'agy-cli',
      platform: 'agy',
      executionTarget: 'agy-cli',
      transport: 'local-cli',
      intentSupport: [],
      plan: {},
      request: { model: 'requested-model' },
      status: 'pass',
      startedAt: '2026-09-25T12:00:00.000Z',
      completedAt: '2026-09-25T12:00:01.000Z',
      observedModel: 'adapter-observed-model',
    })
    expect(receipt.actual.model).toBe('adapter-observed-model')
  })
})
