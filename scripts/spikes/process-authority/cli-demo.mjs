import { DelegationGrantIssuer } from './delegation-grant.mjs'

function runDemo() {
  console.log('--- S2 Issuer Spike: Local-Cooperative CLI Demonstration ---\n')
  const issuer = new DelegationGrantIssuer()

  const planDigest = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

  console.log('1. User (local) approves an isolated workstream execution plan.')
  const request = {
    planDigest,
    repository: 'smota/agentflow-sdlc',
    base: 'main',
    allowedPaths: ['scripts/spikes/process-authority/*'],
    allowedActions: ['push'],
    maxAttempts: 3,
    maxExternalEffects: 1,
    expiry: new Date(Date.now() + 60000).toISOString(),
    issuerMode: 'local-cooperative',
  }

  console.log('2. Issuing Immutable Grant Envelope...')
  const envelope = issuer.issue(request, 'human:local-cli')
  console.log('Grant Issued:', envelope.id)
  console.log('HMAC Integrity:', envelope.hmac, '\n')

  console.log(
    '3. Agent presents grant to resolve an operation (push to scripts/spikes/process-authority/cli-demo.mjs)',
  )
  const opDigest1 = 'f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2'
  const resolve1 = issuer.resolve(envelope, {
    operationDigest: opDigest1,
    planDigest,
    repository: 'smota/agentflow-sdlc',
    base: 'main',
    action: 'push',
    path: 'scripts/spikes/process-authority/cli-demo.mjs',
    isExternalEffect: true,
  })
  console.log('Resolution 1 (Valid push):', resolve1, '\n')

  console.log('4. Agent replays the same operation (idempotency/replay check)')
  const resolve2 = issuer.resolve(envelope, {
    operationDigest: opDigest1,
    planDigest,
    repository: 'smota/agentflow-sdlc',
    base: 'main',
    action: 'push',
    path: 'scripts/spikes/process-authority/cli-demo.mjs',
    isExternalEffect: true,
  })
  console.log('Resolution 2 (Replay):', resolve2, '\n')

  console.log('5. Agent attempts path traversal (malicious)')
  const opDigest2 = 'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
  const resolve3 = issuer.resolve(envelope, {
    operationDigest: opDigest2,
    planDigest,
    repository: 'smota/agentflow-sdlc',
    base: 'main',
    action: 'push',
    path: 'scripts/spikes/process-authority/../out-of-bounds.mjs',
    isExternalEffect: true,
  })
  console.log('Resolution 3 (Path Traversal):', resolve3, '\n')

  console.log('6. Agent attempts a second external effect (budget exhaustion check)')
  const opDigest3 = 'c1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
  const resolve4 = issuer.resolve(envelope, {
    operationDigest: opDigest3,
    planDigest,
    repository: 'smota/agentflow-sdlc',
    base: 'main',
    action: 'push',
    path: 'scripts/spikes/process-authority/other.mjs',
    isExternalEffect: true,
  })
  console.log('Resolution 4 (Budget Exhaustion):', resolve4, '\n')

  console.log('--- Demonstration Complete ---')
}

runDemo()
