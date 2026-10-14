import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePresets } from '../lifecycle.mjs'

const REPO_ROOT = process.cwd()
const ADAPTER_ROOT = join(REPO_ROOT, 'adapters', 'openrig')
const AGENTFLOW_RIG_DIR = join(ADAPTER_ROOT, 'agentflow')
const EVAL_RIG_DIR = join(ADAPTER_ROOT, 'agentflow-eval')
const ROOT_GUIDANCE_DIR = join(REPO_ROOT, 'agents', 'eval', 'guidance')
const SKILLS_DIR = join(REPO_ROOT, 'skills')

// Minimal YAML parser helper for basic key-value / block inspection
function readYamlFile(path) {
  expect(existsSync(path)).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('adapters/openrig - Autonomous Exploratory Dogfood Seat (Issue #486)', () => {
  describe('agentflow-eval standalone rig template', () => {
    it('defines valid rig.yaml structure for agentflow-eval', () => {
      const rigText = readYamlFile(join(EVAL_RIG_DIR, 'rig.yaml'))
      expect(rigText).toContain('name: agentflow-eval')
      expect(rigText).toContain("version: '0.2'")
      expect(rigText).toContain("permission_policy: 'local:policies/eval.yaml'")
      expect(rigText).toContain('- id: eval')
      expect(rigText).toContain('label: Evaluation & Dogfooding')
      expect(rigText).toContain('- id: tester')
      expect(rigText).toContain('profile: eval-tester')
      expect(rigText).toContain("agent_ref: 'local:agents/agentflow-eval'")
    })

    it('enforces zero delegation edges to or from inner delivery in agentflow-eval', () => {
      const rigText = readYamlFile(join(EVAL_RIG_DIR, 'rig.yaml'))
      expect(rigText).not.toMatch(
        /delegates_to[\s\S]*?(?:dev\.build|dev\.qa|rev\.review|orch\.arch)/,
      )
      expect(rigText).not.toMatch(
        /from:\s*eval\.tester[\s\S]*?to:\s*(?:dev\.build|dev\.qa|rev\.review|orch\.arch)/,
      )
    })

    it('provides CULTURE.md and README.md with out-of-band principles', () => {
      const cultureText = readYamlFile(join(EVAL_RIG_DIR, 'CULTURE.md'))
      expect(cultureText).toContain('Out-of-Band Discipline')
      expect(cultureText).toContain('.worktrees/*')
      expect(cultureText).toContain('.agentflow/intake/')

      const readmeText = readYamlFile(join(EVAL_RIG_DIR, 'README.md'))
      expect(readmeText).toContain('rig up agentflow-eval')
      expect(readmeText).toContain('eval.tester')
    })

    it('provides startup briefings for eval.tester', () => {
      const contextText = readYamlFile(join(EVAL_RIG_DIR, 'startup', 'context.md'))
      expect(contextText).toContain('Never enter `.worktrees/*`')
      expect(contextText).toContain('.agentflow/dogfood/dogfood-surface.json')

      const testerText = readYamlFile(join(EVAL_RIG_DIR, 'startup', 'tester.md'))
      expect(testerText).toContain('surface-reader.mjs')
      expect(testerText).toContain('exclusionFilters')
    })

    it('defines agentflow-eval agent profiles and startup guidance', () => {
      const agentText = readYamlFile(join(EVAL_RIG_DIR, 'agents', 'agentflow-eval', 'agent.yaml'))
      expect(agentText).toContain('name: agentflow-eval-seat')
      expect(agentText).toContain('eval-tester:')
      expect(agentText).toContain('guidance/role.md')
      expect(agentText).toContain('openrig-user')

      const roleGuidance = readYamlFile(
        join(EVAL_RIG_DIR, 'agents', 'agentflow-eval', 'guidance', 'role.md'),
      )
      expect(roleGuidance).toContain('eval.tester')
      expect(roleGuidance).toContain('Out-of-Band Evaluation Plane')
    })
  })

  describe('agentflow delivery rig template integration', () => {
    it('defines optional eval pod with tester member in agentflow/rig.yaml', () => {
      const rigText = readYamlFile(join(AGENTFLOW_RIG_DIR, 'rig.yaml'))
      expect(rigText).toContain('- id: eval')
      expect(rigText).toContain('label: Autonomous Dogfood & Evaluation')
      expect(rigText).toContain('- id: tester')
      expect(rigText).toContain('profile: eval-tester')
    })

    it('bars eval.tester from inner delivery delegation in agentflow/rig.yaml', () => {
      const rigText = readYamlFile(join(AGENTFLOW_RIG_DIR, 'rig.yaml'))
      // Must not have delegates_to from or to eval.tester
      const lines = rigText.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('kind: delegates_to')) {
          const block = lines.slice(i, i + 4).join('\n')
          expect(block).not.toContain('from: eval.tester')
          expect(block).not.toContain('to: eval.tester')
        }
      }
      // Can observe is permitted
      expect(rigText).toContain('to: eval.tester')
    })

    it('registers eval.tester in agentflow/configurations.yaml across runtimes', () => {
      const configText = readYamlFile(join(AGENTFLOW_RIG_DIR, 'configurations.yaml'))
      const { presets } = parsePresets(configText)
      expect(configText).toContain('eval.tester:')
      expect(configText).toContain('codex: eval-tester')
      expect(configText).toContain('claude-code: eval-tester')
      expect(configText).toContain('pi: eval-tester-pi')
    })

    it('provides eval-tester startup briefing and guidance in agentflow rig', () => {
      const startup = readYamlFile(join(AGENTFLOW_RIG_DIR, 'startup', 'eval-tester.md'))
      expect(startup).toContain('dogfood-surface.json')
      expect(startup).toContain('never enter worktrees')

      const guidance = readYamlFile(
        join(AGENTFLOW_RIG_DIR, 'agents', 'agentflow', 'guidance', 'eval-tester.md'),
      )
      expect(guidance).toContain('eval.tester')
      expect(guidance).toContain('Never Self-Route to Inner Delivery')
    })
  })

  describe('eval-restricted permission policy (policies/eval.yaml)', () => {
    it('allows read, execution, test, and curl commands while strictly denying commits and merges', () => {
      const policyText = readYamlFile(join(EVAL_RIG_DIR, 'policies', 'eval.yaml'))
      expect(policyText).toContain('name: eval-restricted')

      // Harnesses
      expect(policyText).toContain('claude-code:')
      expect(policyText).toContain('codex:')

      // Allowed
      expect(policyText).toContain('git log*')
      expect(policyText).toContain('git status*')
      expect(policyText).toContain('gh pr view*')
      expect(policyText).toContain('pnpm test*')
      expect(policyText).toContain('node scripts/dogfood/*')
      expect(policyText).toContain('curl*')

      // Denied
      expect(policyText).toContain('git commit*')
      expect(policyText).toContain('git push*')
      expect(policyText).toContain('git checkout -b*')
      expect(policyText).toContain('git merge*')
      expect(policyText).toContain('gh pr merge*')
      expect(policyText).toContain('agentflow-sdlc handoff deliver*')
    })
  })

  describe('seat guidance and negative constraints (agents/eval/guidance/role.md)', () => {
    it('documents canonical out-of-band execution discipline and negative boundaries', () => {
      const guidance = readYamlFile(join(ROOT_GUIDANCE_DIR, 'role.md'))
      expect(guidance).toContain('eval.tester')
      expect(guidance).toContain('Out-of-Band Evaluation Plane')

      // Out-of-band discipline
      expect(guidance).toContain('Never Inside Dirty Worktrees')
      expect(guidance).toContain('.worktrees/*')
      expect(guidance).toContain('Installed Artifact Target')
      expect(guidance).toContain('Cross-Runtime Diversity')

      // Negative constraints
      expect(guidance).toContain('Constraint 1: Never Self-Route to Inner Delivery')
      expect(guidance).toContain('Constraint 2: Never Pass or Fail Active PRs')
      expect(guidance).toContain('Constraint 3: Never Commit Code Changes or Edit Product Source')
      expect(guidance).toContain('Constraint 4: Respect Accepted Trade-Offs and Anti-Goals')

      // Exclusion filters
      expect(guidance).toContain('exclusionFilters')
      expect(guidance).toContain('.agentflow/dogfood/dogfood-surface.json')
    })
  })

  describe('openrig adapter manifest integration', () => {
    it('registers agentflow-eval rig and eval-tester role in adapters/openrig/manifest.json', () => {
      const manifest = JSON.parse(readFileSync(join(ADAPTER_ROOT, 'manifest.json'), 'utf8'))
      expect(manifest.rigs).toContain('agentflow-eval')
      expect(manifest.roles).toContain('eval-tester')
    })
  })
})
