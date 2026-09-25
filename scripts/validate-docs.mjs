#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POSTURES, EVIDENCE_VOCABULARY_TERMS } from '../lib/sdlc-vocabulary.mjs'

const KNOWN_CLI_COMMANDS = new Set([
  'init',
  'run',
  'doctor-env',
  'config',
  'adopt',
  'providers',
  'collaboration',
  'sdlc',
  'cockpit',
  'skills',
  'roles',
  'methods',
  'plugins',
  'settings',
  'extensions',
  'harness',
  'github',
  'onboarding-prompt',
  'release-plan',
])

function markdownFiles(root) {
  const docs = resolve(root, 'docs')
  const files = [resolve(root, 'README.md')]
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name)
      if (statSync(path).isDirectory()) visit(path)
      else if (name.endsWith('.md')) files.push(path)
    }
  }
  visit(docs)
  return files
}

function linkTarget(raw) {
  const value = raw.trim().replace(/^<|>$/g, '')
  if (!value || value.startsWith('#') || /^[a-z]+:/i.test(value)) return null
  return decodeURIComponent(value.split('#')[0].split('?')[0])
}

// W6b/D2 — ONE document is the entry path to a first governed change. It may use the nine surface
// terms freely (they are the vocabulary a newcomer needs on day one); any other product term must be
// avoided entirely or defined in plain language at its first use. This is the real doc-lint check
// called for by test 5: it can genuinely fail if an undefined term creeps back onto the entry path.
export const ENTRY_DOCUMENT = 'docs/get-started.md'
// W6c/D3 — the entry path is as short as it can honestly be, not a fixed target. The marker itself
// carries the real count so the document and the check it is linted against can never silently drift
// apart: whatever number is written here is exactly the number of lines validateDocs requires in the
// fenced block that follows it.
export const ENTRY_PATH_MARKER = '<!-- entry-path: 6 commands to a first governed change -->'

export const SURFACE_TERMS = [
  'intent',
  'run',
  'release',
  'role',
  'phase',
  'evidence',
  'gate',
  'source adapter',
  'posture',
]

