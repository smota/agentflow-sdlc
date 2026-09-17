import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectProcessObservation,
  windowsLauncherInvocation,
} from '../verification/process-collector.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Final review B3: on a stock Windows Node install `npm` is only `npm.cmd`, and the starter check
// `init` seeds could never start (ENOENT). It passed only where a toolchain manager put `npm.exe`
// first on PATH.
describe('Windows .cmd launchers', () => {
  it('runs a launcher through cmd.exe and refuses cmd metacharacters instead of escaping them', () => {
    const env = { ComSpec: 'C:/Windows/System32/cmd.exe' }
    expect(windowsLauncherInvocation('C:/tools/npm.cmd', ['test'], env, 'win32')).toEqual({
      target: env.ComSpec,
      args: ['/d', '/s', '/c', '"C:/tools/npm.cmd test"'],
      verbatim: true,
    })
    expect(windowsLauncherInvocation('/usr/bin/npm', ['test'], env, 'linux').verbatim).toBe(false)
    expect(() => windowsLauncherInvocation('npm.cmd', ['a&calc'], env, 'win32')).toThrow(
      /metacharacters/,
    )
  })

  it.runIf(process.platform === 'win32')(
    'observes a passing check whose executable resolves only to a .cmd launcher',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'agentflow-launcher-'))
      roots.push(root)
      const bin = join(root, 'bin')
      mkdirSync(bin)
      writeFileSync(join(bin, 'faketool.cmd'), '@exit /b 0\r\n')
      writeFileSync(join(root, 'a.js'), 'export const a = 1\n')
      const { observation } = collectProcessObservation({
        root,
        boundary: 'mutate-worktree',
        definition: {
          id: 'starter',
          criterionId: 'starter',
          executable: 'faketool',
          args: ['test'],
          assertions: ['exit-code'],
          timeoutMs: 20000,
          format: 'exit-code',
          inputs: ['a.js'],
          env: { PATH: bin, Path: bin },
        },
      })
      expect(observation.errors ?? []).toEqual([])
      expect(observation.outcome).toBe('pass')
    },
  )
})
