import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep, parse } from 'node:path'
import {
  hashContent,
  lockfilePath,
  lockfileV2,
  readLockfile,
  serializeLockfile,
} from '../lockfile.mjs'
import { resolveCompositionProfile } from './profiles.mjs'
import { withAdoptionLock } from './operation-lock.mjs'

function slash(value) {
  return value.replaceAll('\\', '/')
}

function contained(root, target) {
  const value = relative(root, target)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

function safeRoot(targetDir) {
  const root = resolve(targetDir)
  if (existsSync(root)) {
    const info = lstatSync(root)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Adoption target root must be a regular directory, not a symlink or junction')
    }
  }
  return root
}

function safeTarget(root, relPath) {
  if (!relPath || isAbsolute(relPath)) throw new Error(`Unsafe adoption path: ${relPath}`)
  const target = resolve(root, relPath)
  if (!contained(root, target) || target === root)
    throw new Error(`Unsafe adoption path: ${relPath}`)
  let cursor = dirname(target)
  while (cursor !== root) {
    if (!contained(root, cursor)) throw new Error(`Unsafe adoption parent: ${relPath}`)
    if (existsSync(cursor)) {
      const info = lstatSync(cursor)
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Adoption parent is not a regular directory: ${relPath}`)
      }
    }
    cursor = dirname(cursor)
  }
  if (existsSync(target)) {
    const info = lstatSync(target)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Adoption target is not a regular file: ${relPath}`)
    }
  }
  return target
}

function packageIdentity(packageRoot) {
  const value = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  return { name: value.name, version: value.version }
}

