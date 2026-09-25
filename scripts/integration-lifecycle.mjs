import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateSourceAdapter } from '../lib/core/source-adapter.mjs'
import { createGitHubCliSourceAdapter } from '../lib/sources/github-cli.mjs'
import { createFileSourceReceiptStore } from '../lib/sources/receipt-store.mjs'

export const DEFAULT_CONFIG = {
  integrationBranch: 'development',
  trunkBranch: 'main',
  closeIntegratedIssues: true,
  addLabels: ['integrated:development', 'awaiting-release'],
  referenceKeywords: ['Implements', 'Closes'],
}

// The complete set of recognized implementation and closure keywords.
// Only members of this list (case-insensitive) are permitted in referenceKeywords.
// New recognized variants must be added here explicitly; unknown strings are rejected.
export const SAFE_KEYWORDS = ['Implements', 'Closes', 'Fixes', 'Resolves']

// Keywords that indicate a related reference only and must never drive issue closure.
// This denylist is checked in addition to the SAFE_KEYWORDS allowlist.
export const REFERENCE_ONLY_KEYWORDS = ['Refs', 'Related', 'See', 'cc']

/**
 * Validates a referenceKeywords array from project config.
 *
 * Rules enforced:
 *  - Must be an array (non-array → error).
 *  - Must not be empty (empty array → error; zero keywords would match arbitrary text via
 *    an empty alternation in the regex).
 *  - Every entry must be a non-empty, non-whitespace-only string.
 *  - Every entry (without surrounding whitespace, case-insensitive) must appear in SAFE_KEYWORDS.
 *  - No entry may appear in REFERENCE_ONLY_KEYWORDS.
 *
 * Returns { ok: boolean, errors: string[] }.
 * Callers MUST throw when ok is false before applying any external effects.
 */
