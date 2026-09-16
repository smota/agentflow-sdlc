#!/usr/bin/env node
// Static reachability & enforcement audit (W7, precision pass W7b). Three detectors, no execution
// of repo modules:
//
//   A. unreachable-policy    — a boolean actionPolicy guard whose guarded action-boundary state no
//                               configured profile/path can ever reach.
//   B. off-path-enforcement  — a lib/ validator-shaped export (validate*/require*/verify*/assert*/
//                               check*) that is reachable only from non-mandatory scripts (audits,
//                               smokes, tools), never from a mandatory entry point.
//   C. optional-rigor        — declared strong/weak enforcement pairs (manifests/enforcement-pairs
//                               .json) where the strong check is not wired onto the same mandatory
//                               path as the weak one.
//
// This is static analysis only: imports are parsed with regular expressions, not an AST, and
// nothing under audit is ever imported or executed. See docs/... and scripts/audit-reachability.mjs
// tests for why: a general "is this guarded by a config lookup" detector is not feasible without
// running the code, so detector C is a declarative registry instead of an inference engine.
//
// W7b precision fixes (see spec-w7b):
//   D1 — a script path passed as a string literal to runScript(...) (bin/cli.mjs's own spawnSync
//        wrapper) is a reachability edge, just like an import. A pure import graph is blind to it,
//        which is why scripts spawned rather than imported (scripts/run-delivery.mjs, scripts/
//        role-collaboration.mjs, scripts/provider-status.mjs, ...) used to read as "off path" when
//        bin/cli.mjs actually reaches them.
//   D2 — mandatory entry points are a declared list with a one-line reason each, not a name glob:
//        bin/cli.mjs, scripts/cockpit-server.mjs (serves every cockpit request), and every script a
//        .github/workflows/*.yml invokes directly with `node scripts/....mjs` (CI blocks on them).
//   D4 — a validator-shaped export that is advisory by design (never a blocking gate) is a declared,
//        reviewed exemption with a reason, not a silent exclusion by name pattern.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, posix, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finding, report } from '../lib/sdlc-state.mjs'

const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

