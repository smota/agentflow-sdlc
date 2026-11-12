import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import * as prettier from 'prettier'
import {
  buildDeliveryWorkflowSpec,
  expectedMaxHops,
  mappedReturns,
  renderWorkflowSpecYaml,
  workflowSpecProblems,
  workflowStructureProblems,
} from '../workflow-spec.mjs'
import {
  MAX_RETURN_CYCLES,
  PHASES,
  RETURNS,
  allowedNext,
  validateTransition,
} from '../../../lib/core/phase-graph.mjs'
import { loadSeatTable } from '../../../lib/seat-table-io.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const specFile = resolve(
  root,
  'adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml',
)
const seatTable = loadSeatTable(root)
const committed = () => YAML.parse(readFileSync(specFile, 'utf8'))
const check = (doc, extra = {}) => workflowSpecProblems(doc, { seatTable, ...extra })

describe('committed workflow spec', () => {
  it('equals the generator output (golden)', () => {
    const text = renderWorkflowSpecYaml(buildDeliveryWorkflowSpec({ seatTable }))
    expect(readFileSync(specFile, 'utf8')).toBe(text)
  })

  it('is prettier-clean', async () => {
    const text = readFileSync(specFile, 'utf8')
    const config = await prettier.resolveConfig(specFile)
    expect(await prettier.format(text, { ...config, filepath: specFile })).toBe(text)
  })

  it('passes the structural and phase-graph checks', () => {
    expect(workflowStructureProblems(committed())).toEqual([])
    expect(check(committed())).toEqual([])
  })

  it('computes max_hops as 8 + cap x loop sizes = 56', () => {
    expect(mappedReturns()).toEqual({ 2: 1, 3: 1, 4: 3, 6: 4, 7: 4, 8: 4 })
    expect(committed().workflow.loop_guards.max_hops).toBe(56)
    expect(expectedMaxHops({ mapped: mappedReturns(), maxReturnCycles: 3 })).toBe(80)
  })

  it('matches an explicit worst-case path', () => {
    // 8 forward hops, then per allowed cycle (2): each mapped loop in full, plus the 4 -> 3 -> 1 detour.
    const loop = (from, to) => from - to + 1 // 1 return hop + (from - to) forward hops
    const mappedLoops = [loop(2, 1), loop(3, 1), loop(4, 3), loop(6, 4), loop(7, 4), loop(8, 4)]
    const detour = 1 + 1 + 3 // 4 -> 3, 3 -> 1, then 1 -> 2 -> 3 -> 4
    const worst = 8 + 2 * (mappedLoops.reduce((a, b) => a + b, 0) + detour)
    expect(worst).toBe(expectedMaxHops({ mapped: mappedReturns() }))
  })
})

describe('spec and phase graph disagreement', () => {
  it('flags a step owned by the wrong seat', () => {
    const doc = committed()
    doc.workflow.roles.tester.preferred_targets = ['dev-build@{rig}']
    expect(check(doc).join('\n')).toMatch(/step p5-tester: seats dev.build do not match phase 5/)
  })

  it('flags a changed phase order', () => {
    const doc = committed()
    doc.workflow.steps.splice(1, 2, doc.workflow.steps[2], doc.workflow.steps[1])
    expect(check(doc).join('\n')).toMatch(/do not match phases/)
  })

  it('flags a return mapped to a phase the graph does not allow (5 -> 4)', () => {
    const doc = committed()
    doc.workflow.steps.find((s) => s.id === 'p5-tester').next_hop = {
      on: { failed: 'p4-developer' },
    }
    expect(check(doc).join('\n')).toMatch(/step p5-tester: on.failed "p4-developer" is not a legal/)
  })

  it('flags a missing mapped return and a wrong target', () => {
    const doc = committed()
    delete doc.workflow.steps.find((s) => s.id === 'p6-reviewer').next_hop
    doc.workflow.steps.find((s) => s.id === 'p4-developer').next_hop.on.failed = 'p1-analyst'
    const text = check(doc).join('\n')
    expect(text).toMatch(/p6-reviewer: missing on.failed/)
    expect(text).toMatch(/p4-developer: on.failed must return to phase 3/)
  })

  it('flags a wrong max_hops and a changed cap', () => {
    const doc = committed()
    doc.workflow.loop_guards.max_hops = 12
    expect(check(doc).join('\n')).toMatch(/max_hops is 12, expected 56/)
    expect(check(committed(), { maxReturnCycles: 3 }).join('\n')).toMatch(/expected 80/)
  })

  it('flags stuck_overdue and a missing default', () => {
    const doc = committed()
    delete doc.workflow.exception_routing.classes.stuck_overdue
    delete doc.workflow.exception_routing.default
    const text = check(doc).join('\n')
    expect(text).toMatch(/stuck_overdue must be human_only/)
    expect(text).toMatch(/exception_routing.default is required/)
  })

  it.each([
    [
      'extra on.handoff',
      (d) => (d.workflow.steps[3].next_hop.on.handoff = 'p7-writer'),
      /on.handoff is not a legal/,
    ],
    [
      'done on p4',
      (d) => d.workflow.steps[3].allowed_exits.push('done'),
      /only cleanup may allow done/,
    ],
    [
      'no exits on p4',
      (d) => delete d.workflow.steps[3].allowed_exits,
      /allowed_exits must be explicit/,
    ],
    [
      'p6 without failed',
      (d) => (d.workflow.steps[5].allowed_exits = ['handoff']),
      /p6-reviewer must allow failed/,
    ],
    ['cleanup removed', (d) => d.workflow.steps.pop(), /cleanup must be the single, last step/],
    [
      'cleanup moved',
      (d) => d.workflow.steps.unshift(d.workflow.steps.pop()),
      /cleanup must be the single, last/,
    ],
    [
      'cleanup role',
      (d) => (d.workflow.steps.at(-1).actor_role = 'builder'),
      /cleanup must be owned by architect/,
    ],
    [
      'cleanup no failed',
      (d) => (d.workflow.steps.at(-1).allowed_exits = ['done']),
      /cleanup must allow failed/,
    ],
    [
      'entry mismatch',
      (d) => (d.workflow.entry.role = 'architect'),
      /entry.role "architect" must equal/,
    ],
  ])('mutation: %s', (_name, mutate, pattern) => {
    const doc = committed()
    mutate(doc)
    expect(check(doc).join('\n')).toMatch(pattern)
  })

  it('flags unknown keys under loop_guards and exception_routing.classes', () => {
    const doc = committed()
    doc.workflow.loop_guards.extra = 1
    doc.workflow.exception_routing.classes.other = 'x'
    const text = workflowStructureProblems(doc).join('\n')
    expect(text).toMatch(/loop_guards: unknown key "extra"/)
    expect(text).toMatch(/exception_routing.classes: unknown key "other"/)
  })

  it('every phase step has explicit exits without done; builder lists dev-build first', () => {
    const wf = committed().workflow
    for (const step of wf.steps.filter((s) => s.id !== 'cleanup')) {
      expect(step.allowed_exits.length).toBeGreaterThan(0)
      expect(step.allowed_exits).not.toContain('done')
    }
    expect(wf.roles.builder.preferred_targets[0]).toBe('dev-build@{rig}')
  })

  it('flags unmapped_failed not routed to a person', () => {
    const doc = committed()
    doc.workflow.exception_routing.classes.unmapped_failed = 'orchestrator'
    expect(check(doc).join('\n')).toMatch(/unmapped_failed must be human_only/)
  })
})

