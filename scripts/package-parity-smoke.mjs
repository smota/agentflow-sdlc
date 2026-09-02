#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const scratch = mkdtempSync(join(tmpdir(), 'agentflow-package-parity-'))
const packDir = join(scratch, 'pack')
const consumer = join(scratch, 'consumer')
const target = join(scratch, 'target')
const roleTarget = join(scratch, 'role-target')
const npmCli = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find(existsSync)
if (!npmCli) throw new Error('Unable to locate the npm CLI bundled with Node')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  }
  return result.stdout
}

try {
  mkdirSync(packDir)
  mkdirSync(consumer)
  const packed = JSON.parse(
    run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', packDir], {
      cwd: root,
    }),
  )
  const tarball = join(packDir, packed[0].filename)
  run(process.execPath, [npmCli, 'init', '-y'], { cwd: consumer })
  run(
    process.execPath,
    [npmCli, 'install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: consumer,
    },
  )
  const packageRoot = join(consumer, 'node_modules', 'agentflow-sdlc')
  const installedCli = join(packageRoot, 'bin', 'cli.mjs')
  const sourceHelp = run(process.execPath, [join(root, 'bin', 'cli.mjs'), '--help'])
  const installedHelp = run(process.execPath, [installedCli, '--help'], { cwd: consumer })
  if (sourceHelp !== installedHelp) throw new Error('packed CLI help differs from source checkout')
  const roleValidation = JSON.parse(
    run(process.execPath, [installedCli, 'roles', 'validate', '--json'], { cwd: consumer }),
  )
  if (!roleValidation.ok) throw new Error('packed role catalog validation failed')
  const methodValidation = JSON.parse(
    run(process.execPath, [installedCli, 'methods', 'validate', '--json'], { cwd: consumer }),
  )
  if (!methodValidation.ok) throw new Error('packed method catalog validation failed')
  const rolePreview = JSON.parse(
    run(
      process.execPath,
      [installedCli, 'roles', 'sync', '--target', roleTarget, '--dry-run', '--json'],
      { cwd: consumer },
    ),
  )
  if (rolePreview.mode !== 'dry-run' || existsSync(roleTarget)) {
    throw new Error('packed role adapter preview wrote to the target')
  }
  const plan = JSON.parse(
    run(process.execPath, [installedCli, 'adopt', 'plan', '--target', target, '--json'], {
      cwd: consumer,
    }),
  )
  if (plan.blocked || plan.profile !== 'standard') {
    throw new Error('packed default adoption preview is not a ready standard plan')
  }
  const { applyAdoption, planAdoption } = await import(
    pathToFileURL(join(packageRoot, 'lib', 'adoption', 'transaction.mjs'))
  )
  const { resolveCompositionProfile } = await import(
    pathToFileURL(join(packageRoot, 'lib', 'adoption', 'profiles.mjs'))
  )
  const profileEntrypoints = {
    minimal: 'lib/core/execution-receipt.mjs',
    standard: 'lib/providers/registry.mjs',
    github: 'lib/sources/github.mjs',
    cockpit: 'lib/cockpit-github.mjs',
  }
  const verifiedProfiles = {}
  for (const [profile, entrypoint] of Object.entries(profileEntrypoints)) {
    const profileTarget = join(scratch, `profile-${profile}`)
    const profilePlan = planAdoption(packageRoot, profileTarget, { profile })
    if (profilePlan.blocked) throw new Error(`packed ${profile} adoption plan is blocked`)
    applyAdoption(packageRoot, profileTarget, profilePlan, { confirm: profilePlan.token })
    await import(pathToFileURL(join(profileTarget, entrypoint)))
    const selected = resolveCompositionProfile(profile).managedFiles
    for (const schema of selected.filter((path) => path.endsWith('.json'))) {
      const source = readFileSync(join(profileTarget, schema), 'utf8')
      for (const match of source.matchAll(/"\$ref"\s*:\s*"([^"]+)"/g)) {
        const reference = match[1].split('#', 1)[0]
        if (!reference || reference.includes('://')) continue
        const referenced = resolve(dirname(join(profileTarget, schema)), reference)
        if (!existsSync(referenced)) {
          throw new Error(`${profile} schema reference is missing: ${schema} -> ${reference}`)
        }
      }
    }
    verifiedProfiles[profile] = { files: selected.length, entrypoint }
  }
  const required = JSON.parse(
    readFileSync(join(root, 'manifests', 'npm-package.json'), 'utf8'),
  ).requiredFiles
  const packedPaths = new Set(packed[0].files.map((item) => item.path))
  const missing = required.filter((path) => !packedPaths.has(path))
  if (missing.length)
    throw new Error(`packed artifact misses required files: ${missing.join(', ')}`)
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        package: packed[0].filename,
        files: packed[0].files.length,
        sourceAndPackedHelpMatch: true,
        roleCatalogValid: roleValidation.ok,
        methodCatalogValid: methodValidation.ok,
        rolePreviewEntries: rolePreview.entries.length,
        defaultProfile: plan.profile,
        adoptionActions: plan.actions.length,
        verifiedProfiles,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