// Product terms that appeared, undefined, somewhere across the five competing entry documents.
// `role-pass` is deliberately included: D2 requires it to leave the entry path entirely, not just be
// defined, so it is checked separately in validateDocs below.
export const GLOSSARY_TERMS = [
  'role-pass',
  'workflow-status comment',
  'handover',
  'transition envelope',
  'ArtifactRef',
  'composition profile',
  'lockfile',
  'collaboration mode',
  'council',
  'execution adapter',
  'seed-once',
  'receipt',
  'workflow profile',
  'bounded',
  'high-assurance',
  'self-review',
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A term counts as "defined at first use" when its first bare occurrence in prose is immediately
// followed, on the same line, by a parenthetical, dash, colon, or "means/is a/is the" explanation —
// the same pattern this document itself uses (see ENTRY_PATH_MARKER usage in get-started.md).
function definedAtFirstUse(line, matchIndex, term) {
  const after = line.slice(matchIndex + term.length)
  return /^[^a-zA-Z0-9]{0,3}(\(|—|--|:\s|,?\s*(which\s+)?means\b|is an?\b|is the\b)/i.test(after)
}

// W8e / D5 — the terms actually applied to the entry document: the hand-authored, multi-word
// phrases above PLUS the product's own evidence vocabulary (lib/sdlc-vocabulary.mjs), which is a
// real source of truth reused elsewhere rather than a second private copy validate-docs.mjs alone
// would need to remember to keep in sync. A term missing from GLOSSARY_TERMS can still be caught
// here as long as it is part of the product's own vocabulary.
export const ENTRY_PATH_TERMS = [...GLOSSARY_TERMS, ...EVIDENCE_VOCABULARY_TERMS]

export function findUndefinedTerms(markdown, terms = GLOSSARY_TERMS) {
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  const findings = []
  for (const term of terms) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
    const match = pattern.exec(prose)
    if (!match) continue
    const lineStart = prose.lastIndexOf('\n', match.index) + 1
    const lineEndIndex = prose.indexOf('\n', match.index)
    const line = prose.slice(lineStart, lineEndIndex === -1 ? prose.length : lineEndIndex)
    if (!definedAtFirstUse(line, match.index - lineStart, term)) findings.push(term)
  }
  return findings
}

// Extracts the fenced code block immediately following a marker comment, split into non-empty
// command lines. Returns null when the marker or a following fenced block is absent, so this can
// genuinely fail (test 6) rather than silently pass on any document.
export function extractMarkedCommandBlock(markdown, marker) {
  const markerIndex = markdown.indexOf(marker)
  if (markerIndex === -1) return null
  const rest = markdown.slice(markerIndex + marker.length)
  const fenceMatch = rest.match(/```[a-z]*\n([\s\S]*?)```/)
  if (!fenceMatch) return null
  return fenceMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function validateDocumentedCommands(text) {
  const errors = []
  const prefix =
    /(?:node (?:\/path\/to\/agentflow-sdlc\/)?bin\/cli\.mjs|npx(?: -y)? (?:github:smota\/agentflow-sdlc|agentflow-sdlc)|agentflow-sdlc) ([a-z][a-z-]*)/g
  for (const match of text.matchAll(prefix)) {
    if (!KNOWN_CLI_COMMANDS.has(match[1])) errors.push('unknown CLI command ' + match[1])
  }
  for (const match of text.matchAll(/--posture(?:=| +)([a-z][a-z-]*)/g)) {
    if (!POSTURES.includes(match[1])) errors.push('unknown posture ' + match[1])
  }
  for (const match of text.matchAll(/"posture"\s*:\s*"([^"<>]+)"/g)) {
    if (!POSTURES.includes(match[1])) errors.push('unknown posture ' + match[1])
  }
  return errors
}

export function validateDocs(root = process.cwd()) {
  const errors = []
  const files = markdownFiles(root)
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const relative = file.slice(resolve(root).length + 1).replaceAll('\\', '/')
    const prose = text.replace(/```[\s\S]*?```/g, '')
    const h1s = prose.match(/^# [^#].*$/gm) ?? []
    if (h1s.length !== 1 && !text.startsWith('<div align="center">')) {
      errors.push(`${relative}: expected exactly one H1, found ${h1s.length}`)
    }
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = linkTarget(match[1])
      if (target && !existsSync(resolve(dirname(file), target))) {
        errors.push(`${relative}: broken link ${match[1]}`)
      }
    }
    if (!relative.startsWith('docs/releases/') && !/^\*\*Status:\*\* Superseded/m.test(text)) {
      errors.push(...validateDocumentedCommands(text).map((error) => `${relative}: ${error}`))
    }
  }
  for (const required of [
    'docs/adopters/index.md',
    'docs/maintainers/index.md',
    'docs/providers/index.md',
    'docs/operators/index.md',
    'docs/modular-architecture.md',
  ]) {
    if (!existsSync(resolve(root, required)))
      errors.push(`missing role or architecture hub: ${required}`)
  }

  const entryPath = resolve(root, ENTRY_DOCUMENT)
  if (existsSync(entryPath)) {
    const entryText = readFileSync(entryPath, 'utf8')
    if (/role-pass/i.test(entryText)) {
      errors.push(`${ENTRY_DOCUMENT}: "role-pass" must not appear on the entry path (D2)`)
    }
    for (const term of findUndefinedTerms(entryText, ENTRY_PATH_TERMS)) {
      errors.push(`${ENTRY_DOCUMENT}: product term "${term}" is used before it is defined`)
    }
    const declaredCount = Number(ENTRY_PATH_MARKER.match(/(\d+) commands/)?.[1])
    const entryCommands = extractMarkedCommandBlock(entryText, ENTRY_PATH_MARKER)
    if (!entryCommands) {
      errors.push(`${ENTRY_DOCUMENT}: missing the runnable command path to a governed change`)
    } else if (entryCommands.length !== declaredCount) {
      // Not a fixed target: whatever count the document declares in its own marker must match the
      // block it actually ships, so the document can never silently drift from what it claims (the
      // defect this check replaces — see W6c test 5).
      errors.push(
        `${ENTRY_DOCUMENT}: entry-path declares ${declaredCount} commands but the marked block has ${entryCommands.length}`,
      )
    }
  } else {
    errors.push(`missing entry document: ${ENTRY_DOCUMENT}`)
  }

  return { ok: errors.length === 0, files: files.length, errors }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = validateDocs(resolve(process.argv[2] ?? process.cwd()))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.ok ? 0 : 1)
}
