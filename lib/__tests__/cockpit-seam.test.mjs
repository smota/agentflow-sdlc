import { describe, expect, it } from 'vitest'
import { buildCockpitIssueView } from '../cockpit-read-model.mjs'
import { SIDES, WAITS, phaseSeam } from '../cockpit-seam.mjs'
import { renderIssueView } from '../cockpit-ui.mjs'
import { GATE_CLASSES } from '../core/gate.mjs'

// #413: the cockpit shows which side a goal is on and the one thing it waits for. PM is phases 0
// and 1, DEV is phase 2 onward. A delivery return, an intent stop, and a phase 1 handoff are kept
// apart, and no execution layer, squad, or seat is needed to show them.

const pass = (phase) => ({ phase, status: 'pass' })
const back = (phase, to) => ({ phase, status: 'skipped', reason: `defect, return to phase ${to}` })
const through = (last) => Array.from({ length: last + 1 }, (_, phase) => pass(phase))

const intentGate = (status = 'waiting') => ({ gateClass: GATE_CLASSES.adequacyOfIntent, status })
const releaseGate = (status = 'waiting') => ({ gateClass: GATE_CLASSES.releaseOfCandidate, status })

describe('the phase seam', () => {
  it('puts phases 0 and 1 on PM and phase 2 onward on DEV', () => {
    expect(phaseSeam({ transitions: [] })).toEqual({ side: SIDES.pm, wait: null })
    expect(phaseSeam()).toEqual({ side: 'PM', wait: null })
    expect(phaseSeam({ transitions: through(0) }).side).toBe('PM')
    expect(phaseSeam({ transitions: through(1) }).side).toBe('PM')
    for (const last of [2, 3, 4, 5, 6, 7, 8]) {
      expect(phaseSeam({ transitions: through(last) }), `phase ${last}`).toEqual({
        side: SIDES.dev,
        wait: null,
      })
    }
  })

  it('shows a phase 1 handoff while the latest pass is phase 0 or 1', () => {
    expect(phaseSeam({ transitions: through(1) })).toEqual({
      side: 'PM',
      wait: WAITS.phase1Handoff,
    })
    // Review regression: a phase 0 pass with no phase 2 pass is the handoff too.
    expect(phaseSeam({ transitions: through(0) })).toEqual({
      side: 'PM',
      wait: WAITS.phase1Handoff,
    })
    expect(phaseSeam({ transitions: [pass(0), { phase: 1, status: 'skipped' }] }).wait).toBe(
      WAITS.phase1Handoff,
    )
    expect(phaseSeam({ transitions: through(2) }).wait).toBeNull()
    expect(phaseSeam({ transitions: [] }).wait).toBeNull()
  })

  it('shows an intent stop while a person’s intent decision waits or was refused, on either side', () => {
    // Review regression: a refused intent gate stops the work as a waiting one does.
    for (const status of ['waiting', 'refused']) {
      for (const last of [0, 3, 6]) {
        expect(phaseSeam({ transitions: through(last), gates: [intentGate(status)] })).toEqual({
          side: last <= 1 ? 'PM' : 'DEV',
          wait: WAITS.intentStop,
        })
      }
    }
    for (const gates of [
      [intentGate('agreed')],
      [intentGate('stale')],
      [releaseGate()],
      [releaseGate('refused')],
    ]) {
      expect(phaseSeam({ transitions: through(4), gates }).wait).toBeNull()
    }
  })

  it('shows a delivery return as PM, whichever phase returned', () => {
    for (const transitions of [
      [...through(2), back(2, 1)],
      [...through(3), back(3, 1)],
      [...through(4), back(4, 1)],
      [...through(1), back(1, 0)],
    ]) {
      expect(phaseSeam({ transitions })).toEqual({
        side: 'PM',
        wait: WAITS.deliveryReturn,
        reason: transitions.at(-1).reason,
      })
    }
    // A return inside delivery stays DEV, and a skip that names no legal return is not a return.
    expect(phaseSeam({ transitions: [...through(6), back(6, 4)] })).toEqual({
      side: 'DEV',
      wait: null,
    })
    expect(phaseSeam({ transitions: [...through(5), back(5, 1)] }).wait).toBeNull()
    // Once PM passes phase 1 again, the return is over and the spec waits for delivery.
    expect(phaseSeam({ transitions: [...through(3), back(3, 1), pass(1)] })).toEqual({
      side: 'PM',
      wait: WAITS.phase1Handoff,
    })
  })

  it('never shows two waits together, in the order return, intent stop, handoff', () => {
    expect(phaseSeam({ transitions: [...through(3), back(3, 1)], gates: [intentGate()] })).toEqual({
      side: 'PM',
      wait: WAITS.deliveryReturn,
      reason: 'defect, return to phase 1',
    })
    expect(phaseSeam({ transitions: through(0), gates: [intentGate('refused')] }).wait).toBe(
      WAITS.intentStop,
    )
    expect(phaseSeam({ transitions: through(1), gates: [intentGate()] })).toEqual({
      side: 'PM',
      wait: WAITS.intentStop,
    })
    const histories = [[], through(0), through(1), through(4), [...through(3), back(3, 1)]]
    const gateSets = [
      [],
      [intentGate()],
      [intentGate('refused')],
      [releaseGate()],
      [intentGate(), releaseGate()],
    ]
    for (const transitions of histories) {
      for (const gates of gateSets) {
        const seam = phaseSeam({ transitions, gates })
        expect(Object.keys(seam).sort()).toEqual(
          seam.wait === WAITS.deliveryReturn ? ['reason', 'side', 'wait'] : ['side', 'wait'],
        )
        expect([null, ...Object.values(WAITS)]).toContain(seam.wait)
        expect(Object.values(SIDES)).toContain(seam.side)
      }
    }
  })

  it('shows the pair on the goal view with no squad or seat list', () => {
    const issue = { number: 7, title: 'A goal', body: 'Ship it.', labels: [], state: 'open' }
    const view = buildCockpitIssueView({ issue, comments: [], repo: 'o/r' })
    const seam = phaseSeam({ transitions: through(3), gates: [intentGate()] })
    const page = renderIssueView(view, { repo: 'o/r', seam })
    const section = page.match(/<section class="panel phase-seam"[\s\S]*?<\/section>/)?.[0]
    expect(section).toContain('<h2>DEV</h2>')
    expect(section).toContain('Waiting for: <strong>intent stop</strong>')
    expect(section).not.toMatch(/squad|seat|rig|orch\.|pm\.|dev\.|qa/i)
    const returned = renderIssueView(view, {
      repo: 'o/r',
      seam: phaseSeam({ transitions: [...through(3), back(3, 1)] }),
    })
    expect(returned).toContain('<h2>PM</h2>')
    expect(returned).toContain('Waiting for: <strong>delivery return</strong>')
    expect(returned).toContain('<p>defect, return to phase 1</p>')
    expect(renderIssueView(view, { repo: 'o/r', seam: phaseSeam() })).toContain(
      'Waiting for: <strong>nothing</strong>',
    )
    expect(renderIssueView(view, { repo: 'o/r' })).not.toContain('phase-seam')
  })
})