export function validateReferenceKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    return { ok: false, errors: ['referenceKeywords must be an array of strings'] }
  }
  if (keywords.length === 0) {
    return {
      ok: false,
      errors: [
        'referenceKeywords must not be empty; an empty array produces an invalid regex that matches arbitrary text',
      ],
    }
  }
  const errors = []
  for (const kw of keywords) {
    if (typeof kw !== 'string' || !kw.trim() || kw !== kw.trim()) {
      errors.push(`referenceKeywords contains an invalid entry: ${JSON.stringify(kw)}`)
      continue
    }
    const trimmed = kw.trim()
    if (REFERENCE_ONLY_KEYWORDS.some((unsafe) => unsafe.toLowerCase() === trimmed.toLowerCase())) {
      errors.push(
        `referenceKeywords contains reference-only keyword "${kw}" which must never drive issue closure; remove it from integrationLifecycle.referenceKeywords`,
      )
      continue
    }
    if (!SAFE_KEYWORDS.some((safe) => safe.toLowerCase() === trimmed.toLowerCase())) {
      errors.push(
        `referenceKeywords contains unrecognized keyword "${kw}"; only recognized implementation/closure keywords are permitted: ${SAFE_KEYWORDS.join(', ')}`,
      )
    }
  }
  return { ok: errors.length === 0, errors }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function loadIntegrationLifecycleConfig(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'agent-workflow.config.json')
  if (!existsSync(path)) return DEFAULT_CONFIG

  const config = JSON.parse(readFileSync(path, 'utf8'))
  const branching = isPlainObject(config.branching) ? config.branching : {}
  const lifecycle = isPlainObject(config.integrationLifecycle) ? config.integrationLifecycle : {}

  let resolvedKeywords = DEFAULT_CONFIG.referenceKeywords
  if (Object.hasOwn(lifecycle, 'referenceKeywords')) {
    const validation = validateReferenceKeywords(lifecycle.referenceKeywords)
    if (!validation.ok) {
      // An explicit but invalid override is a config error, not a missing value.
      // Throw before any external effects so the misconfiguration is visible.
      throw new Error(
        `[integration-lifecycle] invalid integrationLifecycle.referenceKeywords: ${validation.errors.join('; ')}`,
      )
    }
    resolvedKeywords = lifecycle.referenceKeywords
  }

  return {
    integrationBranch:
      lifecycle.integrationBranch ??
      branching.defaultPrTarget ??
      branching.integration ??
      'development',
    trunkBranch: lifecycle.trunkBranch ?? branching.trunk ?? 'main',
    closeIntegratedIssues: lifecycle.closeIntegratedIssues ?? true,
    addLabels: Array.isArray(lifecycle.addLabels) ? lifecycle.addLabels : DEFAULT_CONFIG.addLabels,
    referenceKeywords: resolvedKeywords,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parses issue references from PR body text using the given referenceKeywords.
 *
 * Safety rules enforced at the call boundary:
 *  - referenceKeywords must pass validateReferenceKeywords (non-empty, recognized, no Refs).
 *    Callers passing an invalid list receive an Error before any regex is built.
 *  - Word-boundary anchors (\b) are added around each keyword to prevent substring matches
 *    (e.g. "Discloses #N" must not match keyword "Closes").
 *  - Cross-repository references (owner/repo#N) are parsed but excluded from the returned list.
 *
 * @param {string} text  PR body or similar text.
 * @param {{ referenceKeywords?: string[] }} options
 * @returns {string[]} Sorted, deduplicated local issue refs (e.g. ["#24", "#26"]).
 */
export function parseIssueReferences(text = '', options = {}) {
  const keywords = Object.hasOwn(options, 'referenceKeywords')
    ? options.referenceKeywords
    : DEFAULT_CONFIG.referenceKeywords
  // Enforce validation at every call boundary, not only at config-load time.
  const validation = validateReferenceKeywords(keywords)
  if (!validation.ok) {
    throw new Error(
      `parseIssueReferences: invalid referenceKeywords: ${validation.errors.join('; ')}`,
    )
  }
  const keywordPattern = keywords.map(escapeRegExp).join('|')
  // \b ensures the keyword is a whole word: "Discloses" cannot match keyword "Closes".
  const regex = new RegExp(
    `\\b(?:${keywordPattern})\\b\\s+((?:#\\d+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#\\d+)(?:[\\s,;]+(?:#\\d+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#\\d+))*)`,
    'gi',
  )
  const refs = new Set()
  for (const match of text.matchAll(regex)) {
    for (const ref of match[1].match(/(?:#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)/g) ?? []) {
      if (!ref.includes('/')) refs.add(ref)
    }
  }
  return [...refs].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

export function buildIntegrationComment({
  prNumber,
  prUrl,
  baseRefName,
  mergeCommit,
  trunkBranch,
}) {
  return [
    `Integrated into \`${baseRefName}\` by PR #${prNumber}: ${prUrl}`,
    '',
    `Merge commit: \`${mergeCommit ?? 'unknown'}\``,
    `Release/promotion to \`${trunkBranch}\` is tracked separately.`,
  ].join('\n')
}

function parseArgs(argv) {
  const args = { apply: false, eventPath: process.env.GITHUB_EVENT_PATH }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--event') args.eventPath = argv[++index]
    else if (arg === '--repo') args.repo = argv[++index]
    else if (arg === '--pr') args.pr = argv[++index]
    else if (arg === '--receipt') args.receiptPath = argv[++index]
  }
  return args
}

function loadPrFromEvent(eventPath) {
  if (!eventPath) throw new Error('Missing --event or GITHUB_EVENT_PATH')
  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  return event.pull_request
}

function normalizePr(pr) {
  const mergeCommit = pr.merge_commit_sha ?? pr.mergeCommit?.oid ?? pr.mergeCommit?.abbreviatedOid
  return {
    number: pr.number,
    url: pr.html_url ?? pr.url,
    body: pr.body ?? '',
    baseRefName: pr.base?.ref ?? pr.baseRefName,
    merged: pr.merged ?? pr.merged_at !== null,
    mergeCommit,
  }
}

export function planIntegrationLifecycle(pr, config) {
  if (!pr.merged) return { ok: true, skipped: true, reason: 'PR is not merged', issues: [] }
  if (pr.baseRefName !== config.integrationBranch) {
    return {
      ok: true,
      skipped: true,
      reason: `PR base is ${pr.baseRefName}, not ${config.integrationBranch}`,
      issues: [],
    }
  }
  const issues = parseIssueReferences(pr.body, config)
  return {
    ok: true,
    skipped: issues.length === 0,
    reason: issues.length === 0 ? 'No integration issue references found' : undefined,
    issues,
    comment: buildIntegrationComment({
      prNumber: pr.number,
      prUrl: pr.url,
      baseRefName: pr.baseRefName,
      mergeCommit: pr.mergeCommit,
      trunkBranch: config.trunkBranch,
    }),
    labels: config.addLabels,
    close: config.closeIntegratedIssues,
  }
}

export async function applyIntegrationPlan(plan, source) {
  const actionBoundary = { effective: 'external-action' }
  const apply = async (operation, parameters) => {
    const preview = await source.previewMutation({ operation, parameters, actionBoundary })
    const receipt = await source.applyMutation(preview, { confirm: preview.token })
    await source.flushReceipt(receipt)
  }
  for (const label of plan.labels) await apply('ensure-label', { label })
  for (const issue of plan.issues) {
    const number = issue.slice(1)
    await apply('add-comment', { number, body: plan.comment })
    await apply('add-labels', { number, labels: plan.labels })
    if (plan.close) await apply('close-artifact', { number })
  }
}

// W8g D1 — validateSourceAdapter used to have no caller anywhere in this repo's own product code
// (only lib/__tests__/modular-contracts.test.mjs exercised it as a contract-shape check). Its
// natural enforcement point is here: the moment a source adapter is resolved for use, before this
// mandatory CI entry point (.github/workflows/integration-lifecycle.yml runs this script on every
// merged PR) reads or mutates anything through it. A source adapter that violates the contract
// (missing a required capability method, an unsupported capability, ...) is refused at runtime
// instead of failing later with an unrelated "not a function" error mid-mutation.
export function resolveSource(
  repo,
  receiptStore,
  { createAdapter = createGitHubCliSourceAdapter } = {},
) {
  if (!repo) return null
  const source = createAdapter({ repo, receiptStore })
  const validation = validateSourceAdapter(source)
  if (!validation.ok) {
    throw new Error(`source adapter for ${repo} is invalid: ${validation.errors.join('; ')}`)
  }
  return source
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = loadIntegrationLifecycleConfig()
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY
  const receiptPath = args.receiptPath ?? process.env.AGENTFLOW_SOURCE_RECEIPT
  if (args.apply && !receiptPath) {
    throw new Error('Lifecycle apply requires --receipt <durable-file>')
  }
  const receiptStore = receiptPath ? createFileSourceReceiptStore(receiptPath) : null
  const source = resolveSource(repo, receiptStore)
  const pr = normalizePr(
    args.pr
      ? await source.readArtifact({ kind: 'pull-request', number: args.pr })
      : loadPrFromEvent(args.eventPath),
  )
  const plan = planIntegrationLifecycle(pr, config)
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  if (args.apply && !plan.skipped) {
    if (!source) throw new Error('GitHub repository is required for lifecycle mutation')
    await applyIntegrationPlan(plan, source)
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, '/')
const invokedDirectly = invokedPath?.endsWith('/scripts/integration-lifecycle.mjs')
if (
  !process.env.VITEST_WORKER_ID &&
  process.env.npm_lifecycle_event !== 'test' &&
  invokedDirectly &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
