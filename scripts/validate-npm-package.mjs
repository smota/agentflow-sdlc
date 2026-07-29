#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const manifest = JSON.parse(readFileSync('manifests/npm-package.json', 'utf8'))
const findings = []

if (pkg.private !== false)
  findings.push({
    severity: 'blocker',
    code: 'package.private',
    message: 'package.json private must be false',
  })
for (const field of manifest.requiredPackageFields) {
  if (pkg[field] === undefined)
    findings.push({
      severity: 'blocker',
      code: `package.${field}`,
      message: `missing package field ${field}`,
    })
}
if (!pkg.bin?.['agentflow-sdlc'])
  findings.push({ severity: 'blocker', code: 'package.bin', message: 'missing agentflow-sdlc bin' })
if (!Array.isArray(pkg.files) || !pkg.files.length)
  findings.push({ severity: 'blocker', code: 'package.files', message: 'files allowlist required' })

const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
if (pack.status !== 0) {
  findings.push({
    severity: 'blocker',
    code: 'npm.pack',
    message: pack.stderr || pack.error?.message || 'npm pack --dry-run failed',
  })
} else {
  const parsed = JSON.parse(pack.stdout)
  const data = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
  const files = new Set(data.files.map((item) => item.path))
  for (const file of manifest.requiredFiles) {
    if (!files.has(file))
      findings.push({
        severity: 'blocker',
        code: 'npm.pack.required-file',
        message: `missing from package: ${file}`,
      })
  }
  for (const file of files) {
    for (const prefix of manifest.forbiddenPathPrefixes) {
      if (file.startsWith(prefix))
        findings.push({
          severity: 'blocker',
          code: 'npm.pack.forbidden-file',
          message: `forbidden packed path: ${file}`,
        })
    }
  }
}
const ok = findings.every((item) => !['blocker', 'high'].includes(item.severity))
const report = { ok, findings }
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write('[validate-npm-package]\n')
  for (const item of findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(ok ? 0 : 1)
