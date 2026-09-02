import { createHash } from 'node:crypto'
import {
  createSourceMutationPlan,
  createSourceMutationReceipt,
  sourceMutationIdempotencyKey,
  validateSourceMutationPlan,
} from '../core/source-adapter.mjs'
import { createGitHubClient } from './github-client.mjs'

function issueRef(repo, issue) {
  return {
    kind: issue.pull_request ? 'implementation' : 'goal',
    system: 'github',
    uri: issue.html_url,
    authority: 'authoritative',
    relationship: 'observes',
    scope: repo,
    revision: String(issue.number),
  }
}

export function createGitHubSourceAdapter({ repo, client, token, fetchImpl, receiptStore } = {}) {
  if (!repo) throw new Error('GitHub repository is required')
  const github = client ?? createGitHubClient({ token, fetchImpl })
  const applied = new Map()
  const flushed = new Set()
  const revision = async (number) => {
    const issue = await github.issue(repo, number)
    return createHash('sha256')
      .update(
        JSON.stringify({ number: issue.number, state: issue.state, updatedAt: issue.updated_at }),
      )
      .digest('hex')
  }
  const adapter = {
    version: 1,
    id: 'github',
    capabilities: ['read-artifacts', 'read-lifecycle', 'mutate-comments'],
    async readArtifact(reference) {
      if (reference?.kind !== 'issue' && reference?.kind !== 'pull-request') {
        throw new Error('GitHub adapter supports issue and pull-request references')
      }
      const artifact =
        reference.kind === 'issue'
          ? await github.issue(repo, reference.number)
          : await github.pullRequest(repo, reference.number)
      return { artifact, ref: issueRef(repo, artifact) }
    },
    async listArtifacts(params = {}) {
      const artifacts = await github.issues(repo, params)
      return artifacts.map((artifact) => ({ artifact, ref: issueRef(repo, artifact) }))
    },
    async previewMutation({ operation, parameters, actionBoundary, idempotencyKey }) {
      if (operation !== 'add-comment') throw new Error(`unsupported GitHub mutation: ${operation}`)
      return createSourceMutationPlan({
        adapter: this,
        scope: repo,
        capability: 'mutate-comments',
        operation,
        parameters,
        actionBoundary,
        expectedRevision: await revision(parameters.number),
        idempotencyKey: idempotencyKey ?? sourceMutationIdempotencyKey(operation, parameters),
      })
    },
    async applyMutation(plan, { confirm } = {}) {
      validateSourceMutationPlan(plan, this, confirm)
      if (applied.has(plan.idempotencyKey)) return applied.get(plan.idempotencyKey)
      if (!receiptStore) throw new Error('GitHub mutation requires a durable receipt store')
      const stored = await receiptStore.get(plan.idempotencyKey)
      if (stored) return stored
      const marker = `<!-- agentflow-idempotency:${plan.idempotencyKey} -->`
      const comments = await github.issueComments(repo, plan.parameters.number)
      const existing = comments.find((comment) => comment.body?.includes(marker))
      if (existing) {
        const receipt = createSourceMutationReceipt(
          plan,
          { recovered: true, artifact: existing },
          await revision(plan.parameters.number),
        )
        applied.set(plan.idempotencyKey, receipt)
        return receipt
      }
      const currentRevision = await revision(plan.parameters.number)
      if (currentRevision !== plan.expectedRevision) {
        throw new Error('GitHub mutation plan is stale; remote artifact changed')
      }
      const comment = await github.createIssueComment(
        repo,
        plan.parameters.number,
        `${plan.parameters.body}\n\n${marker}`,
      )
      const result = {
        artifact: comment,
        ref: {
          kind: 'other',
          system: 'github',
          uri: comment.html_url,
          authority: 'authoritative',
          relationship: 'output',
          scope: repo,
          revision: String(comment.id),
        },
      }
      const receipt = createSourceMutationReceipt(
        plan,
        result,
        await revision(plan.parameters.number),
      )
      applied.set(plan.idempotencyKey, receipt)
      return receipt
    },
    async flushReceipt(receipt) {
      if (flushed.has(receipt.receiptToken)) return { status: 'already-flushed', receipt }
      if (!receiptStore) throw new Error('GitHub mutation requires a durable receipt store')
      await receiptStore.put(receipt)
      flushed.add(receipt.receiptToken)
      return { status: 'flushed', receipt }
    },
  }
  return adapter
}
