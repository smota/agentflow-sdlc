import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const hooksDir = resolve(repoRoot, '.github', 'hooks')
const codexHooksPath = resolve(repoRoot, '.codex', 'hooks.json')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env,
  }).trim()
}

function runHook(scriptName, options = {}) {
  const result = spawnSync(process.execPath, [join(hooksDir, scriptName)], {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    env: options.env,
  })

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

function createTempRepo() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ativaly-hooks-'))
  run('git', ['init', '--initial-branch=development'], { cwd: tempRoot })
  run('git', ['config', 'user.name', 'Codex'], { cwd: tempRoot })
  run('git', ['config', 'user.email', 'codex@example.com'], { cwd: tempRoot })
  writeFileSync(join(tempRoot, 'README.md'), '# temp\n')
  run('git', ['add', 'README.md'], { cwd: tempRoot })
  run('git', ['commit', '-m', 'init'], { cwd: tempRoot })
  mkdirSync(join(tempRoot, 'scripts'))
  return tempRoot
}

const tempRepo = createTempRepo()

try {
  let result = runHook('pre-commit', { cwd: tempRepo })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /direct commits to 'development'/)

  run('git', ['checkout', '-b', 'issue/1-hook-test'], { cwd: tempRepo })
  result = runHook('pre-commit', { cwd: tempRepo })
  assert.equal(result.status, 0)

  run('git', ['checkout', 'development'], { cwd: tempRepo })
  run('git', ['checkout', '-b', 'work/hook-test'], { cwd: tempRepo })
  result = runHook('pre-commit', { cwd: tempRepo })
  assert.equal(result.status, 0)

  writeFileSync(
    join(tempRepo, 'agent-workflow.config.json'),
    JSON.stringify(
      {
        branching: {
          trunk: 'production',
          releaseCandidate: 'preprod',
          integration: 'develop',
          directEditDeniedBranches: ['production', 'preprod', 'develop'],
          defaultPrTarget: 'develop',
          promotionOrder: ['develop', 'preprod', 'production'],
          workBranchPrefixes: ['task/'],
          compatibilityBranchPrefixes: ['issue/', 'wt/', 'claude/'],
          requireBoundedWorkBranch: true,
        },
      },
      null,
      2,
    ),
  )
  run('git', ['checkout', 'development'], { cwd: tempRepo })
  run('git', ['checkout', '-b', 'task/hook-test'], { cwd: tempRepo })
  result = runHook('pre-commit', { cwd: tempRepo })
  assert.equal(result.status, 0)

  writeFileSync(join(tempRepo, 'scripts', 'bad.sh'), 'echo bad\n')
  run('git', ['add', 'scripts/bad.sh'], { cwd: tempRepo })
  result = runHook('pre-commit', { cwd: tempRepo })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /scripts\/ directory/)

  result = runHook('pre-push', {
    cwd: tempRepo,
    input: 'refs/heads/issue/1-hook-test deadbeef refs/heads/production cafebabe\n',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /direct push/)

  result = runHook('check-issue-branch.mjs', { cwd: tempRepo })
  assert.equal(result.status, 0)

  run('git', ['checkout', 'development'], { cwd: tempRepo })
  result = runHook('check-issue-branch.mjs', { cwd: tempRepo })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /does not follow the required convention/)

  writeFileSync(join(tempRepo, 'SPEC.md'), '# Issue #123: temp\n')
  run('git', ['checkout', 'issue/1-hook-test'], { cwd: tempRepo })
  result = runHook('session-status.mjs', { cwd: tempRepo })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /branch: issue\/1-hook-test/)
  assert.match(result.stdout, /spec: present \(#123\)/)

  run('git', ['checkout', 'task/hook-test'], { cwd: tempRepo })
  result = runHook('session-status.mjs', { cwd: tempRepo })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /branch: task\/hook-test/)
  assert.match(result.stdout, /work branch/)

  // prettier-on-write.mjs is best-effort: it silently no-ops when prettier isn't installed in
  // the consuming project (not every project uses it). Only assert actual formatting when
  // prettier is present; otherwise just confirm the hook exits 0 without touching the file.
  const prettierAvailable = existsSync(
    resolve(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
  )
  const prettyFile = join(repoRoot, 'prettier-hook-test.ts')
  writeFileSync(prettyFile, 'export   const value={foo:"bar"}\n')
  result = runHook('prettier-on-write.mjs', {
    cwd: repoRoot,
    input: JSON.stringify({ tool_input: { file_path: prettyFile } }),
  })
  assert.equal(result.status, 0)
  if (prettierAvailable) {
    assert.match(readFileSync(prettyFile, 'utf8'), /export const value = \{ foo: 'bar' \}/)
  } else {
    assert.equal(readFileSync(prettyFile, 'utf8'), 'export   const value={foo:"bar"}\n')
  }

  result = runHook('post-checkout', {
    cwd: repoRoot,
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /\[session-status\] branch:/)

  result = runHook('post-merge', {
    cwd: repoRoot,
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /\[session-status\] branch:/)

  // .codex/hooks.json (like .claude/settings.json and .agy/settings.json) is intentionally not
  // framework-synced — see lib/framework-files.mjs's known-limitation note — so a project may not
  // have wired it yet. Only assert its contents when it exists.
  if (existsSync(codexHooksPath)) {
    const codexHooks = JSON.parse(readFileSync(codexHooksPath, 'utf8'))
    const preToolUseCommand = codexHooks.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command ?? ''
    assert.match(preToolUseCommand, /check-issue-branch\.mjs/)
    assert.doesNotMatch(preToolUseCommand, /bash -lc/)
  }
} finally {
  rmSync(tempRepo, { recursive: true, force: true })
  rmSync(join(repoRoot, 'prettier-hook-test.ts'), { force: true })
}

process.stdout.write('Hook verification passed.\n')
