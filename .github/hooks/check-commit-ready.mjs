import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

let input = ''
try {
  input = fs.readFileSync(0, 'utf-8')
} catch (e) {
  process.exit(0)
}

if (!input) process.exit(0)

let payload
try {
  payload = JSON.parse(input)
} catch (e) {
  process.exit(0)
}

const command = payload.tool_input?.command || ''
if (!/^\s*git\s+commit/.test(command)) {
  process.exit(0)
}

try {
  const root = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim()
  if (!root) process.exit(0)

  const stagedStr = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const stagedFiles = stagedStr.split('\n').filter((f) => /\.(ts|tsx)$/.test(f))

  if (stagedFiles.length === 0) process.exit(0)

  const pkgs = new Set()
  for (const file of stagedFiles) {
    // Standardize to forward slash
    const normalizedFile = file.replace(/\\/g, '/')
    const parts = normalizedFile.split('/')
    if (parts.length >= 2) {
      pkgs.add(`${parts[0]}/${parts[1]}`)
    }
  }

  let failed = false
  for (const pkg of pkgs) {
    const tsconfigPath = path.join(root, pkg, 'tsconfig.json')
    if (fs.existsSync(tsconfigPath)) {
      try {
        execSync(`pnpm --filter "./${pkg}" exec tsc --noEmit`, { stdio: 'inherit', cwd: root })
      } catch (err) {
        failed = true
      }
    }
  }

  if (failed) {
    console.error('\nTypeScript errors found. Fix type errors before committing.')
    process.exit(1)
  }
} catch (e) {
  // Ignore git or exec errors
}
process.exit(0)
