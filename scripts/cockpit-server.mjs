#!/usr/bin/env node
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { authorizeCockpitUser, createAuditEvent } from '../lib/cockpit-auth.mjs'
import { loadCockpitConfig, validateCockpitConfig } from '../lib/cockpit-config.mjs'
import { createGitHubClient, loadRepositoryPermission } from '../lib/cockpit-github.mjs'
import { buildCockpitIssueView, buildGoalBoard } from '../lib/cockpit-read-model.mjs'
import { renderCockpitPage, renderGoalBoard, renderIssueView } from '../lib/cockpit-ui.mjs'

const config = loadCockpitConfig()
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
const github = createGitHubClient({ token: config.github.token })

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, config.publicUrl)
    if (url.pathname === '/healthz') return json(res, { ok: true })
    if (url.pathname === '/login') return login(req, res)
    if (url.pathname === '/oauth/callback') return oauthCallback(url, res)
    if (url.pathname === '/logout') return logout(req, res)

    const session = sessions.get(readCookie(req, 'cockpit_session'))
    if (config.remote && !session) return redirect(res, '/login')

    const repo = url.searchParams.get('repo') || config.repositories[0]
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

    if (url.pathname === '/') return home(res, repo, session)
    const issueMatch = url.pathname.match(/^\/issues\/(\d+)$/)
    if (issueMatch) return issuePage(res, repo, Number(issueMatch[1]), session)
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

async function home(res, repo, session) {
  const issues = await github.issues(repo, { state: 'open', per_page: 50 })
  const board = buildGoalBoard({ issues: issues.filter((issue) => !issue.pull_request) })
  return html(
    res,
    renderCockpitPage({
      repo,
      user: session?.user?.login || 'token',
      body: renderGoalBoard(board),
    }),
  )
}

async function issuePage(res, repo, number, session) {
  const [issue, comments] = await Promise.all([
    github.issue(repo, number),
    github.issueComments(repo, number),
  ])
  const view = buildCockpitIssueView({ issue, comments })
  return html(
    res,
    renderCockpitPage({ repo, user: session?.user?.login || 'token', body: renderIssueView(view) }),
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
  sessions.set(state, { oauthState: true })
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
  if (!state || !code || !sessions.get(state)?.oauthState)
    return html(
      res,
      renderCockpitPage({ body: '<section class="panel"><h1>Invalid OAuth state</h1></section>' }),
      400,
    )
  sessions.delete(state)
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
  res.setHeader('Set-Cookie', `cockpit_session=${id}; HttpOnly; SameSite=Lax; Path=/`)
  audit(createAuditEvent({ actor: user.login, action: 'login', allowed: true }))
  return redirect(res, '/')
}

function logout(req, res) {
  sessions.delete(readCookie(req, 'cockpit_session'))
  res.setHeader('Set-Cookie', 'cockpit_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
  return redirect(res, '/login')
}

function audit(event) {
  appendFileSync(join(config.dataDir, 'audit.jsonl'), `${JSON.stringify(event)}\n`)
}

function readCookie(req, name) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((part) => part.trim().split('=')),
  )[name]
}

function html(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function redirect(res, location) {
  res.writeHead(302, { Location: location })
  res.end()
}