function planBase(plan) {
  const { token, ...base } = plan
  return base
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const JOURNAL_NAME = '.agentflow-adoption-journal.json'
const ROLLBACK_JOURNAL_NAME = '.agentflow-rollback-journal.json'

function adoptionJournalPath(root) {
  return join(root, JOURNAL_NAME)
}

function receiptLocation(root, destination) {
  if (!destination || !isAbsolute(destination))
    throw new Error('An absolute external receipt destination is required')
  const path = resolve(destination)
  const volume = parse(path).root
  safeTarget(volume, relative(volume, path))
  return path
}

function writeJournal(root, entry, { reset = false } = {}) {
  const data = `${JSON.stringify(entry)}\n`
  if (reset) writeFileSync(adoptionJournalPath(root), data, { flag: 'wx', flush: true })
  else appendFileSync(adoptionJournalPath(root), data, { flush: true })
}

function journalMutation(mutation) {
  return {
    path: mutation.path,
    beforeContentBase64: mutation.beforeContentBase64,
    beforeHash: mutation.beforeHash,
    afterHash: mutation.afterHash,
    stagedPath: mutation.stagedPath,
    backupPath: mutation.backupPath,
    createdDirectories: mutation.createdDirectories,
  }
}

export function readAdoptionJournal(targetDir) {
  const root = safeRoot(targetDir)
  const path = adoptionJournalPath(root)
  if (!existsSync(path)) {
    const rollback = safeTarget(root, ROLLBACK_JOURNAL_NAME)
    return existsSync(rollback) ? JSON.parse(readFileSync(rollback, 'utf8')) : null
  }
  const raw = readFileSync(path, 'utf8')
  try {
    const historical = JSON.parse(raw)
    if (historical.status && historical.type !== 'header') return historical
  } catch {
    /* Current journals use framed records. */
  }
  // Each flushed record ends in a newline. An incomplete tail was never acknowledged.
  const complete = raw.endsWith('\n') ? raw : raw.slice(0, raw.lastIndexOf('\n') + 1)
  const entries = complete
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  if (entries.length === 1 && entries[0].status && entries[0].type !== 'header') return entries[0]
  const header = entries.find((entry) => entry.type === 'header')
  if (!header) throw new Error('Adoption journal header is missing')
  const { type, ...base } = header
  return {
    ...base,
    mutations: entries.filter((entry) => entry.type === 'prepared').map((entry) => entry.mutation),
    ...(entries.find((entry) => entry.type === 'receipt-ready')
      ? { receiptPath: entries.find((entry) => entry.type === 'receipt-ready').path }
      : {}),
  }
}

function targetState(target) {
  return existsSync(target)
    ? { exists: true, content: readFileSync(target) }
    : { exists: false, content: null }
}

function actionForManaged({ packageRoot, targetDir, relPath, lock, merged, removed }) {
  const source = readFileSync(join(packageRoot, relPath))
  const afterHash = hashContent(source)
  const target = safeTarget(targetDir, relPath)
  const current = targetState(target)
  const beforeHash = current.exists ? hashContent(current.content) : null
  const lockedHash = lock.files[relPath]
  let action
  if (removed.has(relPath) && !current.exists) action = 'preserve-removed'
  else if (merged.has(relPath)) action = current.exists ? 'preserve-merged' : 'preserve-removed'
  else if (!current.exists) action = lockedHash ? 'preserve-removed' : 'create'
  else if (!lockedHash) action = 'conflict'
  else if (beforeHash !== lockedHash) action = 'conflict'
  else action = beforeHash === afterHash ? 'unchanged' : 'update'
  return {
    action,
    source: relPath,
    target: relPath,
    ownership: 'managed',
    beforeHash,
    afterHash,
  }
}

function actionForSeed({ packageRoot, targetDir, entry }) {
  const source = readFileSync(join(packageRoot, entry.from))
  const afterHash = hashContent(source)
  const target = safeTarget(targetDir, entry.to)
  const current = targetState(target)
  return {
    action: current.exists ? 'seed-skip' : 'seed',
    source: entry.from,
    target: entry.to,
    ownership: 'seed-once',
    beforeHash: current.exists ? hashContent(current.content) : null,
    afterHash,
  }
}

export function planAdoption(packageRoot, targetDir, { profile, storage = 'external' } = {}) {
  if (!['external', 'project'].includes(storage))
    throw new Error('Storage must be external or project')
  const root = safeRoot(targetDir)
  if (
    existsSync(adoptionJournalPath(root)) ||
    existsSync(safeTarget(root, ROLLBACK_JOURNAL_NAME))
  ) {
    throw new Error('An unfinished adoption journal requires explicit recovery')
  }
  const selected = resolveCompositionProfile(profile)
  const lock = readLockfile(root, { strict: true })
  const merged = new Set(lock.merged)
  const removed = new Set(lock.removed)
  const actions = [
    ...selected.managedFiles.map((relPath) =>
      actionForManaged({ packageRoot, targetDir: root, relPath, lock, merged, removed }),
    ),
    ...selected.seedOnceFiles.map((entry) =>
      actionForSeed({ packageRoot, targetDir: root, entry }),
    ),
  ]
  if (
    actions.some(
      (item) =>
        item.target.startsWith('.agentflow/transactions/') ||
        item.target === '.agentflow/transactions',
    )
  )
    throw new Error('Transaction storage is reserved outside managed payload')
  let storagePlan = null
  if (storage === 'project') {
    safeTarget(root, '.agentflow/transactions/.sentinel')
    const storageIgnore = safeTarget(root, '.agentflow/transactions/.gitignore')
    if (existsSync(storageIgnore) && readFileSync(storageIgnore, 'utf8').trim() !== '*')
      throw new Error('Reserved transaction storage ignore policy conflicts')
    const ignorePath = safeTarget(root, '.gitignore')
    const prior = existsSync(ignorePath) ? readFileSync(ignorePath) : null
    const rule = '/.agentflow/transactions/'
    const present = prior?.toString('utf8').split(/\r?\n/).includes(rule)
    storagePlan = {
      mode: storage,
      ignoreBeforeHash: prior === null ? null : hashContent(prior),
      ignoreContentBase64: present
        ? null
        : Buffer.concat([
            prior ?? Buffer.alloc(0),
            Buffer.from(
              `${prior?.length && !prior.toString('utf8').endsWith('\n') ? '\n' : ''}${rule}\n`,
            ),
          ]).toString('base64'),
    }
  }
  const conflicts = actions.filter((item) => item.action === 'conflict').map((item) => item.target)
  const base = {
    version: 1,
    operation: 'adopt',
    target: slash(root),
    profile: selected.id,
    package: packageIdentity(packageRoot),
    priorLockVersion: lock.version,
    actions,
    conflicts,
    blocked: conflicts.length > 0,
    storage: storagePlan ?? { mode: 'external' },
  }
  return { ...base, token: digest(base) }
}

function missingParents(root, target) {
  const missing = []
  let cursor = dirname(target)
  while (cursor !== root) {
    if (!existsSync(cursor)) missing.push(cursor)
    cursor = dirname(cursor)
  }
  return missing.reverse()
}

function createParents(missing, createdDirectories) {
  for (const directory of missing) {
    mkdirSync(directory)
    createdDirectories.add(directory)
  }
}

function removeCreatedDirectories(root, mutations) {
  const directories = new Set(
    mutations
      .flatMap((mutation) => mutation.createdDirectories ?? [])
      .map((path) => safeTarget(root, `${path}/.sentinel`))
      .map(dirname),
  )
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(directory)
    } catch {
      // Preserve directories that contain project-owned files.
    }
  }
}

