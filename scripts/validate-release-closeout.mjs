#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function validateReleaseNotesPerspective(content) {
  const errors = []
  const headings = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{2,3}\s+/.test(line))

  if (
    !/\b(capabilit(?:y|ies)|workflow|update|upgrade|adopt|maintainer|project|validation|compatib|migration)\b/i.test(
      content,
    )
  ) {
    errors.push(
      'release notes must describe user-facing capabilities, upgrade value, validation, or compatibility',
    )
  }

  const issueLedHeadings = headings.filter((heading) =>
    /^#{2,3}\s+(issue|pr|#\d+|implemented issue)\b/i.test(heading),
  )
  if (issueLedHeadings.length > 0) {
    errors.push(
      `release notes headings must lead with capabilities, not issue/PR identifiers: ${issueLedHeadings.join('; ')}`,
    )
  }

  if (/^\s*-\s*(implemented|fixed|closed)\s+#\d+/im.test(content)) {
    errors.push('release notes bullets must not lead with internal-only issue completion phrasing')
  }

  return { ok: errors.length === 0, errors }
}

export function main() {
  const tag = arg('--tag')
  const target = arg('--target')
  const notes = arg('--notes')
  const json = process.argv.includes('--json')
  const errors = []
  const evidence = []

  if (!tag) errors.push('--tag <tag> is required')

  let tagCommit = null
  if (tag) {
    try {
      tagCommit = run('git', ['rev-list', '-n', '1', tag])
      evidence.push(`git tag ${tag} -> ${tagCommit}`)
    } catch {
      errors.push(`git tag not found: ${tag}`)
    }
  }

  if (target && tagCommit && target !== tagCommit) {
    errors.push(`tag ${tag} points to ${tagCommit}, expected ${target}`)
  }

  if (tag) {
    try {
      const release = JSON.parse(
        run('gh', [
          'release',
          'view',
          tag,
          '--json',
          'tagName,name,url,publishedAt,targetCommitish,isDraft,isPrerelease',
        ]),
      )
      evidence.push(`GitHub Release ${release.tagName}: ${release.url}`)
      evidence.push(`Published at: ${release.publishedAt}`)
      evidence.push(`Title: ${release.name}`)
      if (target && release.targetCommitish !== target) {
        errors.push(
          `GitHub Release target ${release.targetCommitish} does not match expected ${target}`,
        )
      }
      if (release.isDraft) errors.push(`GitHub Release ${tag} is still a draft`)
    } catch {
      errors.push(`GitHub Release not found for tag: ${tag}`)
    }
  }

  if (notes) {
    if (!existsSync(notes)) {
      errors.push(`release notes file not found: ${notes}`)
    } else {
      const perspective = validateReleaseNotesPerspective(readFileSync(notes, 'utf8'))
      if (!perspective.ok) errors.push(...perspective.errors)
      else evidence.push(`Release notes perspective check passed: ${notes}`)
    }
  }

  const result = { ok: errors.length === 0, tag, target, evidence, errors }
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else {
    process.stdout.write(`[validate-release-closeout] ${tag ?? '<missing-tag>'}\n\n`)
    for (const item of evidence) process.stdout.write(`  PASS  ${item}\n`)
    for (const error of errors) process.stdout.write(`  FAIL  ${error}\n`)
    process.stdout.write(`\nResult: ${result.ok ? 'READY' : 'FAILED'}\n`)
  }
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
