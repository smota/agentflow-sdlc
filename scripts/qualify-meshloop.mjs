// Neutral fixture client: Node built-ins only, no AgentFlow or Meshloop internals.
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const knownNotice =
  'Note: worktrees are kept. `run` does not merge onto your current branch.\n' +
  'Use `meshloop accept` then `meshloop resume`, and `meshloop integrate --into` to land.\n\n'

export function parseFixtureEnvelope(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 65536) {
    throw new Error('Invalid or oversized fixture output')
  }
  const text = stdout.replace(/\r\n/g, '\n')
  const knownPrelude = text.startsWith(knownNotice)
  const value = JSON.parse(knownPrelude ? text.slice(knownNotice.length) : text)
  if (
    value?.ok !== true ||
    value.command !== 'meshloop:run' ||
    value.data?.graph_id !== 'neutral-client-fixture' ||
    value.data?.idle !== 'AwaitingHumanAcceptance'
  ) {
    throw new Error('Fixture did not reach the expected technical review boundary')
  }
  return { idle: value.data.idle, framing: knownPrelude ? 'known-notice-prefix' : 'strict-json' }
}

export function qualifyMeshloop({ binary, fixture, git }) {
  for (const file of [binary, fixture, git]) {
    if (typeof file !== 'string' || !isAbsolute(file))
      throw new Error('Absolute executable paths required')
  }
  const workspace = mkdtempSync(join(tmpdir(), 'meshloop-neutral-qualification-'))
  const systemRoot = process.env.SystemRoot
  const env = {
    PATH: [
      dirname(git),
      ...(systemRoot ? [join(systemRoot, 'System32')] : ['/usr/bin', '/bin']),
    ].join(process.platform === 'win32' ? ';' : ':'),
    HOME: workspace,
    USERPROFILE: workspace,
    TMP: workspace,
    TEMP: workspace,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(workspace, 'empty-git-config'),
    ...(systemRoot
      ? {
          SystemRoot: systemRoot,
          ComSpec: join(systemRoot, 'System32/cmd.exe'),
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
        }
      : {}),
  }
  writeFileSync(env.GIT_CONFIG_GLOBAL, '')
  const invoke = (exe, args) =>
    spawnSync(exe, args, {
      cwd: workspace,
      env,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 65536,
    })
  const gitRun = (...args) => {
    const result = invoke(git, args)
    if (result.error || result.status !== 0) throw new Error('Disposable Git fixture setup failed')
  }
  gitRun('init', '-q')
  gitRun('config', 'user.email', 'fixture@example.invalid')
  gitRun('config', 'user.name', 'Qualification Fixture')
  writeFileSync(join(workspace, 'README.md'), 'Isolated engineering fixture\n')
  gitRun('add', 'README.md')
  gitRun('commit', '-q', '-m', 'seed')
  mkdirSync(join(workspace, '.meshloop'))
  const fixtureToml = JSON.stringify(fixture.replaceAll('\\', '/'))
  writeFileSync(
    join(workspace, 'meshloop.toml'),
    `selected_harnesses = ["fixture"]
[limits]
max_concurrent_workers = 1
max_retries = 0
task_timeout_seconds = 15
[verify]
verify_command = []
[harnesses.fixture]
executable = ${fixtureToml}
version_args = ["--version"]
invoke_args_template = ["--prompt-file", "{prompt_file}"]
model_ref = "fixture-model"
model_tier = "top"
`,
  )
  writeFileSync(
    join(workspace, 'plan.json'),
    JSON.stringify({
      graph_id: 'neutral-client-fixture',
      nodes: [{ id: 1, description: 'fixture engineering operation', depends_on: [], tier: null }],
    }),
  )
  const result = invoke(binary, [
    'run',
    '--plan',
    'plan.json',
    '--accept-plan',
    '--config',
    'meshloop.toml',
    '--worktree-base',
    join(workspace, 'worktrees'),
    '--db',
    join(workspace, '.meshloop/state.sqlite'),
    '--fixture-only',
    '--json',
  ])
  let observation = null
  if (!result.error && result.status === 0) {
    try {
      observation = parseFixtureEnvelope(result.stdout)
    } catch {
      /* Report unqualified output. */
    }
  }
  const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
  return {
    workspace,
    report: {
      version: 1,
      scenario: 'meshloop-standalone-deterministic-fixture',
      passed: observation !== null,
      exitCode: result.status,
      failure: result.error ? 'process-failure' : observation ? null : 'unqualified-output',
      observation,
      binarySha256: sha256(binary),
      fixtureSha256: sha256(fixture),
      host: process.platform,
      node: process.version,
      isolation: {
        userHome: 'disposable',
        environment: 'allowlisted',
        agentflowImports: false,
        agentflowProjectConfiguration: false,
      },
      limits: { taskTimeoutSeconds: 15, commandTimeoutSeconds: 30, outputBytes: 65536, retries: 0 },
      claims: {
        liveModel: false,
        humanAcceptance: false,
        sourceBinaryEquivalence: false,
        fullIntegrationConformance: false,
      },
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
      if (!['--binary', '--fixture', '--git'].includes(args[i]) || !args[i + 1])
        throw new Error('Use --binary, --fixture and --git with absolute paths')
      options[args[i].slice(2)] = args[i + 1]
    }
    const { workspace, report } = qualifyMeshloop(options)
    process.stderr.write(`Local fixture retained at ${workspace}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = report.passed ? 0 : 1
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