const VALIDATOR_NAME_RE = /^(validate|require|verify|assert|check)[A-Z]/
const EXPORT_FUNCTION_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
const IMPORT_RE = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g
// D2: `scripts/validate-*.mjs` is a real, load-bearing naming convention for standalone gate
// scripts (e.g. scripts/validate-branch-strategy.mjs) that bin/cli.mjs never spawns and no CI
// workflow invokes directly — they are just run via a `pnpm validate:*` script. Dropping this
// pattern entirely (rather than supplementing it, per D2) produced five new false positives when
// this was tried, so it stays as one of three declared sources of mandatory entries, alongside the
// explicit list and the CI-workflow scan — not the only source, which was root cause 2.
const MANDATORY_SCRIPT_RE = /^scripts\/validate-[^/]+\.mjs$/
// D1: a literal script path handed to runScript(...) (bin/cli.mjs's spawnSync wrapper) or directly
// to spawnSync/execFileSync(process.execPath, [...]). Only string literals are parsed — nothing is
// executed or dynamically resolved.
const SPAWN_EDGE_RE =
  /\brunScript\(\s*['"]([^'"]+)['"]|\b(?:spawnSync|execFileSync)\(\s*process\.execPath\s*,\s*\[\s*['"]([^'"]+)['"]/g
// D1: scripts the CLI can spawn that are read-only report/inspection tools, never a blocking gate —
// declared and reasoned, the same way detector B's exemptions are (D4), so "the CLI can reach this"
// is never silently conflated with "this is on the mandatory enforcement path".
const ADVISORY_SPAWN_TARGETS = new Map([
  [
    'scripts/sdlc-audit.mjs',
    'invoked only via `sdlc audit`; produces a report and blocks nothing — the mandatory gate for ' +
      'a role-pass is scripts/validate-sdlc-role-pass.mjs, which does not call it',
  ],
])
// D2: mandatory entry points, declared with a reason, not inferred from a filename pattern.
const DECLARED_MANDATORY_ENTRIES = [
  ['bin/cli.mjs', 'the packaged CLI entry point every adopter invocation goes through'],
  ['scripts/cockpit-server.mjs', 'serves every cockpit request'],
]
const CI_WORKFLOW_SCRIPT_RE = /\bnode\s+(scripts\/[\w.-]+\.mjs)\b/g
// D4: declared, reviewed exemptions for detector B — a validator-shaped export that is advisory by
// design. Keyed by `${module}#${exportName}` so an exemption is specific, not a name-wide pattern.
const OFF_PATH_EXEMPTIONS = new Map([
  [
    'lib/posture-check.mjs#checkPostureCapability',
    'advisory-only by design (see the file header): it never returns a pass/fail verdict and never ' +
      'gates a posture, so its absence from a mandatory enforcement path is intentional, not a gap',
  ],
])
const SCAN_ROOTS = ['lib', 'scripts', 'bin']
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__', 'fixtures', '.git'])

// ---------- filesystem / repo walking ----------

function toPosix(path) {
  return path.split('\\').join('/')
}

function listMjsFiles(root) {
  const results = []
  const walk = (absDir, relDir) => {
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      const absPath = `${absDir}/${entry.name}`
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(absPath, relPath)
      else if (entry.isFile() && entry.name.endsWith('.mjs')) results.push(relPath)
    }
  }
  for (const scanRoot of SCAN_ROOTS) {
    if (existsSync(`${root}/${scanRoot}`)) walk(`${root}/${scanRoot}`, scanRoot)
  }
  // bin/cli.mjs and top-level scripts are covered by the loop above; also pick up a bare bin/*.mjs
  // or scripts/*.mjs living directly under root without a subdirectory walk mismatch is not
  // possible here since SCAN_ROOTS already are top-level directories.
  return results
}

function readModuleSource(root, relPath) {
  const absPath = `${root}/${relPath}`
  if (!existsSync(absPath) || statSync(absPath).isDirectory()) return null
  return readFileSync(absPath, 'utf8')
}

// ---------- import / export parsing (regex-based; no AST) ----------

function parseNamedClause(clause) {
  const specifiers = []
  let rest = clause
  const namedMatch = clause.match(/\{([\s\S]*?)\}/)
  if (namedMatch) {
    for (const part of namedMatch[1].split(',')) {
      const piece = part.trim()
      if (!piece) continue
      const asMatch = piece.match(/^([\w$]+)\s+as\s+([\w$]+)$/)
      if (asMatch) specifiers.push({ imported: asMatch[1], local: asMatch[2], kind: 'named' })
      else specifiers.push({ imported: piece, local: piece, kind: 'named' })
    }
    rest = clause.slice(0, namedMatch.index) + clause.slice(namedMatch.index + namedMatch[0].length)
  }
  const nsMatch = rest.match(/\*\s+as\s+([\w$]+)/)
  if (nsMatch) specifiers.push({ imported: '*', local: nsMatch[1], kind: 'namespace' })
  const remainder = rest
    .replace(/\*\s+as\s+[\w$]+/, '')
    .replace(/,/g, ' ')
    .trim()
  if (remainder && /^[\w$]+$/.test(remainder))
    specifiers.push({ imported: 'default', local: remainder, kind: 'default' })
  return specifiers
}

export function parseImports(source) {
  const results = []
  IMPORT_RE.lastIndex = 0
  let match
  while ((match = IMPORT_RE.exec(source))) {
    const [, clause, specifierPath] = match
    results.push({
      specifiers: clause ? parseNamedClause(clause.trim()) : [],
      source: specifierPath,
    })
  }
  return results
}

export function parseExportedFunctionNames(source) {
  const names = []
  EXPORT_FUNCTION_RE.lastIndex = 0
  let match
  while ((match = EXPORT_FUNCTION_RE.exec(source))) names.push(match[1])
  return names
}

// D1: literal script-path targets of runScript(...) / spawnSync|execFileSync(process.execPath, ...)
// found in `source`. These are already repo-root-relative (that is how runScript resolves them —
// see bin/cli.mjs), so unlike an import specifier they need no resolving against the caller's
// directory. Advisory targets (declared above, with a reason) are filtered out here so callers never
// have to remember to exclude them.
export function parseSpawnEdges(source) {
  const targets = []
  SPAWN_EDGE_RE.lastIndex = 0
  let match
  while ((match = SPAWN_EDGE_RE.exec(source))) {
    const target = toPosix(match[1] ?? match[2])
    if (!ADVISORY_SPAWN_TARGETS.has(target)) targets.push(target)
  }
  return targets
}

// D2: mandatory entry points run directly by CI (`node scripts/....mjs` in a workflow's `run:`
// step). CI blocks on these, so they are as mandatory as bin/cli.mjs itself. Declared, with the
// workflow file as its own reason, rather than inferred from a naming convention.
export function scanCiWorkflowEntries(root) {
  const entries = []
  const dir = `${root}/.github/workflows`
  if (!existsSync(dir)) return entries
  let files
  try {
    files = readdirSync(dir, { withFileTypes: true })
  } catch {
    return entries
  }
  for (const file of files) {
    if (!file.isFile() || !/\.ya?ml$/.test(file.name)) continue
    let text
    try {
      text = readFileSync(`${dir}/${file.name}`, 'utf8')
    } catch {
      continue
    }
    CI_WORKFLOW_SCRIPT_RE.lastIndex = 0
    let match
    while ((match = CI_WORKFLOW_SCRIPT_RE.exec(text))) {
      entries.push([match[1], `run directly by CI workflow .github/workflows/${file.name}`])
    }
  }
  return entries
}

// D2: the full declared set of mandatory entry points for `root` — the hardcoded list, whatever CI
// invokes directly, and the scripts/validate-*.mjs gate convention — as a Map from repo-root-relative
// path to its one-line reason.
export function computeMandatoryEntries(root) {
  const entries = new Map(DECLARED_MANDATORY_ENTRIES)
  for (const [path, reason] of scanCiWorkflowEntries(root))
    if (!entries.has(path)) entries.set(path, reason)
  for (const relPath of listMjsFiles(root)) {
    if (MANDATORY_SCRIPT_RE.test(relPath) && !entries.has(relPath))
      entries.set(relPath, 'matches the scripts/validate-*.mjs gate-script naming convention')
  }
  return entries
}

// Resolves a relative import specifier written inside `fromRelPath` to a repo-root-relative path.
// Bare specifiers (node:fs, a package name, etc.) are not local modules and resolve to null.
export function resolveSpecifier(fromRelPath, specifier) {
  if (!specifier.startsWith('.')) return null
  const fromDir = posix.dirname(toPosix(fromRelPath))
  let resolved = posix.normalize(posix.join(fromDir, specifier))
  if (!/\.[cm]?js$/.test(resolved)) resolved += '.mjs'
  return resolved
}

function camelToKebab(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

// ---------- Detector A: unreachable-policy ----------

export function detectUnreachablePolicy({ root, configRelPath } = {}) {
  const findings = []
  const path =
    configRelPath ??
    (existsSync(`${root}/sdlc.config.json`) ? 'sdlc.config.json' : 'defaults/sdlc.config.json')
  const absPath = `${root}/${path}`
  if (!existsSync(absPath)) return findings
  let config
  try {
    config = JSON.parse(readFileSync(absPath, 'utf8'))
  } catch {
    return findings
  }
  const boundaries = config?.vocabulary?.actionBoundaries
  const profileMaximums = config?.actionPolicy?.profileMaximums
  if (!Array.isArray(boundaries) || !boundaries.length || !profileMaximums) return findings
  const rank = new Map(boundaries.map((state, index) => [state, index]))
  for (const [key, value] of Object.entries(config.actionPolicy ?? {})) {
    if (value !== true || !key.endsWith('RequiresHumanApproval')) continue
    const guardedState = camelToKebab(key.slice(0, -'RequiresHumanApproval'.length))
    if (!rank.has(guardedState)) continue // not this policy's vocabulary family; do not guess
    const guardedRank = rank.get(guardedState)
    const reachable = Object.values(profileMaximums).some(
      (maximum) => rank.has(maximum) && rank.get(maximum) >= guardedRank,
    )
    if (!reachable) {
      findings.push(
        finding(
          'blocker',
          'unreachable-policy',
          `actionPolicy.${key} guards action-boundary state '${guardedState}', but no ` +
            `actionPolicy.profileMaximums value reaches it — the guard can never fire`,
          {
            policyKey: `actionPolicy.${key}`,
            guardedState,
            actionBoundaries: boundaries,
            profileMaximums,
            source: path,
          },
        ),
      )
    }
  }
  return findings
}

// ---------- Detector B: off-path-enforcement ----------

function buildModuleTable(root) {
  const table = new Map()
  for (const relPath of listMjsFiles(root)) {
    const source = readModuleSource(root, relPath)
    if (source === null) continue
    table.set(relPath, {
      imports: parseImports(source),
      spawns: parseSpawnEdges(source), // D1
      exports: parseExportedFunctionNames(source),
    })
  }
  return table
}

// D1 + D2: the reachable set is everything transitively reached from a declared mandatory entry
// point by either an import edge or a spawn edge (runScript(...) / spawnSync|execFileSync(process
// .execPath, ...)). A spawn edge is followed exactly like an import edge — reachability, not "always
// executes" — with advisory report/inspection tools excluded up front by parseSpawnEdges.
function reachableModuleSet(table, mandatoryEntries) {
  const reachable = new Set(mandatoryEntries)
  const queue = [...mandatoryEntries]
  while (queue.length) {
    const current = queue.shift()
    const data = table.get(current)
    if (!data) continue
    for (const item of data.imports) {
      const resolved = resolveSpecifier(current, item.source)
      if (resolved && table.has(resolved) && !reachable.has(resolved)) {
        reachable.add(resolved)
        queue.push(resolved)
      }
    }
    for (const target of data.spawns) {
      if (table.has(target) && !reachable.has(target)) {
        reachable.add(target)
        queue.push(target)
      }
    }
  }
  return reachable
}

// Finds, among files reachable from `fromSet`, every module that imports `exportName` by name from
// `definingModule`.
function importersOf(table, definingModule, exportName, candidateFiles) {
  const importers = []
  for (const importerPath of candidateFiles) {
    const data = table.get(importerPath)
    if (!data) continue
    for (const item of data.imports) {
      const resolved = resolveSpecifier(importerPath, item.source)
      if (resolved !== definingModule) continue
      const named = item.specifiers.some(
        (specifier) => specifier.kind === 'namespace' || specifier.imported === exportName,
      )
      if (named) importers.push(importerPath)
    }
  }
  return importers
}

export function detectOffPathEnforcement({ root } = {}) {
  const findings = []
  const table = buildModuleTable(root)
  const mandatoryEntryReasons = computeMandatoryEntries(root) // D2
  const isMandatoryEntry = (relPath) => mandatoryEntryReasons.has(relPath)
  const mandatoryEntries = [...table.keys()].filter(isMandatoryEntry)
  const reachable = reachableModuleSet(table, mandatoryEntries)
  const allFiles = [...table.keys()]
  for (const [modulePath, data] of table) {
    for (const exportName of data.exports) {
      if (!VALIDATOR_NAME_RE.test(exportName)) continue
      if (OFF_PATH_EXEMPTIONS.has(`${modulePath}#${exportName}`)) continue // D4
      const onMandatoryPath = isMandatoryEntry(modulePath)
      const reachableImporters = onMandatoryPath
        ? []
        : importersOf(table, modulePath, exportName, reachable)
      if (onMandatoryPath || reachableImporters.length) continue
      const otherImporters = importersOf(table, modulePath, exportName, allFiles)
      if (otherImporters.length) {
        findings.push(
          finding(
            'high',
            'off-path-enforcement',
            `${exportName} (${modulePath}) is reachable only from non-mandatory scripts, never ` +
              `from a declared mandatory entry point (see computeMandatoryEntries)`,
            {
              symbol: exportName,
              module: modulePath,
              calledFrom: otherImporters,
              source: modulePath,
            },
          ),
        )
      }
    }
  }
  return findings
}

// ---------- Detector C: optional-rigor (declarative enforcement-pairs registry) ----------

export function loadEnforcementPairs(root, manifestRelPath = 'manifests/enforcement-pairs.json') {
  const absPath = `${root}/${manifestRelPath}`
  if (!existsSync(absPath)) return []
  const manifest = JSON.parse(readFileSync(absPath, 'utf8'))
  return manifest.pairs ?? []
}

function checkWiredImport(root, pair) {
  const weakSource = readModuleSource(root, pair.weak.module)
  if (weakSource === null) {
    return finding(
      'high',
      'optional-rigor',
      `cannot verify enforcement pair '${pair.id}': weak module ${pair.weak.module} not found`,
      { pairId: pair.id, subject: pair.subject },
    )
  }
  const imports = parseImports(weakSource)
  const wired = imports.some((item) => {
    const resolved = resolveSpecifier(pair.weak.module, item.source)
    if (resolved !== pair.strong.module) return false
    if (!pair.strong.export) return true
    return item.specifiers.some(
      (specifier) => specifier.kind === 'namespace' || specifier.imported === pair.strong.export,
    )
  })
  if (wired) return null
  return finding(
    'high',
    'optional-rigor',
    `${pair.subject}: ${pair.strong.module}${pair.strong.export ? `#${pair.strong.export}` : ''} ` +
      `is not wired into ${pair.weak.module}, which governs the same subject unconditionally`,
    { pairId: pair.id, subject: pair.subject, strong: pair.strong, weak: pair.weak },
  )
}

function checkConfigReconciliation(root, pair) {
  const bSource = readModuleSource(root, pair.b.module)
  const bLeaf = pair.b.configKey.split('.').pop()
  const stillDeclared = bSource !== null && bSource.includes(bLeaf)
  if (!stillDeclared) return null // mechanism b no longer exists: nothing left to reconcile
  const aSource = readModuleSource(root, pair.a.module)
  const aLeaf = pair.a.configKey.split('.').pop()
  const reconciled = (aSource !== null && aSource.includes(bLeaf)) || bSource.includes(aLeaf)
  if (reconciled) return null
  return finding(
    'high',
    'optional-rigor',
    `${pair.subject}: ${pair.a.configKey} (${pair.a.module}) and ${pair.b.configKey} ` +
      `(${pair.b.module}) are two unreconciled gate mechanisms for one decision`,
    { pairId: pair.id, subject: pair.subject, a: pair.a, b: pair.b },
  )
}

export function detectOptionalRigor({ root, pairs } = {}) {
  const findings = []
  const resolvedPairs = pairs ?? loadEnforcementPairs(root)
  for (const pair of resolvedPairs) {
    const result =
      pair.kind === 'config-reconciliation'
        ? checkConfigReconciliation(root, pair)
        : checkWiredImport(root, pair)
    if (result) findings.push(result)
  }
  return findings
}

// ---------- combined audit ----------

export function runAudit({ root = process.cwd() } = {}) {
  const findings = [
    ...detectUnreachablePolicy({ root }),
    ...detectOffPathEnforcement({ root }),
    ...detectOptionalRigor({ root }),
  ]
  return report(findings, 'audit-reachability')
}

// ---------- CLI ----------

const isMain = process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const targetIndex = args.indexOf('--target')
  const target = targetIndex === -1 ? packageRoot : args[targetIndex + 1]
  const result = runAudit({ root: target })
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else {
    process.stdout.write('[audit-reachability]\n')
    for (const item of result.findings)
      process.stdout.write(
        `  ${item.severity.toUpperCase()} ${item.code}: ${item.message}${item.source ? ` (${item.source})` : ''}\n`,
      )
    process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
  }
  process.exit(result.ok ? 0 : 1)
}
