import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGit } from './hook-utils.mjs'

const FORMATTED_EXTENSIONS = /\.(ts|tsx|js|jsx|json|mdx|md|css)$/

let input = ''
for await (const chunk of process.stdin) {
  input += chunk
}

if (input.trim().length === 0) {
  process.exit(0)
}

let payload
try {
  payload = JSON.parse(input)
} catch {
  process.exit(0)
}

const filePath = payload.tool_input?.file_path
if (typeof filePath !== 'string' || filePath.length === 0) {
  process.exit(0)
}

if (!existsSync(filePath) || !FORMATTED_EXTENSIONS.test(filePath)) {
  process.exit(0)
}

const root = runGit(['rev-parse', '--show-toplevel'])
if (root.length === 0) {
  process.exit(0)
}

const prettierCli = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs')
if (!existsSync(prettierCli)) {
  process.exit(0)
}

try {
  const prettier = await import('prettier')
  const source = readFileSync(filePath, 'utf8')
  const config = await prettier.resolveConfig(filePath)
  const formatted = await prettier.format(source, {
    ...config,
    filepath: filePath,
  })

  if (formatted !== source) {
    writeFileSync(filePath, formatted)
  }
} catch {
  // Formatting is best-effort and must never block the write path.
}

process.exit(0)