function replaceFile({
  root,
  relPath,
  content,
  mutations,
  createdDirectories,
  fault,
  onPrepared = () => {},
}) {
  const target = safeTarget(root, relPath)
  const parents = missingParents(root, target)
  const id = randomUUID()
  const staged = `${target}.agentflow-${id}.tmp`
  const backup = `${target}.agentflow-${id}.bak`
  const before = existsSync(target) ? readFileSync(target) : null
  const mutation = {
    path: relPath,
    target,
    backup: before === null ? null : backup,
    stagedPath: slash(relative(root, staged)),
    backupPath: before === null ? null : slash(relative(root, backup)),
    createdDirectories: parents.map((directory) => slash(relative(root, directory))),
    beforeContentBase64: before === null ? null : before.toString('base64'),
    beforeHash: before === null ? null : hashContent(before),
    afterHash: hashContent(content),
  }
  try {
    onPrepared(mutation)
    createParents(parents, createdDirectories)
    fault('stage.before-file', { path: relPath })
    writeFileSync(staged, content, { flag: 'wx', flush: true })
    fault('stage.after-file', { path: relPath })
    if (before !== null) renameSync(target, backup)
    fault('apply.before-replace', { path: relPath })
    renameSync(staged, target)
    mutations.push(mutation)
    fault('apply.after-replace', { path: relPath })
  } catch (error) {
    if (existsSync(staged)) unlinkSync(staged)
    if (!existsSync(target) && existsSync(backup)) renameSync(backup, target)
    throw error
  }
}

function rollbackApplied(mutations, createdDirectories) {
  for (const mutation of [...mutations].reverse()) {
    if (existsSync(mutation.target)) unlinkSync(mutation.target)
    if (mutation.backup && existsSync(mutation.backup)) renameSync(mutation.backup, mutation.target)
  }
  for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(directory)
    } catch {
      // Preserve directories that contain project-owned files.
    }
  }
}

function restoreMutationSet(root, mutations, fault = () => {}) {
  const restoration = []
  const createdDirectories = new Set()
  try {
    for (const mutation of [...mutations].reverse()) {
      const target = safeTarget(root, mutation.path)
      if (mutation.beforeContentBase64 === null) {
        const backup = `${target}.agentflow-${randomUUID()}.rollback`
        fault('rollback.before-remove', { path: mutation.path })
        renameSync(target, backup)
        restoration.push({ path: mutation.path, target, backup })
        fault('rollback.after-remove', { path: mutation.path })
      } else {
        replaceFile({
          root,
          relPath: mutation.path,
          content: Buffer.from(mutation.beforeContentBase64, 'base64'),
          mutations: restoration,
          createdDirectories,
          fault: (checkpoint, context) => fault(`rollback.${checkpoint}`, context),
        })
      }
    }
    for (const mutation of restoration) {
      if (mutation.backup && existsSync(mutation.backup)) unlinkSync(mutation.backup)
    }
  } catch (error) {
    rollbackApplied(restoration, createdDirectories)
    throw error
  }
}

function lockEntries(plan) {
  return plan.actions.map((item) => {
    const preserved = item.action === 'preserve-merged' || item.action === 'preserve-removed'
    return {
      source: item.source,
      target: item.target,
      ownership: item.ownership,
      state:
        item.action === 'preserve-merged'
          ? 'merged'
          : item.action === 'preserve-removed'
            ? 'removed'
            : 'managed',
      hash: preserved ? null : item.action === 'seed-skip' ? item.beforeHash : item.afterHash,
    }
  })
}

export function applyAdoption(
  packageRoot,
  targetDir,
  plan,
  { confirm, fault = () => {}, receiptDestination, persistReceipt } = {},
) {
  const root = safeRoot(targetDir)
  if (confirm !== plan?.token)
    throw new Error('Adoption confirmation does not match the plan token')
  if (plan.blocked) throw new Error('Adoption plan is blocked')
  if (
    planAdoption(packageRoot, root, { profile: plan.profile, storage: plan.storage?.mode })
      .token !== plan.token
  )
    throw new Error('Adoption plan is stale; generate a new preview')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return withAdoptionLock(root, () =>
    applyAdoptionUnlocked(packageRoot, root, plan, {
      confirm,
      fault,
      receiptDestination,
      persistReceipt,
    }),
  )
}

