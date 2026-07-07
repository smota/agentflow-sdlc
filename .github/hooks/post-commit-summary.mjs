import { execSync } from 'child_process'
import fs from 'fs'

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

if (payload.tool_response?.isError) {
  process.exit(0)
}

try {
  const log = execSync('git log --oneline -1', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim()
  console.log(`[committed] ${log}`)
} catch (e) {
  // Ignore
}
process.exit(0)
