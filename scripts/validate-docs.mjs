#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KNOWN_CLI_COMMANDS = new Set([
  'doctor-env',
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
      for (const match of text.matchAll(
        /node (?:\/path\/to\/agentflow-sdlc\/)?bin\/cli\.mjs ([a-z][a-z-]*)/g,
      )) {
        if (!KNOWN_CLI_COMMANDS.has(match[1])) {
          errors.push(`${relative}: unknown CLI command ${match[1]}`)
        }
      }
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
  return { ok: errors.length === 0, files: files.length, errors }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = validateDocs(resolve(process.argv[2] ?? process.cwd()))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.ok ? 0 : 1)
}
