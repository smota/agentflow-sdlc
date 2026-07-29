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

async function home(res, repo, session, view = 'goals', release = 'unreleased') {
  const issues = await github.issues(repo, { state: 'open', per_page: 50 })
  const board = buildGoalBoard({ issues: issues.filter((issue) => !issue.pull_request) })
  const sessionId = 'local-token'
  return html(
    res,
    renderCockpitPage({
      repo,
      repositories: config.repositories,
      view,
      user: session?.user?.login || 'token',
      csrfToken: createCsrfToken({
        sessionId,
        secret: config.sessionSecret || 'local-development-session-secret-32',
      }),
      body: renderGoalBoard(board, { repo, view, release }),
    }),
  )
}

async function issuePage(req, res, repo, number, session) {
  const [issue, comments] = await Promise.all([
    github.issue(repo, number),
    github.issueComments(repo, number),
  ])
  const view = buildCockpitIssueView({ issue, comments })
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
  const parsed = parseCockpitIntent({ ...payload, repo })
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
  if (intent.type === 'draft-follow-up') {
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
      previewSummary: intent.body.slice(0, 120),
    }),
  )
  return json(res, { ok: true, url: result.html_url })
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
