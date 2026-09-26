#!/usr/bin/env node
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatDurableActionBody,
  parseCockpitIntent,
  evaluateGuardedAction,
} from '../lib/cockpit-actions.mjs'
import { authorizeCockpitUser, createAuditEvent } from '../lib/cockpit-auth.mjs'
import { loadCockpitConfig, validateCockpitConfig } from '../lib/cockpit-config.mjs'
import { createGitHubClient, loadRepositoryPermission } from '../lib/cockpit-github.mjs'
import { buildCockpitIssueView, buildGoalBoard } from '../lib/cockpit-read-model.mjs'
import { createGitHubRunStore } from '../lib/sources/github-run-store.mjs'
import { appendTerminalIntent, resolveAnchoredHumanGate } from '../lib/cockpit-intent-anchor.mjs'
import { goalRevision } from '../lib/core/goal-revision.mjs'
import { unitIdentity, unitRunId, resolveVerifiedRunId } from '../lib/core/unit-identity.mjs'
import { loadRunView, renderRunView } from '../lib/cockpit-run-model.mjs'
import { loadGoalStoryFromGitHub } from '../lib/cockpit-replay-github.mjs'
import {
  clearSessionCookie,
  createCsrfToken,
  createRateLimiter,
  rejectForbiddenTelemetryFields,
  secureSessionCookie,
  securityHeaders,
  verifyCsrfToken,
} from '../lib/cockpit-security.mjs'
import { renderGoalStoryMarkdown } from '../lib/cockpit-replay.mjs'
import {
  renderCockpitPage,
  renderGoalBoard,
  renderGoalStory,
  renderIssueView,
} from '../lib/cockpit-ui.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = loadCockpitConfig()
if (!config.enabled) {
  console.log('AgentFlow Cockpit disabled by COCKPIT_ENABLED=false')
  process.exit(0)
}
const validation = validateCockpitConfig(config)
if (!validation.ok) {
  console.error(
    `Cockpit config invalid:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`,
  )
  process.exit(2)
}
for (const warning of validation.warnings) console.warn(`Cockpit warning: ${warning}`)
mkdirSync(config.dataDir, { recursive: true })

const sessions = new Map()
const oauthStates = new Map()
const github = createGitHubClient({ token: config.github.token })
const rateLimit = createRateLimiter({
  limit: config.rateLimit.limit,
  windowMs: config.rateLimit.windowMs,
})

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, config.publicUrl)
    const limited = rateLimit(`${req.socket.remoteAddress || 'unknown'}:${url.pathname}`)
    if (!limited.ok) return json(res, { ok: false, errors: ['rate-limit-exceeded'] }, 429)
    if (url.pathname === '/healthz') return json(res, { ok: true })
    if (url.pathname.startsWith('/assets/cockpit/')) return asset(res, url.pathname)
    if (url.pathname === '/login') return login(req, res)
    if (url.pathname === '/oauth/callback') return oauthCallback(url, res)
    if (url.pathname === '/logout') return logout(req, res)

    const session = sessions.get(readCookie(req, 'cockpit_session'))
    if (config.remote && !session) return redirect(res, '/login')

    const repo = selectedRepository(url)
    if (!repo)
      return html(
        res,
        renderCockpitPage({
          title: 'Unknown workspace',
          repositories: config.repositories,
          body: '<section class="panel"><h1>Unknown workspace</h1><p>Select a configured repository.</p></section>',
        }),
        404,
      )
    const authz = await authorizeRequest({ session, repo })
    if (!authz.ok)
      return html(
        res,
        renderCockpitPage({
          title: 'Denied',
          body: `<section class="panel"><h1>Denied</h1><p>${authz.reasons.join(', ')}</p></section>`,
        }),
        403,
      )

    const runMatch = url.pathname.match(/^\/runs\/([a-zA-Z0-9_-]{1,100})(\.json)?$/)
    if (runMatch && req.method === 'GET') {
      const view = await loadRunView(
        createGitHubRunStore({ repo, runId: runMatch[1], client: github, boundary: 'observe' }),
      )
      return runMatch[2]
        ? json(res, view)
        : html(
            res,
            renderCockpitPage({
              repo,
              repositories: config.repositories,
              title: 'Delivery run',
              body: renderRunView(view),
            }),
          )
    }
    if (url.pathname === '/actions' && req.method === 'POST')
      return actionEndpoint(req, res, repo, session)
    if (url.pathname === '/telemetry' && req.method === 'POST')
      return telemetryEndpoint(req, res, repo, session)
    if (url.pathname === '/')
      return home(
        res,
        repo,
        session,
        url.searchParams.get('view') || 'goals',
        url.searchParams.get('release') || 'unreleased',
        url.searchParams.get('modal') || null,
        url.searchParams.get('issue') || null,
      )
    const replayMatch = url.pathname.match(/^\/issues\/(\d+)\/replay(\.md)?$/)
    if (replayMatch)
      return replayPage(res, repo, Number(replayMatch[1]), session, Boolean(replayMatch[2]))
    const issueMatch = url.pathname.match(/^\/issues\/(\d+)$/)
    if (issueMatch) return issuePage(req, res, repo, Number(issueMatch[1]), session)
    return html(
      res,
      renderCockpitPage({ body: '<section class="panel"><h1>Not found</h1></section>' }),
      404,
    )
  } catch (error) {
    console.error(error)
    return html(
      res,
      renderCockpitPage({
        body: `<section class="panel"><h1>Error</h1><p>${error.message}</p></section>`,
      }),
      500,
    )
  }
}).listen(config.port, '127.0.0.1', () => {
  console.log(`AgentFlow Cockpit listening on http://127.0.0.1:${config.port}`)
})

