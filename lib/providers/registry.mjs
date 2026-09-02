import { createGrokProvider } from './grok.mjs'
import { createLocalCliProvider, inspectFlagIntents } from './local-cli.mjs'
import { createManualProvider } from './manual.mjs'
import { createProviderApiProvider } from './provider-api.mjs'

export function builtInProviders(options = {}) {
  return [
    createLocalCliProvider({
      id: 'claude-cli',
      platform: 'claude',
      executable: 'claude',
      executionTarget: 'claude-cli',
      inspectIntentSupport: ({ executable, cwd, spawn, declared }) =>
        inspectFlagIntents({
          executable,
          cwd,
          spawn,
          declared,
          flags: {
            'plan-before-edit': '--permission-mode',
            'delegated-work': '--agents',
            'parallel-fanout': '--agents',
            'isolated-workspace': '--worktree',
            'background-execution': '--background',
            'structured-result': '--json-schema',
          },
        }),
      ...options.claude,
    }),
    createLocalCliProvider({
      id: 'codex-cli',
      platform: 'codex',
      executable: 'codex',
      executionTarget: 'codex-cli',
      ...options.codex,
    }),
    createLocalCliProvider({
      id: 'agy-cli',
      platform: 'agy',
      executable: 'agy',
      executionTarget: 'agy-cli',
      ...options.agy,
    }),
    createLocalCliProvider({
      id: 'pi-cli',
      platform: 'pi',
      executable: 'pi',
      executionTarget: 'pi-parent',
      ...options.pi,
    }),
    createGrokProvider(options.grok),
    createProviderApiProvider({
      id: 'xai-api',
      platform: 'grok',
      executionTarget: 'xai-api',
      invoke: options.xai?.invoke,
      trustSource: 'explicit xAI API project configuration',
    }),
    createManualProvider(),
    ...(options.additionalProviders ?? []),
  ]
}

export function providerById(id, providers = builtInProviders()) {
  return providers.find((provider) => provider.id === id) ?? null
}
