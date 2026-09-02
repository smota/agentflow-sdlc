import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  createSourceMutationPlan,
  createSourceMutationReceipt,
  sourceMutationIdempotencyKey,
  validateSourceMutationPlan,
} from '../core/source-adapter.mjs'

export function createGitHubCliSourceAdapter({ repo, execFile = execFileSync, receiptStore } = {}) {
  if (!repo) throw new Error('GitHub repository is required')
  const gh = (args) => execFile('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const applied = new Map()
  const flushed = new Set()
  const revision = ({ operation, parameters }) => {
    const value =
      operation === 'ensure-label'
        ? gh([
            'label',
            'list',
            '--repo',
            repo,
            '--limit',
            '1000',
            '--json',
            'name,color,description',
          ])
        : gh([
            'issue',
            'view',
            String(parameters.number),
            '--repo',
            repo,
            '--json',
            'number,state,updatedAt,labels',
          ])
    return createHash('sha256').update(value).digest('hex')
  }
  const capabilityFor = (operation) =>
    operation === 'add-comment' ? 'mutate-comments' : 'mutate-lifecycle'
  const adapter = {
    version: 1,
    id: 'github-cli',
    capabilities: ['read-artifacts', 'read-lifecycle', 'mutate-comments', 'mutate-lifecycle'],
    async readArtifact(reference) {
      const kind = reference?.kind
      if (!['issue', 'pull-request'].includes(kind)) {
        throw new Error('GitHub CLI adapter supports issue and pull-request references')
      }
      const command = kind === 'issue' ? 'issue' : 'pr'
      const fields =
        kind === 'issue'
          ? 'number,url,title,body,state,updatedAt'
          : 'number,url,body,baseRefName,merged,mergeCommit'
      return JSON.parse(
        gh([command, 'view', String(reference.number), '--repo', repo, '--json', fields]),
      )
    },
    async previewMutation({ operation, parameters, actionBoundary, idempotencyKey }) {
      if (!['ensure-label', 'add-comment', 'add-labels', 'close-artifact'].includes(operation)) {
        throw new Error(`unsupported GitHub CLI mutation: ${operation}`)
      }
      return createSourceMutationPlan({
        adapter: this,
        scope: repo,
        capability: capabilityFor(operation),
        operation,
        parameters,
        actionBoundary,
        expectedRevision: revision({ operation, parameters }),
        idempotencyKey: idempotencyKey ?? sourceMutationIdempotencyKey(operation, parameters),
      })
    },
    async applyMutation(plan, { confirm } = {}) {
      validateSourceMutationPlan(plan, this, confirm)
      if (applied.has(plan.idempotencyKey)) return applied.get(plan.idempotencyKey)
      if (!receiptStore) throw new Error('GitHub CLI mutation requires a durable receipt store')
      const stored = await receiptStore.get(plan.idempotencyKey)
      if (stored) return stored
      if (plan.operation === 'add-comment') {
        const marker = `<!-- agentflow-idempotency:${plan.idempotencyKey} -->`
        const value = JSON.parse(
          gh([
            'issue',
            'view',
            String(plan.parameters.number),
            '--repo',
            repo,
            '--json',
            'comments',
          ]),
        )
        const existing = value.comments?.find((comment) => comment.body?.includes(marker))
        if (existing) {
          const receipt = createSourceMutationReceipt(
            plan,
            { recovered: true, artifact: existing },
            revision(plan),
          )
          applied.set(plan.idempotencyKey, receipt)
          return receipt
        }
      }
      const currentRevision = revision(plan)
      if (currentRevision !== plan.expectedRevision) {
        throw new Error('GitHub CLI mutation plan is stale; remote artifact changed')
      }
      const { operation, parameters } = plan
      if (operation === 'ensure-label') {
        gh([
          'label',
          'create',
          parameters.label,
          '--repo',
          repo,
          '--color',
          '5319e7',
          '--description',
          'Managed by agentflow-sdlc integration lifecycle automation',
          '--force',
        ])
      } else if (operation === 'add-comment') {
        gh([
          'issue',
          'comment',
          String(parameters.number),
          '--repo',
          repo,
          '--body',
          `${parameters.body}\n\n<!-- agentflow-idempotency:${plan.idempotencyKey} -->`,
        ])
      } else if (operation === 'add-labels') {
        for (const label of parameters.labels) {
          gh(['issue', 'edit', String(parameters.number), '--repo', repo, '--add-label', label])
        }
      } else {
        gh(['issue', 'close', String(parameters.number), '--repo', repo, '--reason', 'completed'])
      }
      const result = { operation, parameters }
      const receipt = createSourceMutationReceipt(plan, result, revision(plan))
      applied.set(plan.idempotencyKey, receipt)
      return receipt
    },
    async flushReceipt(receipt) {
      if (flushed.has(receipt.receiptToken)) return { status: 'already-flushed', receipt }
      if (!receiptStore) throw new Error('GitHub CLI mutation requires a durable receipt store')
      await receiptStore.put(receipt)
      flushed.add(receipt.receiptToken)
      return { status: 'flushed', receipt }
    },
  }
  return adapter
}
