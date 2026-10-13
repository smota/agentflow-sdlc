import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { handleMcpRequest, listMcpTools } from '../mcp/server.mjs'
import { loadSkillCatalog, validateSkillCatalog } from '../skill-catalog.mjs'

const packageRoot = resolve(import.meta.dirname, '..', '..')
const roots = []

function createTempDir(prefix = 'agentflow-mcp-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('AgentFlow MCP Server & Tools Contract', () => {
  it('P3-C1: initialize returns server metadata and capabilities', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      },
      { packageRoot },
    )

    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'agentflow-mcp',
        version: expect.any(String),
      },
      capabilities: {
        tools: {},
      },
    })
  })

  it('P3-C2: tools/list returns exactly the 5 typed maintainer tools with valid input schemas', async () => {
    const tools = listMcpTools()
    expect(tools).toHaveLength(5)
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toEqual([
      'agentflow_doctor',
      'agentflow_plan_change',
      'agentflow_apply_change',
      'agentflow_undo',
      'agentflow_status',
    ])

    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        properties: expect.any(Object),
      })
    }

    const applyTool = tools.find((t) => t.name === 'agentflow_apply_change')
    expect(applyTool.inputSchema.properties.confirm).toBeDefined()
    expect(applyTool.inputSchema.required).toContain('confirm')
  })

  it('P3-C3: agentflow_status reports adoption and journal status', async () => {
    const targetDir = createTempDir()
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'agentflow_status',
          arguments: { targetDir },
        },
      },
      { packageRoot },
    )

    expect(response.error).toBeUndefined()
    expect(response.result.content).toBeDefined()
    const data = JSON.parse(response.result.content[0].text)
    expect(data.isAdopted).toBe(false)
    expect(data.targetDir).toBe(targetDir)
    expect(Array.isArray(data.journals)).toBe(true)
  })

  it('P3-C4: agentflow_doctor executes drift inspection and returns report', async () => {
    const targetDir = createTempDir()
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'agentflow_doctor',
          arguments: { targetDir },
        },
      },
      { packageRoot },
    )

    expect(response.error).toBeUndefined()
    const data = JSON.parse(response.result.content[0].text)
    expect(data.summary).toBeDefined()
    expect(data.findings).toBeDefined()
    expect(data.summary.totalFindings).toBeGreaterThanOrEqual(1)
  })

  it('P3-C5: agentflow_plan_change generates preview diffs without mutating repository', async () => {
    const targetDir = createTempDir()
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'agentflow_plan_change',
          arguments: { targetDir, profile: 'standard' },
        },
      },
      { packageRoot },
    )

    expect(response.error).toBeUndefined()
    const plan = JSON.parse(response.result.content[0].text)
    expect(plan.plannedMutations.length).toBeGreaterThan(0)
    expect(plan.summary).toBeDefined()
    expect(plan.diffPreview).toBeDefined()

    // Verifies zero-mutation proof: targetDir remains clean
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false)
  })

  it('P3-C6: agentflow_apply_change enforces human confirmation gate', async () => {
    const targetDir = createTempDir()
    // Attempt apply without confirm: true
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'agentflow_apply_change',
          arguments: { targetDir, profile: 'standard', confirm: false },
        },
      },
      { packageRoot },
    )

    expect(response.error).toBeDefined()
    expect(response.error.message).toMatch(/Human confirmation required/i)
  })

  it('P3-C7: agentflow_apply_change applies change when confirmed and agentflow_undo restores', async () => {
    const targetDir = createTempDir()
    // Apply with confirm: true
    const applyResponse = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'agentflow_apply_change',
          arguments: { targetDir, profile: 'standard', confirm: true },
        },
      },
      { packageRoot },
    )

    expect(applyResponse.error).toBeUndefined()
    const applyResult = JSON.parse(applyResponse.result.content[0].text)
    expect(applyResult.ok).toBe(true)
    expect(applyResult.journalId).toBeDefined()

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(true)

    // Undo via agentflow_undo
    const undoResponse = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'agentflow_undo',
          arguments: { targetDir, journalId: applyResult.journalId },
        },
      },
      { packageRoot },
    )

    expect(undoResponse.error).toBeUndefined()
    const undoResult = JSON.parse(undoResponse.result.content[0].text)
    expect(undoResult.ok).toBe(true)
    expect(undoResult.restoredCount).toBeGreaterThan(0)
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false)
  })

  it('P3-C8: maintains skill catalog integrity and 8-role peer recognition', () => {
    const catalog = loadSkillCatalog(packageRoot)
    const maintainer = catalog.skills.find((s) => s.role === 'maintainer')
    expect(maintainer).toBeDefined()
    expect(maintainer.qualifiedName).toBe('agentflow-maintainer')
    expect(maintainer.owns).toEqual([
      'maintenance.doctor',
      'maintenance.plan',
      'maintenance.repair',
      'maintenance.rollback',
    ])

    const validation = validateSkillCatalog({ packageRoot })
    expect(validation.ok).toBe(true)
    expect(validation.findings).toEqual([])
  })

  it('P3-C9: generates /agentflow:setup, /agentflow:doctor, /agentflow:repair, /agentflow:undo slash commands', async () => {
    const { syncSkillAdapters } = await import('../skill-adapters.mjs')
    const targetDir = createTempDir()
    syncSkillAdapters({ packageRoot, targetDir, harness: 'claude-code', write: true })

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(targetDir, '.claude/commands/agentflow/setup.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/commands/agentflow/doctor.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/commands/agentflow/repair.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude/commands/agentflow/undo.md'))).toBe(true)
  })
})