function applyAdoptionUnlocked(
  packageRoot,
  targetDir,
  plan,
  { confirm, fault = () => {}, receiptDestination, persistReceipt } = {},
) {
  if (confirm !== plan?.token)
    throw new Error('Adoption confirmation does not match the plan token')
  if (plan.blocked) throw new Error(`Adoption plan is blocked: ${plan.conflicts.join(', ')}`)
  const current = planAdoption(packageRoot, targetDir, {
    profile: plan.profile,
    storage: plan.storage?.mode,
  })
  if (current.token !== plan.token)
    throw new Error('Adoption plan is stale; generate a new preview')
  const root = safeRoot(targetDir)
  const transactionId = randomUUID()
  const receiptPath =
    plan.storage?.mode === 'project'
      ? `.agentflow/transactions/${transactionId}/receipt.json`
      : null
  const destination = receiptPath
    ? safeTarget(root, receiptPath)
    : receiptLocation(root, receiptDestination)
  if (!receiptPath && contained(root, destination))
    throw new Error('External receipt must remain outside the project')
  if (existsSync(destination)) throw new Error('Receipt destination already exists')
  const createdRoot = !existsSync(root)
  if (createdRoot) mkdirSync(root, { recursive: true })
  const mutations = []
  const createdDirectories = new Set()
  const journalBase = {
    version: 1,
    operation: 'adopt',
    target: slash(root),
    planToken: plan.token,
    profile: plan.profile,
    receiptDestination: destination,
    transactionId,
    receiptStage: `${destination}.${transactionId}.tmp`,
  }
  const journal = {
    ...journalBase,
    status: 'applying',
    mutations: [],
    recoveryToken: digest(journalBase),
  }
  const { mutations: _mutations, ...journalHeader } = journal
  writeJournal(root, { type: 'header', ...journalHeader }, { reset: true })
  const recordPrepared = (mutation) =>
    writeJournal(root, { type: 'prepared', mutation: journalMutation(mutation) })
  let receiptDurable = false
  try {
    if (plan.storage?.mode === 'project') {
      const manifestPath = safeTarget(
        root,
        `.agentflow/transactions/${transactionId}/manifest.json`,
      )
      mkdirSync(dirname(manifestPath), { recursive: true })
      const storageIgnore = safeTarget(root, '.agentflow/transactions/.gitignore')
      if (!existsSync(storageIgnore))
        writeFileSync(storageIgnore, '*\n', { flag: 'wx', flush: true })
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ version: 1, plan, recoveryToken: journal.recoveryToken })}\n`,
        { flag: 'wx', flush: true, mode: 0o600 },
      )
      fault('manifest.after-write', { path: manifestPath })
      if (plan.storage.ignoreContentBase64 !== null)
        replaceFile({
          root,
          relPath: '.gitignore',
          content: Buffer.from(plan.storage.ignoreContentBase64, 'base64'),
          mutations,
          createdDirectories,
          fault,
          onPrepared: recordPrepared,
        })
    }
    for (const item of plan.actions.filter((entry) =>
      ['create', 'update', 'seed'].includes(entry.action),
    )) {
      replaceFile({
        root,
        relPath: item.target,
        content: readFileSync(join(packageRoot, item.source)),
        mutations,
        createdDirectories,
        fault,
        onPrepared: recordPrepared,
      })
    }
    const lock = lockfileV2({
      profile: plan.profile,
      packageIdentity: plan.package,
      planToken: plan.token,
      transactionId,
      entries: lockEntries(plan),
    })
    fault('lock.before-atomic-replace', { path: 'agent-framework-lock.json' })
    replaceFile({
      root,
      relPath: 'agent-framework-lock.json',
      content: Buffer.from(serializeLockfile(lock)),
      mutations,
      createdDirectories,
      fault,
      onPrepared: recordPrepared,
    })
    fault('lock.after-atomic-replace', { path: 'agent-framework-lock.json' })
    const base = {
      version: 1,
      target: slash(root),
      profile: plan.profile,
      planToken: plan.token,
      changed: mutations.map((item) => item.path),
      mutations: mutations.map(({ target, backup, ...item }) => item),
      ...(receiptPath ? { receiptPath } : {}),
    }
    const receipt = { ...base, receiptToken: digest(base) }
    fault('receipt.before-write', {})
    if (persistReceipt) persistReceipt(receipt)
    const receiptStage = `${destination}.${transactionId}.tmp`
    writeFileSync(receiptLocation(root, receiptStage), `${JSON.stringify(receipt)}\n`, {
      flag: 'wx',
      flush: true,
      mode: 0o600,
    })
    renameSync(receiptStage, receiptLocation(root, destination))
    receiptDurable = true
    fault('receipt.after-write', {})
    for (const mutation of mutations)
      if (mutation.backup && existsSync(mutation.backup)) unlinkSync(mutation.backup)
    unlinkSync(adoptionJournalPath(root))
    return receipt
  } catch (error) {
    if (receiptDurable || existsSync(destination))
      throw new Error(
        `Adoption receipt may be durable; cleanup requires explicit recovery: ${error.message}`,
      )
    if (existsSync(journalBase.receiptStage))
      unlinkSync(receiptLocation(root, journalBase.receiptStage))
    rollbackApplied(mutations, createdDirectories)
    if (existsSync(adoptionJournalPath(root))) unlinkSync(adoptionJournalPath(root))
    if (createdRoot) {
      try {
        rmdirSync(root)
      } catch {
        // Preserve an unexpectedly non-empty target for diagnosis.
      }
    }
    throw error
  }
}

export function recoverAdoption(targetDir, { confirm } = {}) {
  const root = safeRoot(targetDir)
  return withAdoptionLock(root, () => recoverAdoptionUnlocked(root, { confirm }), {
    recovery: true,
  })
}

function recoverAdoptionUnlocked(targetDir, { confirm } = {}) {
  const root = safeRoot(targetDir)
  const journal = readAdoptionJournal(root)
  if (!journal) return { version: 1, status: 'clean' }
  if (journal.operation === 'rollback')
    return rollbackAdoptionUnlocked(root, journal.receipt, { confirm })
  const { status, mutations, recoveryToken, receiptPath, ...base } = journal
  if (
    status !== 'applying' ||
    confirm !== recoveryToken ||
    digest(base) !== recoveryToken ||
    slash(root) !== journal.target
  ) {
    throw new Error('Adoption recovery confirmation or journal digest is invalid')
  }
  const persisted =
    journal.receiptDestination ?? (receiptPath ? safeTarget(root, receiptPath) : null)
  if (persisted && existsSync(receiptLocation(root, persisted))) {
    const receipt = JSON.parse(readFileSync(receiptLocation(root, persisted), 'utf8'))
    const { receiptToken, ...receiptBase } = receipt
    if (receiptToken !== digest(receiptBase) || receipt.planToken !== journal.planToken)
      throw new Error('Durable receipt is invalid')
    for (const mutation of mutations)
      if (
        !existsSync(safeTarget(root, mutation.path)) ||
        hashContent(readFileSync(safeTarget(root, mutation.path))) !== mutation.afterHash
      )
        throw new Error(`Adoption finalization refused because ${mutation.path} drifted`)
    for (const mutation of mutations)
      for (const artifact of [mutation.stagedPath, mutation.backupPath].filter(Boolean)) {
        const path = safeTarget(root, artifact)
        if (existsSync(path)) unlinkSync(path)
      }
    if (journal.receiptStage && existsSync(journal.receiptStage))
      unlinkSync(receiptLocation(root, journal.receiptStage))
    unlinkSync(adoptionJournalPath(root))
    return { version: 1, status: 'finalized', planToken: journal.planToken, receiptPath: persisted }
  }
  const restore = []
  for (const mutation of [...mutations].reverse()) {
    const target = safeTarget(root, mutation.path)
    const current = existsSync(target) ? readFileSync(target) : null
    const currentHash = current === null ? null : hashContent(current)
    if (currentHash === mutation.afterHash) restore.push(mutation)
    else if (currentHash === mutation.beforeHash) {
      // The write-ahead entry was durable but the target mutation had not started.
    } else if (current === null && mutation.beforeContentBase64 !== null) {
      restore.push(mutation)
    } else {
      throw new Error(`Adoption recovery refused because ${mutation.path} drifted`)
    }
  }
  restoreMutationSet(root, restore)
  for (const mutation of mutations) {
    for (const artifact of [mutation.stagedPath, mutation.backupPath].filter(Boolean)) {
      const path = safeTarget(root, artifact)
      if (existsSync(path)) unlinkSync(path)
    }
  }
  removeCreatedDirectories(root, mutations)
  if (journal.receiptStage && existsSync(journal.receiptStage))
    unlinkSync(receiptLocation(root, journal.receiptStage))
  unlinkSync(adoptionJournalPath(root))
  return { version: 1, status: 'recovered', planToken: journal.planToken }
}

export function rollbackAdoption(targetDir, receipt, { confirm, fault = () => {} } = {}) {
  const root = safeRoot(targetDir)
  return withAdoptionLock(root, () => rollbackAdoptionUnlocked(root, receipt, { confirm, fault }), {
    recovery: true,
  })
}

function rollbackAdoptionUnlocked(targetDir, receipt, { confirm, fault = () => {} } = {}) {
  const { receiptToken, ...base } = receipt ?? {}
  if (confirm !== receiptToken || digest(base) !== receiptToken) {
    throw new Error('Adoption rollback confirmation or receipt digest is invalid')
  }
  const root = safeRoot(targetDir)
  if (slash(root) !== receipt.target) {
    throw new Error('Adoption rollback receipt does not match the target root')
  }
  if (existsSync(adoptionJournalPath(root)))
    throw new Error('Recover unfinished adoption before rollback')
  const journalPath = safeTarget(root, ROLLBACK_JOURNAL_NAME)
  let journal
  if (existsSync(journalPath)) {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    const { digest: expected, ...value } = journal
    if (digest(value) !== expected || journal.receipt?.receiptToken !== receiptToken)
      throw new Error('Rollback journal identity mismatch')
  } else {
    const after = {}
    for (const mutation of receipt.mutations) {
      const target = safeTarget(root, mutation.path)
      const content = existsSync(target) ? readFileSync(target) : null
      if (content === null || hashContent(content) !== mutation.afterHash)
        throw new Error(`Adoption rollback refused because ${mutation.path} drifted`)
      after[mutation.path] = content.toString('base64')
    }
    const value = { version: 1, operation: 'rollback', receipt, after, recoveryToken: receiptToken }
    journal = { ...value, digest: digest(value) }
    writeFileSync(journalPath, JSON.stringify(journal) + '\n', {
      flag: 'wx',
      flush: true,
      mode: 0o600,
    })
  }
  const stageFor = (mutation) =>
    safeTarget(root, `${mutation.path}.agentflow-rollback-${receiptToken}.tmp`)
  try {
    for (const mutation of [...receipt.mutations].reverse()) {
      const target = safeTarget(root, mutation.path)
      const currentHash = existsSync(target) ? hashContent(readFileSync(target)) : null
      if (currentHash === mutation.beforeHash) continue
      if (currentHash !== mutation.afterHash)
        throw new Error(`Adoption rollback refused because ${mutation.path} drifted`)
      fault('rollback.before-remove', { path: mutation.path })
      if (mutation.beforeContentBase64 === null) unlinkSync(target)
      else {
        const stage = stageFor(mutation)
        if (existsSync(stage)) unlinkSync(stage)
        writeFileSync(stage, Buffer.from(mutation.beforeContentBase64, 'base64'), {
          flag: 'wx',
          flush: true,
        })
        renameSync(stage, target)
      }
      fault('rollback.after-remove', { path: mutation.path })
    }
  } catch (error) {
    // Ordinary failures restore the installed state; hard interruption leaves the durable journal.
    if (!error.message.includes('drifted')) {
      for (const mutation of receipt.mutations) {
        const target = safeTarget(root, mutation.path),
          stage = stageFor(mutation)
        if (existsSync(stage)) unlinkSync(stage)
        writeFileSync(stage, Buffer.from(journal.after[mutation.path], 'base64'), {
          flag: 'wx',
          flush: true,
        })
        renameSync(stage, target)
      }
      unlinkSync(journalPath)
    }
    throw error
  }
  for (const mutation of receipt.mutations) {
    const stage = stageFor(mutation)
    if (existsSync(stage)) unlinkSync(stage)
  }
  removeCreatedDirectories(root, receipt.mutations)
  unlinkSync(journalPath)
  return { version: 1, status: 'rolled-back', planToken: receipt.planToken }
}