function selectedRepository(url) {
  const requested = url.searchParams.get('repo') || config.repositories[0]
  return config.repositories.includes(requested) ? requested : null
}

async function home(
  res,
  repo,
  session,
  view = 'goals',
  release = 'unreleased',
  modal = null,
  modalIssue = null,
) {
  const issues = await github.issues(repo, { state: 'open', per_page: 50 })
  const board = buildGoalBoard({ issues: issues.filter((issue) => !issue.pull_request), repo })
  const sessionId = 'local-token'
  const user = session?.user?.login || 'token'
  const csrfToken = createCsrfToken({
    sessionId,
    secret: config.sessionSecret || 'local-development-session-secret-32',
  })

  let modalGoal = null
  if (modal === 'gate-transition' && modalIssue) {
    modalGoal = (board.goals || []).find((g) => g.number === Number(modalIssue))
  }

  return html(
    res,
    renderCockpitPage({
      repo,
      repositories: config.repositories,
      view,
      user,
      csrfToken,
      body: renderGoalBoard(board, {
        repo,
        view,
        release,
        modal,
        modalGoal,
        user,
        csrfToken,
      }),
    }),
  )
}

async function issuePage(req, res, repo, number, session) {
  const [issue, comments] = await Promise.all([
    github.issue(repo, number),
    github.issueComments(repo, number),
  ])
  // W8c D5 — read a human's anchored close-unit decision back from the durable run store and, only
  // if the visible comment still matches it (no undetected edit), feed it into the cockpit's human
  // gate as a satisfied gate (deriveHumanGate already knows how to consume this — W8b D2). The run
  // id is derived from the SAME identity the actuator and close-unit both derive theirs from (D1),
  // so this always reads back from the run a decision on this issue was actually anchored to.
  const revision = goalRevision({
    repo,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    updatedAt: issue.updated_at,
  })
  const satisfiedGates = await resolveAnchoredHumanGate({
    client: github,
    repo,
    runId: unitRunId(unitIdentity({ repo, id: issue.number })),
    subjectDigest: revision,
    comments,
  })
  const view = buildCockpitIssueView({ issue, comments, repo, satisfiedGates })
  const sessionId = readCookie(req, 'cockpit_session') || 'local-token'
  return html(
    res,
    renderCockpitPage({
      repo,
      repositories: config.repositories,
      user: session?.user?.login || 'token',
      csrfToken: createCsrfToken({
        sessionId,
        secret: config.sessionSecret || 'local-development-session-secret-32',
      }),
      body: renderIssueView(view, { repo }),
    }),
  )
}