describe('structure rules', () => {
  it('requires max_hops when the routing has a cycle', () => {
    const doc = committed()
    delete doc.workflow.loop_guards
    expect(workflowStructureProblems(doc).join('\n')).toMatch(/max_hops must be an integer >= 1/)
  })

  it('rejects unknown keys and a second root key', () => {
    const doc = committed()
    doc.workflow.steps[0].surprise = true
    doc.workflow.mystery = 1
    const text = workflowStructureProblems(doc).join('\n')
    expect(text).toMatch(/step p1-analyst: unknown key "surprise"/)
    expect(text).toMatch(/workflow: unknown key "mystery"/)
    expect(workflowStructureProblems({ workflow: {}, extra: {} })).toEqual([
      'spec must have the single root key "workflow"',
    ])
  })

  it('rejects an unknown actor role and a next_hop to a missing step', () => {
    const doc = committed()
    doc.workflow.steps[0].actor_role = 'nobody'
    doc.workflow.steps[1].next_hop.on.failed = 'p0-ghost'
    const text = workflowStructureProblems(doc).join('\n')
    expect(text).toMatch(/unknown actor_role "nobody"/)
    expect(text).toMatch(/targets unknown step "p0-ghost"/)
  })
})

describe('review is never owned by the builder seat', () => {
  it('builder and reviewer seat sets are disjoint', () => {
    const doc = committed()
    const seats = (role) => doc.workflow.roles[role].preferred_targets
    expect(seats('reviewer').filter((t) => seats('builder').includes(t))).toEqual([])
  })

  it('flags a reviewer role that includes a builder seat', () => {
    const doc = committed()
    doc.workflow.roles.reviewer.preferred_targets.push('dev-build@{rig}')
    expect(check(doc).join('\n')).toMatch(/seat dev.build owns both the developer and the reviewer/)
  })

  it('flags a phase graph that lets a builder review', () => {
    const phases = PHASES.map((p) => (p.phase === 6 ? { ...p, seat: 'dev.build' } : p))
    const doc = buildDeliveryWorkflowSpec({ seatTable, phases })
    expect(check(doc, { phases }).join('\n')).toMatch(/build and review/)
  })
})

describe('rework loop cap', () => {
  const returned = (phase, to) => ({
    phase,
    status: 'skipped',
    reason: `defect (return to phase ${to})`,
  })

  it('refuses a third return on one loop and offers no next phase', () => {
    expect(MAX_RETURN_CYCLES).toBe(2)
    const transitions = [returned(6, 4), returned(6, 4)]
    expect(() =>
      validateTransition({
        transitions,
        phase: 6,
        status: 'skipped',
        seat: 'rev.review',
        reason: 'again (return to phase 4)',
      }),
    ).toThrow(/Return cycle limit reached.*Human escalation required/)
    expect(allowedNext([...transitions, returned(6, 4)])).toEqual([])
  })

  it('routes the cap and the max_hops overflow to a person', () => {
    const wf = committed().workflow
    expect(wf.exception_routing.classes.unmapped_failed).toBe('human_only')
    expect(wf.loop_guards.max_hops).toBe(expectedMaxHops({ mapped: mappedReturns(RETURNS) }))
  })
})
