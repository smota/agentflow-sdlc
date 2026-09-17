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
// D4 (W7b) / W8d D2: declared, reviewed exemptions for detector B — a validator-shaped export, or a
// lib/core//lib/verification export of any name, that is intentional public API with no internal
// caller. Keyed by `${module}#${exportName}` so an exemption is specific, never a name-wide pattern.
// Each reason was checked against the actual repository (usage, docs, and tests), not assumed — see
// the W8d spec report for how each was verified. This is a declared, reviewed list, not a way to
// reach zero findings: a real control with no caller belongs in the finding list, not here.
const OFF_PATH_EXEMPTIONS = new Map([
  [
    'lib/posture-check.mjs#checkPostureCapability',
    'advisory-only by design (see the file header): it never returns a pass/fail verdict and never ' +
      'gates a posture, so its absence from a mandatory enforcement path is intentional, not a gap',
  ],
  // The lib/core/{delivery-policy,execution-intent}.mjs contract layer (docs/modular-architecture.md:
  // "implementations live under lib/core/ ... higher-level domain modules compose those contracts")
  // is this package's own published SDK surface (package.json: "roles, evidence, validators,
  // skills, adapters ... for AI-assisted software delivery"). These specific exports are
  // contract-shape validators or constructors with no caller inside THIS repository's own product
  // entry points; each is exercised by lib/__tests__/modular-contracts.test.mjs (or the file named
  // below) as a conformance check for concrete implementations, not as a live runtime gate this
  // repo enforces on itself.
  //
  // W8g D1 — REMOVED: validateCollaborationIntent, validateProviderBinding, and
  // validateSourceAdapter used to be exempted here with the same "contract-shape validator, no
  // product caller" reasoning. That reasoning was wrong: each one enforces an invariant a real
  // product path can actually violate, and none of the three had ever been wired to run on one.
  // They are now:
  //   - validateCollaborationIntent: called inside createCollaborationIntent
  //     (lib/core/collaboration-intent.mjs) — the one place a CollaborationIntent record is
  //     composed, reachable via lib/collaboration-plan.mjs on the mandatory bin/cli.mjs path.
  //   - validateProviderBinding: called inside bindProvider (lib/core/provider-binding.mjs) — the
  //     one place a ProviderBinding record is composed, same mandatory path.
  //   - validateSourceAdapter: called by scripts/integration-lifecycle.mjs's resolveSource, right
  //     where a source adapter is resolved for use — that script is run directly by
  //     .github/workflows/integration-lifecycle.yml on every merged PR (a declared mandatory entry
  //     via scanCiWorkflowEntries).
  // Removing the exemption without wiring a caller would have surfaced all three as findings; see
  // the W8g spec report for the enforcement point each one now has.
  [
    'lib/core/delivery-policy.mjs#normalizeUsage',
    'usage-measurement normalizer for the budget contract; the enforcement it would feed, ' +
      "budgetAdmission, already fails closed when usage is unknown (see budgetAdmission's `known` " +
      'check), so its absence is an unwired feature, not a bypassed control — exercised by ' +
      'lib/__tests__/delivery-policy.test.mjs',
  ],
  [
    'lib/core/delivery-policy.mjs#resolveLifecycle',
    'documented host-facing operational API (docs/run-operations.md: "Feed re-resolved observations ' +
      'into `resolveLifecycle` separately from numbered role completion"), called by an adopter\'s ' +
      'own release automation, not by this repo',
  ],
  [
    'lib/core/execution-intent.mjs#normalizeIntentRequirement',
    'invoked as `requirements.map(normalizeIntentRequirement)` in the same module ' +
      '(createExecutionIntent) — a callback reference, which this regex-based, static-analysis-only ' +
      'audit cannot confirm executes (see the file header); read and verified by hand',
  ],
  [
    'lib/core/posture.mjs#posturesList',
    'read-only accessor that enumerates configured postures (for a future UI/CLI listing); not a ' +
      'control itself and nothing in this repo currently needs to enumerate postures',
  ],
  [
    'lib/core/review-attestation.mjs#computeReviewDigest',
    'human-facing CLI helper (scripts/review-digest.mjs) a reviewer runs by hand to reproduce the ' +
      'digest they must attest to; the actual enforcement (the digest matching what satisfyGate ' +
      'checks) is in lib/core/gate.mjs, already wired',
  ],
  [
    'lib/core/review-attestation.mjs#createReviewAttestation',
    'public constructor for building a well-formed attestation payload; the control that decides ' +
      'whether an attestation is accepted is validateReviewAttestation/satisfyGate, both already ' +
      'wired via lib/core/gate.mjs — this only builds the input, it decides nothing',
  ],
  [
    'lib/core/role-collaboration.mjs#createReworkRequest',
    'constructor for a rework-request record (companion to the create* family scripts/' +
      'role-collaboration-smoke.mjs already exercises); the phase-advancement gate that reads ' +
      'openReworkRequests is enforced elsewhere in this file — this only builds the record',
  ],
  // lib/verification/{github-checks,lifecycle-observer}.mjs: explicitly documented in
  // docs/run-operations.md as functions a HOST calls from their own CI/deployment automation to
  // observe events (a GitHub check run, a merge/tag/release, a deployment, a rollback) that this
  // repository has no automation of its own to produce — there is nothing here for them to be wired
  // to. "Hosts can use `collectGitHubCheck` and `resolveGitHubCheck` for exact commit/check/app
  // observations. `observeGitHubLifecycle` resolves merge, tag and release identity. Deployment and
  // exercised rollback use `observeDeployment` and `observeRollback` ..." (docs/run-operations.md).
  [
    'lib/verification/github-checks.mjs#collectGitHubCheck',
    'documented host-facing API (docs/run-operations.md) for observing a GitHub check run produced ' +
      "by the adopter's own CI; this repo owns no such check run to wire it to",
  ],
  [
    'lib/verification/github-checks.mjs#resolveGitHubCheck',
    'documented host-facing API (docs/run-operations.md), re-verifies a previously-collected GitHub ' +
      "check from the adopter's own CI",
  ],
  [
    'lib/verification/lifecycle-observer.mjs#observeGitHubLifecycle',
    "documented host-facing API (docs/run-operations.md) for observing the adopter's own merge/tag/" +
      'release; this repo has no merge/tag/release automation of its own to wire it to',
  ],
  [
    'lib/verification/lifecycle-observer.mjs#observeRollback',
    "documented host-facing API (docs/run-operations.md) against the adopter's own rollback " +
      'provider; this repo has no deployment or rollback automation of its own',
  ],
  [
    'lib/verification/lifecycle-observer.mjs#observeDeployment',
    "documented host-facing API (docs/run-operations.md) against the adopter's own deployment " +
      'provider; this repo has no deployment automation of its own',
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

// W8g D2 — REMOVED: this module used to also walk the `pnpm validate:release` script chain
// (package.json) and treat every `node scripts/....mjs` it bottomed out in as a mandatory entry
// point, on the theory that CI blocks on that chain exactly like a workflow's `run:` step. That
// reasoning proved wrong: `validate:release` also runs THIS REPOSITORY'S OWN smoke tests
// (scripts/sdlc-sandbox-smoke.mjs, scripts/cockpit-smoke.mjs, scripts/validate-npm-package.mjs,
// scripts/package-parity-smoke.mjs, scripts/role-collaboration-smoke.mjs, ...) — framework self-
// tests that validate THIS repo in its own CI, not a path any adopter's product ever runs. A
// control reached only through one of those protects no adopter; counting them as mandatory made
// such a control look enforced when it was not. Product entry points remain: bin/cli.mjs (and
// scripts it spawns via runScript(...)/spawnSync/execFileSync — see the D1 spawn-edge parsing
// above), scripts/cockpit-server.mjs, whatever a CI workflow's `run:` step invokes directly
// (scanCiWorkflowEntries), and the scripts/validate-*.mjs gate-script naming convention below.

// D2: the full declared set of mandatory entry points for `root` — the hardcoded list, whatever CI
// invokes directly, and the scripts/validate-*.mjs gate convention — as a Map from repo-root-
// relative path to its one-line reason.
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

// ---------- invocation detection (W8d D1 — an import that is never called is not reachability) ----------

// Strips block comments and line comments down to same-length blanks so a later call-syntax scan is
// not fooled by an identifier merely mentioned in a comment. Comments are safe to strip with a
// regex — `/* */` does not nest and `//` is bounded by the end of the line. String and template
// literals are deliberately NOT stripped: a template literal can nest arbitrarily
// (`` `${a(`${b}`)}` ``), and a regex that does not actually parse cannot pair those backticks
// correctly — an earlier version of this function tried, mismatched a nested template's backticks,
// and silently ate real code between two unrelated backticks later in the file, which is far worse
// than the false positive this guards against (an identifier name followed by `(` inside a string
// literal, coincidentally read as a call). No parser dependency (see the file header), so this is
// the safe side of that trade-off.
function stripNoiseForInvocation(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// W8d D1: a symbol is REACHED only if the importing module actually CALLS it — `localName(` for a
// named/default import, or `namespaceLocal.exportName(` for a namespace import — as call syntax in
// the cleaned source. An import that is never referenced this way (a dead import, or a bare
// `void localName` with no parentheses, which discards the reference without ever invoking it) is
// not an edge: the module was imported, not called. This is the fix for the W7/W7b hole where adding
// `import { validateX as _unused }` to a mandatory module made an off-path finding disappear even
// though nothing in that module ever called validateX.
export function isInvoked(source, expression) {
  const cleaned = stripNoiseForInvocation(source)
  // A function's own declaration — `function name(`, `export function name(`, `export async
  // function name(`, `function* name(` — matches `name\s*\(` exactly like a call would. Left
  // unhandled, checking a module's source for whether it invokes one of its OWN exports would
  // always read "yes" from the declaration line alone, even when nothing ever calls it. Blank the
  // declaration header out (same-length spaces, so nothing else shifts) before looking for a call.
  const declarationRe = new RegExp(
    `\\bfunction\\s*\\*?\\s+${escapeForRegExp(expression)}\\s*\\(`,
    'g',
  )
  const withoutDeclaration = cleaned.replace(declarationRe, (match) => ' '.repeat(match.length))
  // A lookbehind that simply rejects "preceded by a dot" would also reject a spread call
  // (`...expression(...)`), whose last character before the identifier is ALSO a dot — spread and
  // member access cannot be told apart by a single preceding character. So this walks each raw
  // `expression(` match by hand: a preceding word/`$` character means it is a suffix of a longer
  // identifier (reject); a preceding single/double dot means member access on some other object,
  // e.g. `obj.expression(` (reject, not a call to the bare imported binding); a preceding `...`
  // (spread) or anything else (whitespace, `(`, `,`, `=`, start of file, ...) is a genuine call.
  const callRe = new RegExp(`${escapeForRegExp(expression)}\\s*\\(`, 'g')
  let match
  while ((match = callRe.exec(withoutDeclaration))) {
    const start = match.index
    const precedingChar = withoutDeclaration[start - 1]
    if (precedingChar !== undefined && /[\w$]/.test(precedingChar)) continue
    if (precedingChar === '.' && withoutDeclaration.slice(Math.max(0, start - 3), start) !== '...')
      continue
    return true
  }
  return false
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
      spawns: parseSpawnEdges(source), // D1 (spawn edges)
      exports: parseExportedFunctionNames(source),
      source, // W8d D1: needed to check whether an imported symbol is actually INVOKED, not just imported
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

// Finds, among `candidateFiles`, every module that both imports `exportName` (by name, or via a
// namespace import) from `definingModule` AND actually INVOKES it (W8d D1) — call syntax on the
// local binding (or, for a namespace import, on `nsLocal.exportName`), not merely a reference to it.
function importersOf(table, definingModule, exportName, candidateFiles) {
  const importers = []
  for (const importerPath of candidateFiles) {
    const data = table.get(importerPath)
    if (!data) continue
    let qualifies = false
    for (const item of data.imports) {
      if (qualifies) break
      const resolved = resolveSpecifier(importerPath, item.source)
      if (resolved !== definingModule) continue
      for (const specifier of item.specifiers) {
        const isNamespace = specifier.kind === 'namespace'
        const isNamed = !isNamespace && specifier.imported === exportName
        if (!isNamespace && !isNamed) continue
        const expression = isNamespace ? `${specifier.local}.${exportName}` : specifier.local
        if (isInvoked(data.source, expression)) {
          qualifies = true
          break
        }
      }
    }
    if (qualifies) importers.push(importerPath)
  }
  return importers
}

// W8d D2: in addition to the validate|require|verify|assert|check naming convention, an exported
// function from lib/core/ or lib/verification/ is a control-shaped export by LOCATION — these are
// the two directories the product's own comments call out as the trust boundary. Flagging every
// export of every lib/ file by this rule would be far too broad (most of lib/ is ordinary
// application code); lib/core/ and lib/verification/ are where "should something be enforcing this
// and isn't" is actually a meaningful question to ask, per file, of every export — not just the ones
// that happen to be named like a validator.
const CORE_API_PREFIXES = ['lib/core/', 'lib/verification/']
function isCoreApiModule(modulePath) {
  return CORE_API_PREFIXES.some((prefix) => modulePath.startsWith(prefix))
}

// W8d D2: a module's own OTHER exports can call `exportName` directly, with no import edge at all —
// the audit has no interprocedural call graph (static analysis only, no parser — see the file
// header), so it cannot confirm that specific caller is itself reached. What it CAN check without
// one: is `exportName` invoked anywhere in its own defining module's source, and is that module
// itself reachable (some mandatory-path chain imports or spawns it) — i.e., the module's code runs
// at all when a mandatory entry point executes. Requiring both sides keeps this from being a rubber
// stamp: an unreachable module gets no benefit from calling its own exports, and a reachable module
// that never calls `exportName` anywhere in its own text still gets flagged.
function isSelfInvokedOnReachablePath(reachable, modulePath, data, exportName) {
  return reachable.has(modulePath) && isInvoked(data.source, exportName)
}

export function detectOffPathEnforcement({ root } = {}) {
  const findings = []
  const table = buildModuleTable(root)
  const mandatoryEntryReasons = computeMandatoryEntries(root) // D2 (W7b)
  const isMandatoryEntry = (relPath) => mandatoryEntryReasons.has(relPath)
  const mandatoryEntries = [...table.keys()].filter(isMandatoryEntry)
  const reachable = reachableModuleSet(table, mandatoryEntries)
  const allFiles = [...table.keys()]
  for (const [modulePath, data] of table) {
    for (const exportName of data.exports) {
      const isValidatorShaped = VALIDATOR_NAME_RE.test(exportName)
      const isCoreApi = isCoreApiModule(modulePath) // W8d D2
      if (!isValidatorShaped && !isCoreApi) continue
      if (OFF_PATH_EXEMPTIONS.has(`${modulePath}#${exportName}`)) continue // D4 (W7b) / W8d D2
      const onMandatoryPath = isMandatoryEntry(modulePath)
      if (onMandatoryPath) continue
      const reachableImporters = importersOf(table, modulePath, exportName, reachable)
      if (reachableImporters.length) continue
      if (isSelfInvokedOnReachablePath(reachable, modulePath, data, exportName)) continue
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
      } else if (isCoreApi) {
        // W8d D2: nothing anywhere in the scanned tree ever calls this lib/core or lib/verification
        // export, and no declared exemption says that is intentional. Either it is genuinely unused
        // (dead code, or an intentional public API that belongs in OFF_PATH_EXEMPTIONS with a
        // reason), or something was meant to call it and does not — the audit cannot tell those
        // apart, so it reports the fact rather than guessing.
        findings.push(
          finding(
            'high',
            'off-path-enforcement',
            `${exportName} (${modulePath}) is an exported lib/core or lib/verification function ` +
              `with no invoking caller anywhere in the scanned tree, and no declared exemption in ` +
              `OFF_PATH_EXEMPTIONS`,
            {
              symbol: exportName,
              module: modulePath,
              calledFrom: [],
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