async function actionEndpoint(req, res, repo, session) {
  if (!config.writeActions) return json(res, { ok: false, errors: ['write-actions-disabled'] }, 403)
  const payload = await readPayload(req)
  const sessionId = readCookie(req, 'cockpit_session') || 'local-token'
  const csrf = req.headers['x-cockpit-csrf'] || payload.csrf
  if (
    !verifyCsrfToken({
      token: csrf,
      sessionId,
      secret: config.sessionSecret || 'local-development-session-secret-32',
    })
  ) {
    return json(res, { ok: false, errors: ['csrf-invalid'] }, 403)
  }
  // W8a D2 — close-unit's subjectDigest can never be trusted from the client alone: resolve the
  // real unit here, server-side, and let parseCockpitIntent refuse any claimed subjectDigest that
  // does not match it.
  //
  // W8b D4 — the real unit for a release-of-candidate close is the candidate a run actually
  // produced (lib/verification/workspace.mjs's fingerprintCandidate), never a hash of the issue's
  // own metadata (goalRevision/targetBranch/releaseImpact) standing in for it — that recipe
  // (formerly `releaseCandidateSubject`) could never match the candidate a real run built, and has
  // been deleted. The cockpit has no run-store read-back yet (W8c), so it cannot resolve a real
  // candidateDigest on its own; the caller must supply the one a completed run actually produced.
  // Absent that, there is no candidate to close against — the honest response is that the release
  // gate is still pending a candidate, not a fabricated digest standing in for one.
  let unit
  if ((payload.type || payload.intent) === 'close-unit') {
    const issueNumber = Number(payload.issue)
    if (!Number.isFinite(issueNumber)) {
      return json(res, { ok: false, errors: ['issue is required to resolve the unit'] }, 400)
    }
    const candidateDigest =
      typeof payload.candidateDigest === 'string' && /^[a-f0-9]{64}$/.test(payload.candidateDigest)
        ? payload.candidateDigest
        : null
    if (!candidateDigest) {
      return json(
        res,
        { ok: false, errors: ['release gate is pending a candidate: no candidateDigest supplied'] },
        400,
      )
    }
    unit = { candidateDigest }
  }
  const parsed = parseCockpitIntent({ ...payload, repo, unit })
  if (!parsed.ok) return json(res, parsed, 400)
  const intent = parsed.intent
  const guard = evaluateGuardedAction({
    action: intent.type,
    userRole: session?.role || 'operator',
    highAssurance: Boolean(payload.highAssurance),
    confirmation: req.headers['x-cockpit-confirm'] === 'true',
  })
  if (!guard.ok) {
    audit(
      createAuditEvent({
        actor: session?.user?.login || 'token',
        action: intent.type,
        target: `${repo}#${intent.issue}`,
        allowed: false,
        reason: guard.reasons,
      }),
    )
    return json(res, { ok: false, errors: guard.reasons }, 403)
  }

  const writeClient = session?.token ? createGitHubClient({ token: session.token }) : github
  let result
  let anchored = null
  if (intent.type === 'close-unit') {
    // The human's decision is not just a comment: it is appended to the ordered, content-addressed
    // log the product already keeps in refs/heads/agentflow-state, through the exact same store
    // (with all its guards) that observe-mode reads already trust.
    //
    // W8c D1 — DEFECT FIXED. This used to be a hand-rolled issue-hyphen-number template — a THIRD
    // spelling of unit identity, unrelated to the actuator's own readiness-hyphen-number template
    // (scripts/actuate-readiness.mjs) for the SAME unit. A human's close-unit and the gate the
    // actuator opened could never land on the same run. Both now derive their run id from the same
    // unitRunId(unitIdentity(...)) pair over the same (repo, issue number).
    //
    // W8c2 D1 — DEFECT FIXED. `payload.runId || unitRunId(...)` let a client-sent runId WIN over the
    // derived one whenever present, so a client could anchor a human's decision in any run it liked —
    // defeating the point of the fix above. resolveVerifiedRunId always derives the run id first; a
    // client-supplied runId is only ever compared against it (refused on mismatch), never preferred.
    const resolvedRunId = resolveVerifiedRunId({
      repo,
      id: intent.issue,
      requestedRunId: payload.runId ?? null,
    })
    if (!resolvedRunId.ok) return json(res, { ok: false, errors: resolvedRunId.errors }, 400)
    const runId = resolvedRunId.runId
    anchored = await appendTerminalIntent({ client: writeClient, repo, runId, intent })
    result = await writeClient.createIssueComment(
      repo,
      intent.issue,
      formatDurableActionBody(intent),
    )
  } else if (intent.type === 'draft-follow-up') {
    result = await writeClient.createIssue(repo, {
      title: payload.title || `Follow-up from #${intent.issue}`,
      body: formatDurableActionBody(intent),
      labels: ['drafted-by:pi'],
    })
  } else {
    result = await writeClient.createIssueComment(
      repo,
      intent.issue,
      formatDurableActionBody(intent),
    )
  }
  audit(
    createAuditEvent({
      actor: session?.user?.login || 'token',
      action: intent.type,
      target: `${repo}#${intent.issue}`,
      allowed: true,
      resultUrl: result.html_url,
      previewSummary: anchored ? `anchored:${anchored.event.id}` : intent.body.slice(0, 120),
    }),
  )
  return json(res, {
    ok: true,
    url: result.html_url,
    ...(anchored ? { anchoredEventId: anchored.event.id } : {}),
  })
}

async function telemetryEndpoint(req, res, repo, session) {
  if (!config.runnerTelemetry)
    return json(res, { ok: false, errors: ['runner-telemetry-disabled'] }, 403)
  const payload = await readPayload(req)
  const forbidden = rejectForbiddenTelemetryFields(payload)
  if (forbidden.length)
    return json(res, { ok: false, errors: ['forbidden-telemetry-fields'], forbidden }, 400)
  const event = {
    ...payload,
    repo,
    source: 'runner',
    receivedAt: new Date().toISOString(),
    actor: session?.user?.login || 'token',
  }
  appendFileSync(join(config.dataDir, 'runner-events.jsonl'), `${JSON.stringify(event)}\n`)
  return json(res, { ok: true })
}

