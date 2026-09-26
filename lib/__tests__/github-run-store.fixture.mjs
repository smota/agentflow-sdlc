import { recordDigest } from '../core/record-digest.mjs'

export function fakeGitHub() {
  const objects = new Map(),
    refs = new Map(),
    requests = []
  let uncertain = false,
    initialized = true,
    overrideTree = null
  const put = (value) => {
    const sha = recordDigest(value)
    objects.set(sha, value)
    return { sha }
  }
  const isAncestor = (ancestor, descendant) => {
    if (ancestor === descendant) return true
    return (objects.get(descendant)?.parents ?? []).some((parent) => isAncestor(ancestor, parent))
  }
  const hooks = { beforePatch: null }
  const client = {
    async request(path, options = {}) {
      requests.push({ path, ...options })
      const tail = path.replace('/repos/test/repo', '')
      if (!options.method) {
        if (!tail) return { default_branch: 'main' }
        if (tail.startsWith('/rulesets?')) return []
        if (tail.startsWith('/actions/workflows?')) return { total_count: 0, workflows: [] }
        if (tail === '/git/ref/heads/main' && initialized) return { object: { sha: 'baseline' } }
        if (tail.startsWith('/git/ref/heads/')) {
          const sha = refs.get(tail.slice(15))
          if (!sha) throw Object.assign(new Error('not found'), { status: 404 })
          return { object: { sha } }
        }
        if (tail.startsWith('/git/commits/')) return objects.get(tail.slice(13))
        if (tail.startsWith('/git/trees/'))
          return {
            tree: overrideTree ?? objects.get(tail.slice(11).split('?')[0]).tree,
            truncated: false,
          }
        if (tail.startsWith('/git/blobs/')) {
          const blob = objects.get(tail.slice(11))
          return {
            encoding: 'base64',
            content: Buffer.from(blob.content).toString('base64'),
            size: Buffer.byteLength(blob.content),
          }
        }
      }
      const body = options.body
      if (tail === '/git/blobs') return put(body)
      if (tail === '/git/trees') return put({ tree: body.tree })
      if (tail === '/git/commits') return put({ ...body, tree: { sha: body.tree } })
      if (tail.startsWith('/git/refs')) {
        const branch = body.ref?.replace('refs/heads/', '') ?? tail.slice('/git/refs/heads/'.length)
        if (options.method === 'PATCH' && hooks.beforePatch)
          await hooks.beforePatch({ body, branch })
        const existing = refs.get(branch)
        if (
          (options.method === 'POST' && existing) ||
          (options.method === 'PATCH' &&
            (!existing || (body.force !== true && !isAncestor(existing, body.sha))))
        )
          throw Object.assign(new Error('conflict'), { status: 422 })
        refs.set(branch, body.sha)
        if (uncertain) {
          uncertain = false
          throw new Error('connection lost after success')
        }
        return { object: { sha: body.sha } }
      }
      throw new Error(`Unexpected request: ${tail}`)
    },
  }
  return {
    client,
    hooks,
    requests,
    refs,
    objects,
    set uncertain(value) {
      uncertain = value
    },
    set initialized(value) {
      initialized = value
    },
    set overrideTree(value) {
      overrideTree = value
    },
  }
}

export function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Every writer has already read and built its commit before reaching this barrier.
export function patchBarrier(fake, count = 2) {
  const arrived = deferred()
  const writes = []
  fake.hooks.beforePatch = async ({ body }) => {
    const release = deferred()
    writes.push({ body, release })
    if (writes.length === count) arrived.resolve()
    await release.promise
  }
  return { arrived: arrived.promise, writes }
}

export async function awaitPatchBarrier(barrier, attempts) {
  try {
    await Promise.race([
      barrier.arrived,
      ...attempts.map(async (attempt) => {
        await attempt
        throw new Error('Writer completed before reaching PATCH barrier')
      }),
    ])
  } catch (error) {
    for (const write of barrier.writes) write.release.resolve()
    throw error
  }
}
