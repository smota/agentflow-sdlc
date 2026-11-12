// Source adapter registry (#582). The one place that turns a configured source
// (`adapters.openrig.bridge.source`) into a SourceAdapter, so callers such as the rig bridge stay
// free of any particular source system. Adding a source system means adding a factory here.
import { resolve } from 'node:path'
import { createFilesystemSourceAdapter } from './filesystem-source.mjs'
import { createGitHubSourceAdapter } from './github.mjs'
import { resolveGitHubToken } from './github-credential.mjs'

export const DEFAULT_FILESYSTEM_SOURCE_ROOT = '.agentflow/source'
export const DEFAULT_SOURCE_WRITER = 'agentflow-bridge'

function claimWriters(source, writer) {
  return Array.isArray(source.claimWriters) && source.claimWriters.length
    ? [...source.claimWriters]
    : [writer]
}

const FACTORIES = {
  filesystem(source, { targetDir }) {
    const writer = source.writer ?? DEFAULT_SOURCE_WRITER
    return createFilesystemSourceAdapter({
      root: resolve(targetDir, source.root ?? DEFAULT_FILESYSTEM_SOURCE_ROOT),
      writer,
      trustedWriters: claimWriters(source, writer),
    })
  },
  github(source, { env }) {
    const token = resolveGitHubToken({ env })
    return createGitHubSourceAdapter({
      repo: source.repo,
      token,
      claimWriters: source.claimWriters ?? [],
      mirrorAssignee: source.mirrorAssignee ?? null,
    })
  },
}

export function registeredSourceAdapters() {
  return Object.keys(FACTORIES)
}

export function createSourceAdapter(source, { targetDir = process.cwd(), env = process.env } = {}) {
  const name = source?.adapter
  const factory = Object.hasOwn(FACTORIES, name ?? '') ? FACTORIES[name] : null
  if (!factory) {
    throw new Error(
      `unknown source adapter ${name ?? '(none)'}; registered: ${registeredSourceAdapters().join(', ')}`,
    )
  }
  return factory(source, { targetDir, env })
}
