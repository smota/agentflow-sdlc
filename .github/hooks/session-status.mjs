import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const outputMode = process.argv.includes('--codex-json') ? 'codex-json' : 'plain'

const runCommand = (command, args, timeoutMs = 0) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs > 0 ? timeoutMs : undefined,
    }).trim()
  } catch {
    return ''
  }
}

const hasOpenQuestions = (text) => {
  const lines = text.split('\n')
  let inSection = false
  for (const line of lines) {
    if (/^##\s+Open questions\b/.test(line)) {
      inSection = true
      continue
    }
    if (inSection && /^#{1,2}\s/.test(line)) {
      break
    }
    if (inSection && /^- \[ \] .+/.test(line)) {
      return true
    }
  }
  return false
}

const branch = runCommand('git', ['branch', '--show-current'])
let specStatus = 'absent'
let specIssue = ''
let specHasOpenQuestions = false

if (existsSync('SPEC.md')) {
  const specContents = readFileSync('SPEC.md', 'utf8')
  const specIssueMatch =
    specContents.match(/"number"\s*:\s*([0-9]+)/) ?? specContents.match(/^# Issue #([0-9]+):/m)
  specIssue = specIssueMatch?.[1] ?? ''
  specStatus = specIssue.length > 0 ? `present (#${specIssue})` : 'present'

  let specBody = specContents
  const trimmedSpec = specContents.trim()
  if (trimmedSpec.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmedSpec)
      if (typeof parsed.body === 'string') specBody = parsed.body
    } catch {
      // not valid JSON — fall back to raw contents
    }
  }

  specHasOpenQuestions = hasOpenQuestions(specBody)
}

const statusLines = runCommand('git', ['status', '--porcelain'])
  .split('\n')
  .filter((line) => line.length > 0)
const uncommitted = statusLines.filter((line) => !line.startsWith('??')).length
const untracked = statusLines.filter((line) => line.startsWith('??')).length

let branchTag = '✗ wrong pattern'
if (/^work\/[a-z][a-z0-9-]*$/.test(branch)) {
  branchTag = '✓ (workstream)'
} else if (/^hotfix\/[a-z][a-z0-9-]*$/.test(branch)) {
  branchTag = '✓ (hotfix)'
} else if (/^spike\/[a-z][a-z0-9-]*$/.test(branch)) {
  branchTag = '✓ (spike)'
} else if (/^issue\/[0-9]+-[a-z][a-z0-9-]+$/.test(branch)) {
  branchTag = '✓ (compatibility branch)'
} else if (/^wt\/[0-9A-Za-z-]+$/.test(branch)) {
  branchTag = '✓ (agent worktree)'
} else if (branch.startsWith('claude/')) {
  branchTag = '✓ (claude session)'
} else if (['development', 'staging', 'main'].includes(branch)) {
  branchTag = '✗ trunk — run: git checkout -b work/<theme>'
}

let ghFragment = ''
let issueNum = ''

const branchIssueMatch = branch.match(/^issue\/([0-9]+)/)
if (branchIssueMatch?.[1]) {
  issueNum = branchIssueMatch[1]
} else if (specIssue.length > 0) {
  issueNum = specIssue
}

if (issueNum.length > 0) {
  const ghState = runCommand(
    'gh',
    ['issue', 'view', issueNum, '--json', 'state', '--jq', '.state'],
    2000,
  )
  if (ghState === 'CLOSED') {
    ghFragment = ` | #${issueNum}: ✅ closed`
  } else if (ghState === 'OPEN') {
    const prNum = runCommand(
      'gh',
      [
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'number',
        '--jq',
        '.[0].number // ""',
      ],
      2000,
    )
    ghFragment =
      prNum.length > 0 ? ` | #${issueNum}: 🔁 PR #${prNum} open` : ` | #${issueNum}: 🔲 open, no PR`
  }
}

const openQuestionsFragment = specHasOpenQuestions ? ' | ⚠ open questions' : ''

const statusLine = `[session-status] branch: ${branch} ${branchTag} | spec: ${specStatus} | modified/staged: ${uncommitted} | untracked: ${untracked}${ghFragment}${openQuestionsFragment}`

if (outputMode === 'codex-json') {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: statusLine,
      },
    }),
  )
} else {
  process.stdout.write(statusLine)
}
