import { existsSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Normalizes file paths to POSIX format, stripping machine-specific local prefixes.
 */
export function normalizePathToPosix(filePath) {
  if (typeof filePath !== 'string') return ''
  let normalized = filePath.replace(/\\/g, '/')
  // Strip Windows drive letters (e.g., C:/Users/... -> /Users/...)
  normalized = normalized.replace(/^[a-zA-Z]:\//, '/')
  // Anonymize user home paths
  normalized = normalized.replace(/\/(Users|home)\/[^/]+\//g, '~//')
  normalized = normalized.replace(/\/\//g, '/')
  return normalized
}

/**
 * Secret and PII patterns for scrubbing before remote synchronization.
 */
const SECRET_PATTERNS = [
  // GitHub Tokens
  { regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g, replacement: '[REDACTED_GH_TOKEN]' },
  // OpenAI / LLM API Keys
  { regex: /sk-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  // AWS Access Keys
  { regex: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_KEY]' },
  // Slack Tokens
  {
    regex: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  // Private Key Headers
  {
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // Bearer / Authorization headers
  { regex: /Bearer\s+[A-Za-z0-9\-_.]+/gi, replacement: 'Bearer [REDACTED_BEARER_TOKEN]' },
  // Local workstation absolute paths
  {
    regex: /[a-zA-Z]:\\(?:Users|home)\\[^\s"'<>]+/gi,
    replacement: (match) => normalizePathToPosix(match),
  },
  { regex: /\/(?:Users|home)\/[^\s"'<>]+/g, replacement: (match) => normalizePathToPosix(match) },
]

/**
 * Scrubs credentials, tokens, and local workstation paths from text.
 */
export function scrubSecretsAndPii(content) {
  if (typeof content !== 'string') return content
  let scrubbed = content
  for (const { regex, replacement } of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(regex, replacement)
  }
  return scrubbed
}

/**
 * Recursively scrubs objects, arrays, and strings.
 */
export function scrubObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return typeof obj === 'string' ? scrubSecretsAndPii(obj) : obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item))
  }
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = scrubObject(value)
  }
  return result
}

/**
 * Detects and removes stale .git/index.lock files left by previous crashed processes.
 */
export function cleanupGitLocks({ repoDir = process.cwd(), maxAgeMs = 5000 } = {}) {
  const lockPath = join(repoDir, '.git', 'index.lock')
  if (!existsSync(lockPath)) {
    return { cleaned: false, reason: 'no_lock_found' }
  }

  try {
    const stats = statSync(lockPath)
    const ageMs = Date.now() - stats.mtimeMs
    if (maxAgeMs <= 0 || ageMs >= maxAgeMs) {
      unlinkSync(lockPath)
      return { cleaned: true, lockPath, ageMs, reason: 'stale_lock_removed' }
    }
    return { cleaned: false, lockPath, ageMs, reason: 'lock_active_or_fresh' }
  } catch (err) {
    return { cleaned: false, error: err.message }
  }
}

/**
 * Compresses context payload to ensure it stays within <= 15% budget.
 * Default token budget: 15,000 tokens (approx 60,000 chars).
 */
export function compressContextPayload(payload, { maxTokens = 15000, maxChars = 60000 } = {}) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  if (serialized.length <= maxChars) {
    return {
      payload: typeof payload === 'string' ? scrubSecretsAndPii(payload) : scrubObject(payload),
      compressed: false,
      charCount: serialized.length,
      estimatedTokens: Math.ceil(serialized.length / 4),
    }
  }

  // If payload is an object with uncommittedChanges or diffs, prune lengthy diffs and items
  if (typeof payload === 'object' && payload !== null) {
    const pruned = { ...payload }
    if (pruned.debugLogs && typeof pruned.debugLogs === 'string') {
      pruned.debugLogs = pruned.debugLogs.slice(-1000)
    }
    if (pruned.uncommittedChanges && Array.isArray(pruned.uncommittedChanges)) {
      const maxItems = Math.max(3, Math.min(10, Math.floor(maxChars / 800)))
      const kept = pruned.uncommittedChanges.slice(0, maxItems).map((change) => ({
        file: normalizePathToPosix(change.file || change.path),
        status: change.status,
        diffSummary:
          (change.diff || '').slice(0, 200) +
          (change.diff && change.diff.length > 200 ? '... [diff truncated]' : ''),
      }))
      if (pruned.uncommittedChanges.length > maxItems) {
        kept.push({
          notice: `... and ${pruned.uncommittedChanges.length - maxItems} more files truncated`,
        })
      }
      pruned.uncommittedChanges = kept
    }

    let reSerialized = JSON.stringify(pruned, null, 2)
    if (reSerialized.length > maxChars) {
      reSerialized =
        reSerialized.slice(0, maxChars) + '\n... [payload truncated to fit context budget]'
      return {
        payload: scrubSecretsAndPii(reSerialized),
        compressed: true,
        charCount: reSerialized.length,
        estimatedTokens: Math.ceil(reSerialized.length / 4),
      }
    }

    return {
      payload: scrubObject(pruned),
      compressed: true,
      charCount: reSerialized.length,
      estimatedTokens: Math.ceil(reSerialized.length / 4),
    }
  }

  // Fallback string truncation
  const truncated =
    serialized.slice(0, maxChars) + '\n... [payload truncated to fit context budget]'
  return {
    payload: scrubSecretsAndPii(truncated),
    compressed: true,
    charCount: truncated.length,
    estimatedTokens: Math.ceil(truncated.length / 4),
  }
}
