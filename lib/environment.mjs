import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const INSTALL_OPTIONS = {
  git: [
    'macOS: brew install git',
    'Windows: winget install --id Git.Git',
    'Docs: https://git-scm.com/downloads',
  ],
  node: ['Docs: https://nodejs.org/', 'Version manager: https://github.com/Schniz/fnm'],
  pnpm: ['Corepack: corepack enable pnpm', 'Docs: https://pnpm.io/installation'],
  gh: [
    'macOS: brew install gh',
    'Windows: winget install --id GitHub.cli',
    'Docs: https://cli.github.com/',
  ],
  omnigent: ['Docs: https://github.com/omnigent-ai/omnigent', 'Website: https://omnigent.ai'],
}

function readConfig(targetDir) {
  const path = join(targetDir, 'agent-workflow.config.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

function commandParts(command) {
  const parts = command.trim().split(/\s+/)
  return { bin: parts[0], args: parts.slice(1) }
}

function runCommand(command, runner) {
  const { bin, args } = commandParts(command)
  try {
    const stdout = runner(bin, args)
    return { found: true, output: stdout.trim().split('\n')[0] ?? '' }
  } catch (error) {
    return { found: false, error: error.message }
  }
}

function defaultRunner(bin, args) {
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function tool(name, command, why, required, installOptions, runner) {
  const result = runCommand(command, runner)
  return {
    name,
    command,
    required,
    found: result.found,
    version: result.found ? result.output : null,
    why,
    installOptions,
  }
}

export function validateEnvironment(targetDir = process.cwd(), options = {}) {
  const runner = options.runner ?? defaultRunner
  const config = readConfig(targetDir)
  const routingAgents = config.routing?.agents ?? {}
  const configuredAgents = Object.entries(routingAgents)
    .filter(([, agent]) => agent?.enabled && agent?.availabilityCommand)
    .map(([slug, agent]) => ({ slug, command: agent.availabilityCommand }))

  const tools = [
    tool(
      'git',
      'git --version',
      'Required for branch, commit, and PR workflows.',
      true,
      INSTALL_OPTIONS.git,
      runner,
    ),
    tool(
      'node',
      'node --version',
      'Required for framework CLI, validators, hooks, and tests.',
      true,
      INSTALL_OPTIONS.node,
      runner,
    ),
    tool(
      'pnpm',
      'pnpm --version',
      'Required by this repository; adopting projects may use their own configured package manager.',
      false,
      INSTALL_OPTIONS.pnpm,
      runner,
    ),
    tool(
      'gh',
      'gh --version',
      'Needed for GitHub issue, PR, and release automation commands.',
      false,
      INSTALL_OPTIONS.gh,
      runner,
    ),
  ]

  for (const { slug, command } of configuredAgents) {
    tools.push(
      tool(
        slug,
        command,
        `Optional configured agent/runtime from agent-workflow.config.json routing.agents.${slug}.`,
        false,
        slug === 'omnigent'
          ? INSTALL_OPTIONS.omnigent
          : [`Install ${slug} using its official documentation.`],
        runner,
      ),
    )
  }

  const missingRequired = tools.filter((item) => item.required && !item.found)
  return {
    ok: missingRequired.length === 0,
    mutated: false,
    note: 'Read-only validation only. No installation commands were executed.',
    tools,
  }
}
