import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { createLocalOnboardingService } from '../onboarding/project-writer.mjs'
import { rollbackAdoption } from '../adoption/transaction.mjs'
import { inspectDoctor } from '../services/doctor-service.mjs'
import { LOCKFILE_NAME, readLockfile } from '../lockfile.mjs'

export const MCP_PROTOCOL_VERSION = '2024-11-05'
export const SERVER_NAME = 'agentflow-mcp'
export const SERVER_VERSION = '1.0.0'

export function listMcpTools() {
  return [
    {
      name: 'agentflow_doctor',
      description:
        'Inspect repository health, configuration drift, and harness adapter sync with remediation advice.',
      inputSchema: {
        type: 'object',
        properties: {
          targetDir: {
            type: 'string',
            description: 'Target repository root path (defaults to current working directory)',
          },
          harnesses: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of harnesses to inspect (defaults to all)',
          },
        },
      },
    },
    {
      name: 'agentflow_plan_change',
      description:
        'Plan onboarding, adoption, or configuration update and preview diffs with zero mutations on disk.',
      inputSchema: {
        type: 'object',
        properties: {
          targetDir: {
            type: 'string',
            description: 'Target repository root path',
          },
          profile: {
            type: 'string',
            description: 'Composition profile to apply (e.g. "standard", "github", "cockpit")',
            default: 'standard',
          },
          force: {
            type: 'boolean',
            description: 'Plan overwriting conflicting managed files',
            default: false,
          },
        },
      },
    },
    {
      name: 'agentflow_apply_change',
      description:
        'Apply planned AgentFlow changes transactionally with automatic rollback journal. Requires human confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          targetDir: {
            type: 'string',
            description: 'Target repository root path',
          },
          profile: {
            type: 'string',
            description: 'Composition profile to apply',
            default: 'standard',
          },
          confirm: {
            type: 'boolean',
            description:
              'Explicit human confirmation. MUST be true. An AI agent cannot self-confirm; only a human affirmative response permits setting this to true.',
          },
          force: {
            type: 'boolean',
            description: 'Force overwrite during application',
            default: false,
          },
        },
        required: ['confirm'],
      },
    },
    {
      name: 'agentflow_undo',
      description:
        'Undo recent changes or roll back to a specific journal point using transaction receipts.',
      inputSchema: {
        type: 'object',
        properties: {
          targetDir: {
            type: 'string',
            description: 'Target repository root path',
          },
          journalId: {
            type: 'string',
            description: 'Receipt token or transaction ID to roll back (defaults to latest)',
          },
        },
      },
    },
    {
      name: 'agentflow_status',
      description:
        'Query repository adoption status, active configuration lockfile, and transaction history.',
      inputSchema: {
        type: 'object',
        properties: {
          targetDir: {
            type: 'string',
            description: 'Target repository root path',
          },
        },
      },
    },
  ]
}

function resolveTargetDir(targetDir) {
  const dir = targetDir || process.cwd()
  return existsSync(dir) ? realpathSync(dir) : resolve(dir)
}

