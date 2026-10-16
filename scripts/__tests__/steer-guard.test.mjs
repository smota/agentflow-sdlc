import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSteerSeat,
  guardDecision,
  checkTargetRouting,
  runHook,
} from '../../adapters/openrig/agentflow-steer/steer-guard.mjs'

const BASE_DIR = resolve('adapters/openrig/agentflow-steer')

describe('agentflow-steer base rig and session guard (Issue #481)', () => {
  describe('isSteerSeat', () => {
    it('recognizes steering session names and seat identities', () => {
      expect(isSteerSeat('steer-lead@myproject-steer')).toBe(true)
      expect(isSteerSeat('steer@myproject')).toBe(true)
      expect(isSteerSeat('steer-supervisor@myproject-steer')).toBe(true)
      expect(isSteerSeat('steer.lead')).toBe(true)
    })

    it('rejects in-rig delivery and product seats', () => {
      expect(isSteerSeat('pm-manager@myproject-product')).toBe(false)
      expect(isSteerSeat('pm-analyst@myproject-product')).toBe(false)
      expect(isSteerSeat('orch-arch@myproject')).toBe(false)
      expect(isSteerSeat('dev-build@myproject')).toBe(false)
      expect(isSteerSeat('dev-build-sr@myproject')).toBe(false)
      expect(isSteerSeat('dev-qa@myproject')).toBe(false)
      expect(isSteerSeat('dev-test-eng@myproject')).toBe(false)
      expect(isSteerSeat('human')).toBe(false)
      expect(isSteerSeat(null)).toBe(false)
      expect(isSteerSeat(undefined)).toBe(false)
    })
  })

  describe('guardDecision for non-steering sessions', () => {
    it('passes all actions without blocking for worker sessions', () => {
      const session = 'dev-build@myproject'
      expect(guardDecision({ session, command: 'git commit -m "fix"' })).toEqual({ block: false })
      expect(guardDecision({ session, toolName: 'WriteToFile' })).toEqual({ block: false })
      expect(
        guardDecision({
          session,
          command: 'agentflow-sdlc handoff deliver --to rev-review@myproject',
        }),
      ).toEqual({ block: false })
    })
  })

  describe('guardDecision for steering sessions', () => {
    const session = 'steer-lead@myproject-steer'

    it('blocks file modification tools', () => {
      for (const tool of ['WriteToFile', 'ReplaceFileContent', 'Edit', 'Write', 'createFile']) {
        const decision = guardDecision({ session, toolName: tool })
        expect(decision.block).toBe(true)
        expect(decision.reason).toContain(`tool '${tool}' is prohibited`)
      }
    })

    it('allows read-only tools and harmless shell commands', () => {
      expect(guardDecision({ session, toolName: 'ReadFile' })).toEqual({ block: false })
      expect(guardDecision({ session, toolName: 'ListDir' })).toEqual({ block: false })
      expect(guardDecision({ session, command: 'git status' })).toEqual({ block: false })
      expect(guardDecision({ session, command: 'git log -n 5' })).toEqual({ block: false })
      expect(guardDecision({ session, command: 'git diff HEAD~1' })).toEqual({ block: false })
      expect(guardDecision({ session, command: 'gh pr view 123' })).toEqual({ block: false })
      expect(guardDecision({ session, command: 'gh pr checks 123' })).toEqual({ block: false })
    })

    it('blocks git mutation commands', () => {
      for (const cmd of [
        'git commit -m "test"',
        'git push origin main',
        'git merge feat/test',
        'git cherry-pick abc1234',
        'git rebase main',
        'git worktree add .worktrees/foo',
      ]) {
        const decision = guardDecision({ session, command: cmd })
        expect(decision.block).toBe(true)
        expect(decision.reason).toContain(
          'is prohibited. Steering seats must never modify git history',
        )
      }
    })

    it('blocks internal delivery handoffs', () => {
      const decision = guardDecision({
        session,
        command: 'agentflow-sdlc handoff deliver --to orch-arch@myproject',
      })
      expect(decision.block).toBe(true)
      expect(decision.reason).toContain(
        'Internal delivery handoffs are governed strictly by in-rig delivery agents',
      )
    })

    it('blocks keystroke interrupts', () => {
      for (const cmd of [
        'rig send builder@myproject "^C"',
        "rig send builder@myproject '\x03'",
        'tmux send-keys -t 0 C-c',
      ]) {
        const decision = guardDecision({ session, command: cmd })
        expect(decision.block).toBe(true)
        expect(decision.reason).toContain('Keystroke interrupts corrupt terminal processes')
      }
    })

    it('enforces the Target Routing Allowlist', () => {
      // Allowed targets
      expect(
        guardDecision({ session, command: 'rig send manager@myproject "Goal intake ready"' }),
      ).toEqual({ block: false })
      expect(
        guardDecision({
          session,
          command: 'rig send architect@myproject "Unfreeze packet available"',
        }),
      ).toEqual({ block: false })
      expect(
        guardDecision({
          session,
          command: 'rig queue create --destination human --summary "Release gate"',
        }),
      ).toEqual({ block: false })
      expect(
        guardDecision({
          session,
          command: 'rig queue create --destination manager@myproject --body-file /tmp/brief',
        }),
      ).toEqual({ block: false })

      // Prohibited targets (builders, testers, reviewers, analysts)
      for (const target of [
        'builder@myproject',
        'builder-jr@myproject',
        'builder-sr@myproject',
        'qa@myproject',
        'test-eng@myproject',
        'reviewer@myproject',
        'analyst@myproject',
      ]) {
        const sendDecision = guardDecision({
          session,
          command: `rig send ${target} "Please work on this"`,
        })
        expect(sendDecision.block).toBe(true)
        expect(sendDecision.reason).toContain('Target Routing Allowlist')

        const queueDecision = guardDecision({
          session,
          command: `rig queue create --destination ${target} --body-file /tmp/brief`,
        })
        expect(queueDecision.block).toBe(true)
        expect(queueDecision.reason).toContain('Target Routing Allowlist')
      }
    })
  })

  describe('PreToolUse runHook execution', () => {
    async function mockHookCall({ session, toolName = 'Bash', command = '' }) {
      let stderrOutput = ''
      const inputChunks = [
        JSON.stringify({
          tool_name: toolName,
          tool_input: { command },
        }),
      ]
      const stdin = (async function* () {
        for (const chunk of inputChunks) yield chunk
      })()
      const stderr = {
        write(msg) {
          stderrOutput += msg
        },
      }
      const exitCode = await runHook({
        stdin,
        env: { OPENRIG_SESSION_NAME: session },
        stderr,
      })
      return { exitCode, stderrOutput }
    }

    it('exits with 0 for non-steering sessions', async () => {
      const res = await mockHookCall({
        session: 'dev-build@myproject',
        command: 'git commit -m "feat"',
      })
      expect(res.exitCode).toBe(0)
      expect(res.stderrOutput).toBe('')
    })

    it('exits with 0 for allowed steering commands', async () => {
      const res = await mockHookCall({
        session: 'steer-lead@myproject-steer',
        command: 'git status',
      })
      expect(res.exitCode).toBe(0)
      expect(res.stderrOutput).toBe('')
    })

    it('exits with 2 and prints reason for prohibited steering actions', async () => {
      const res = await mockHookCall({
        session: 'steer-lead@myproject-steer',
        command: 'git commit -m "bad commit"',
      })
      expect(res.exitCode).toBe(2)
      expect(res.stderrOutput).toContain('git commit')

      const toolRes = await mockHookCall({
        session: 'steer-lead@myproject-steer',
        toolName: 'WriteToFile',
      })
      expect(toolRes.exitCode).toBe(2)
      expect(toolRes.stderrOutput).toContain(
        "direct file modification tool 'WriteToFile' is prohibited",
      )
    })
  })

  describe('agentflow-steer rig files integrity', () => {
    it('has valid rig.yaml referencing steer.yaml and lead member', () => {
      const rigPath = join(BASE_DIR, 'rig.yaml')
      expect(existsSync(rigPath)).toBe(true)
      const content = readFileSync(rigPath, 'utf8')
      expect(content).toContain('name: agentflow-steer')
      expect(content).toContain("permission_policy: 'policies/steer.yaml'")
      expect(content).toContain('id: lead')
      expect(content).toContain('profile: steering-lead')
      expect(content).toContain("cwd: '.'")
    })

    it('has CULTURE.md detailing the 10 steering laws', () => {
      const culturePath = join(BASE_DIR, 'CULTURE.md')
      expect(existsSync(culturePath)).toBe(true)
      const content = readFileSync(culturePath, 'utf8')
      expect(content).toContain('The 10 Steering Laws')
      expect(content).toContain('Two-Plane Separation')
      expect(content).toContain('Out-of-Worktree Principle')
      expect(content).toContain('Strict Target Routing')
      expect(content).toContain('Reverse-Seam Unfreeze Protocol')
    })

    it('has non-yolo permission policy in policies/steer.yaml', () => {
      const policyPath = join(BASE_DIR, 'policies/steer.yaml')
      expect(existsSync(policyPath)).toBe(true)
      const content = readFileSync(policyPath, 'utf8')
      expect(content).toContain('name: steer-restricted')
      expect(content).toContain('git commit*')
      expect(content).toContain('agentflow-sdlc handoff deliver*')
    })

    it('has agent.yaml with steer-guard hooks and excludes orchestrator', () => {
      const agentPath = join(BASE_DIR, 'agents/agentflow-steer/agent.yaml')
      expect(existsSync(agentPath)).toBe(true)
      const content = readFileSync(agentPath, 'utf8')
      expect(content).toContain('name: agentflow-steer-seat')
      expect(content).toContain('agentflow-steerer')
      expect(content).toContain('steer-guard-claude')
      expect(content).toContain('steer-guard-codex')
      expect(content).not.toContain('agentflow-orchestrator')
      expect(content).not.toContain('dev.build')
    })

    it('has configurations.yaml with declared runtime presets', () => {
      const configPath = join(BASE_DIR, 'configurations.yaml')
      expect(existsSync(configPath)).toBe(true)
      const content = readFileSync(configPath, 'utf8')
      expect(content).toContain('recommended: claude-lead')
      expect(content).toContain('claude-lead:')
      expect(content).toContain('codex-lead:')
      expect(content).toContain('pi-lead:')
    })

    it('has negative prompt tests in guidance/lead.md', () => {
      const guidancePath = join(BASE_DIR, 'agents/agentflow-steer/guidance/lead.md')
      expect(existsSync(guidancePath)).toBe(true)
      const content = readFileSync(guidancePath, 'utf8')
      expect(content).toContain('Negative Boundaries & Adversarial Prompt Handling')
      expect(content).toContain('Negative Prompt Test 1: Code Authoring / Bug Fixing')
      expect(content).toContain('Negative Prompt Test 2: Internal Handoff Delivery')
      expect(content).toContain('Negative Prompt Test 3: Builder / Tester Micromanagement')
      expect(content).toContain('Negative Prompt Test 4: Unverified PR Merge')
      expect(content).toContain('Negative Prompt Test 5: Keystroke Interrupts')
    })
  })
})