async function replayPage(res, repo, number, session, markdown = false) {
  const story = await loadGoalStoryFromGitHub({ client: github, repo, issueNumber: number })
  if (markdown) return text(res, renderGoalStoryMarkdown(story), 'text/markdown; charset=utf-8')
  return html(
    res,
    renderCockpitPage({
      repo,
      repositories: config.repositories,
      user: session?.user?.login || 'token',
      body: renderGoalStory(story, { repo }),
    }),
  )
}

async function authorizeRequest({ session, repo }) {
  if (!config.remote && config.github.token) return { ok: true, reasons: [] }
  const repoPermission = await loadRepositoryPermission({ client: github, repo })
  return authorizeCockpitUser({
    user: session?.user,
    repo,
    repoPermission,
    policy: config.authPolicy,
    requiredPermission: 'read',
  })
}

function login(_req, res) {
  if (!config.github.clientId)
    return html(
      res,
      renderCockpitPage({
        body: '<section class="panel"><h1>GitHub OAuth not configured</h1></section>',
      }),
      500,
    )
  const state = randomBytes(16).toString('hex')
  oauthStates.set(state, { createdAt: Date.now() })
  const redirectUri = `${config.publicUrl.replace(/\/$/, '')}/oauth/callback`
  const target = new URL('https://github.com/login/oauth/authorize')
  target.searchParams.set('client_id', config.github.clientId)
  target.searchParams.set('redirect_uri', redirectUri)
  target.searchParams.set('scope', 'read:user read:org repo')
  target.searchParams.set('state', state)
  return redirect(res, target.toString())
}

async function oauthCallback(url, res) {
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!state || !code || !oauthStates.get(state))
    return html(
      res,
      renderCockpitPage({ body: '<section class="panel"><h1>Invalid OAuth state</h1></section>' }),
      400,
    )
  oauthStates.delete(state)
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
    }),
  })
  const tokenData = await tokenResponse.json()
  if (!tokenData.access_token)
    return html(
      res,
      renderCockpitPage({
        body: '<section class="panel"><h1>OAuth token exchange failed</h1></section>',
      }),
      401,
    )
  const client = createGitHubClient({ token: tokenData.access_token })
  const [user, orgs] = await Promise.all([client.currentUser(), client.orgs()])
  const id = randomBytes(24).toString('hex')
  sessions.set(id, {
    user: { login: user.login, orgs: orgs.map((org) => org.login) },
    token: tokenData.access_token,
  })
  res.setHeader('Set-Cookie', secureSessionCookie({ id, remote: config.remote }))
  audit(createAuditEvent({ actor: user.login, action: 'login', allowed: true }))
  return redirect(res, '/')
}

function logout(req, res) {
  sessions.delete(readCookie(req, 'cockpit_session'))
  res.setHeader('Set-Cookie', clearSessionCookie({ remote: config.remote }))
  return redirect(res, '/login')
}

function audit(event) {
  appendFileSync(join(config.dataDir, 'audit.jsonl'), `${JSON.stringify(event)}\n`)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8') || '{}'
}

async function readPayload(req) {
  const body = await readBody(req)
  const contentType = req.headers['content-type'] || ''
  if (contentType.includes('application/x-www-form-urlencoded'))
    return Object.fromEntries(new URLSearchParams(body))
  return JSON.parse(body || '{}')
}

function readCookie(req, name) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((part) => part.trim().split('=')),
  )[name]
}

function html(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    ...securityHeaders({ publicUrl: config.publicUrl }),
  })
  res.end(body)
}

function json(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders({ publicUrl: config.publicUrl }),
  })
  res.end(JSON.stringify(body))
}

function text(res, body, contentType = 'text/plain; charset=utf-8', status = 200) {
  res.writeHead(status, {
    'Content-Type': contentType,
    ...securityHeaders({ publicUrl: config.publicUrl }),
  })
  res.end(body)
}

function asset(res, pathname) {
  const relative = normalize(pathname.replace(/^\/assets\/cockpit\//, '')).replace(/^\.\.[/\\]/, '')
  const fullPath = join(packageRoot, 'assets', 'cockpit', relative)
  const type = extname(fullPath) === '.png' ? 'image/png' : 'application/octet-stream'
  try {
    res.writeHead(200, {
      'Content-Type': type,
      ...securityHeaders({ publicUrl: config.publicUrl }),
    })
    res.end(readFileSync(fullPath))
  } catch {
    return text(res, 'asset not found', 'text/plain; charset=utf-8', 404)
  }
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, ...securityHeaders({ publicUrl: config.publicUrl }) })
  res.end()
}