function discoverTransactions(targetDir) {
  const txRoot = join(targetDir, '.agentflow', 'transactions')
  if (!existsSync(txRoot)) return []
  try {
    const entries = readdirSync(txRoot, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse()

    const journals = []
    for (const dir of dirs) {
      const receiptPath = join(txRoot, dir, 'receipt.json')
      if (existsSync(receiptPath)) {
        try {
          const content = JSON.parse(readFileSync(receiptPath, 'utf8'))
          journals.push({
            id: dir,
            receiptToken: content.receiptToken,
            planToken: content.planToken,
            timestamp: content.timestamp,
            mutationsCount: content.mutations?.length ?? 0,
            receiptPath,
          })
        } catch {
          // ignore corrupted receipt
        }
      }
    }
    return journals
  } catch {
    return []
  }
}

function findReceipt(targetDir, journalId) {
  const journals = discoverTransactions(targetDir)
  if (journals.length === 0) return null
  if (!journalId) return journals[0]
  return (
    journals.find(
      (j) =>
        j.id === journalId || j.receiptToken === journalId || j.receiptToken?.startsWith(journalId),
    ) ?? null
  )
}

function generateDiffPreview(plan) {
  const sections = []
  const preview = plan.preview ?? {}
  const create = preview.create ?? []
  const change = preview.change ?? []
  const remove = preview.remove ?? []
  const untouched = preview.untouched ?? []

  sections.push(`### Plain-English Plan Summary`)
  sections.push(`- **New files to create**: ${create.length}`)
  for (const f of create.slice(0, 10)) sections.push(`  + ${f}`)
  if (create.length > 10) sections.push(`  ... and ${create.length - 10} more`)

  sections.push(`- **Files to update**: ${change.length}`)
  for (const f of change.slice(0, 10)) sections.push(`  ~ ${f}`)
  if (change.length > 10) sections.push(`  ... and ${change.length - 10} more`)

  sections.push(`- **Files to remove**: ${remove.length}`)
  for (const f of remove) sections.push(`  - ${f}`)

  sections.push(`- **Untouched files preserved**: ${untouched.length}`)

  return sections.join('\n')
}

export async function handleMcpRequest(request, { packageRoot, targetDir: defaultTargetDir } = {}) {
  const { jsonrpc, id, method, params } = request ?? {}

  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
    }
  }

  const pkgRoot = packageRoot ? resolve(packageRoot) : process.cwd()

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
        capabilities: {
          tools: {},
        },
      },
    }
  }

  if (method === 'notifications/initialized') {
    return id ? { jsonrpc: '2.0', id, result: {} } : undefined
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: listMcpTools(),
      },
    }
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments ?? {}
    const targetDir = resolveTargetDir(args.targetDir || defaultTargetDir)

    try {
      let resultData

      switch (toolName) {
        case 'agentflow_status': {
          const isAdopted =
            existsSync(join(targetDir, LOCKFILE_NAME)) || existsSync(join(targetDir, 'AGENTS.md'))
          let lockfile = null
          if (existsSync(join(targetDir, LOCKFILE_NAME))) {
            try {
              lockfile = readLockfile(targetDir)
            } catch {
              // ignore
            }
          }
          const journals = discoverTransactions(targetDir)
          resultData = {
            targetDir,
            isAdopted,
            lockfile,
            journals,
            activeProfile: lockfile?.profile ?? 'unknown',
          }
          break
        }

        case 'agentflow_doctor': {
          const report = inspectDoctor({
            packageRoot: pkgRoot,
            targetDir,
            harnesses: args.harnesses || ['all'],
          })
          resultData = report
          break
        }

        case 'agentflow_plan_change': {
          const service = createLocalOnboardingService()
          const plan = service.plan({
            packageRoot: pkgRoot,
            targetDir,
            profile: args.profile || 'standard',
            force: Boolean(args.force),
          })
          const diffPreview = generateDiffPreview(plan)
          const plannedMutations =
            plan.projectPlan?.actions ??
            plan.preview?.create?.map((p) => ({ path: p, action: 'create' })) ??
            []
          const summary = {
            totalPlanned: plannedMutations.length,
            create: plan.preview?.create?.length ?? 0,
            change: plan.preview?.change?.length ?? 0,
            remove: plan.preview?.remove?.length ?? 0,
            untouched: plan.preview?.untouched?.length ?? 0,
          }
          resultData = {
            ...plan,
            plannedMutations,
            summary,
            diffPreview,
            preview: plan.preview,
          }
          break
        }

        case 'agentflow_apply_change': {
          if (args.confirm !== true) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message:
                  'Human confirmation required: "confirm" parameter must be explicitly true. An AI agent cannot self-confirm changes without explicit user approval.',
              },
            }
          }
          const service = createLocalOnboardingService()
          const plan = service.plan({
            packageRoot: pkgRoot,
            targetDir,
            profile: args.profile || 'standard',
            force: Boolean(args.force),
          })
          const result = service.apply(plan, {
            confirm: plan.digest,
            targetDir,
            packageRoot: pkgRoot,
          })
          const receipt = result.receipt ?? result
          resultData = {
            ok: true,
            status: 'applied',
            journalId: receipt.receiptToken,
            receiptToken: receipt.receiptToken,
            appliedCount: receipt.mutations?.length ?? 0,
            applied: receipt.mutations?.map((m) => m.path) ?? [],
          }
          break
        }

        case 'agentflow_undo': {
          const match = findReceipt(targetDir, args.journalId)
          if (!match) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32001,
                message: `No matching rollback journal receipt found in ${targetDir}`,
              },
            }
          }
          const receipt = JSON.parse(readFileSync(match.receiptPath, 'utf8'))
          const undone = rollbackAdoption(targetDir, receipt, {
            confirm: receipt.receiptToken,
          })
          resultData = {
            ok: true,
            status: undone.status,
            journalId: receipt.receiptToken,
            restoredCount: receipt.mutations?.length ?? 0,
            targetDir,
          }
          break
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method or tool not found: ${toolName}`,
            },
          }
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(resultData, null, 2),
            },
          ],
        },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message,
        },
      }
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Unknown method: ${method}`,
    },
  }
}

export function startMcpStdioServer({ packageRoot, targetDir } = {}) {
  let buffer = ''
  process.stdin.setEncoding('utf8')

  process.stdin.on('data', async (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const request = JSON.parse(trimmed)
        const response = await handleMcpRequest(request, { packageRoot, targetDir })
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n')
        }
      } catch (err) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          }) + '\n',
        )
      }
    }
  })

  process.stdin.on('end', () => {
    process.exit(0)
  })
}
