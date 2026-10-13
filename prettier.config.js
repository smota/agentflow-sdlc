/** @type {import('prettier').Config} */
export default {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'auto',
  overrides: [
    {
      files: [
        'skills/agentflow-steerer/assets/steer-state.yaml',
        'adapters/claude-code/skills/agentflow-steerer/assets/steer-state.yaml',
      ],
      options: { parser: 'json' },
    },
  ],
}
