import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_DECIDER_URL,
  DEFAULT_DECIDER_TIMEOUT_MS,
  ALLOWED_DECIDER_TASKS,
  PROHIBITED_DECIDER_ACTIONS,
  STEERING_PLANES,
  STEERING_SEATS,
  IN_RIG_EXECUTION_SEATS,
  validateEndpoint,
  createJevAuthHeaders,
  sanitizeDeciderPayload,
  isDeciderTaskAllowed,
  isDeciderAvailable,
  queryDecider,
  triageQueueOrdering,
  triageIssueDedupe,
  triageNudgeLevel,
  GROUNDED_QUEUE_ORDERING_INSTRUCTIONS,
  GROUNDED_ISSUE_DEDUPE_INSTRUCTIONS,
  GROUNDED_NUDGE_INSTRUCTIONS,
  GROUNDED_NUDGE_CRITERIA,
} from '../providers/decider-port.mjs'

describe('decider-port', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('constants and exports', () => {
    it('exports immutable tasks, prohibited actions, and plane definitions', () => {
      expect(DEFAULT_DECIDER_URL).toBe('http://127.0.0.1:8002/v1/decide')
      expect(DEFAULT_DECIDER_TIMEOUT_MS).toBe(2000)

      expect(ALLOWED_DECIDER_TASKS).toContain('queue-ordering')
      expect(ALLOWED_DECIDER_TASKS).toContain('issue-dedupe')
      expect(ALLOWED_DECIDER_TASKS).toContain('nudge-level')
      expect(ALLOWED_DECIDER_TASKS.length).toBe(3)

      expect(PROHIBITED_DECIDER_ACTIONS).toContain('gate-signoff')
      expect(PROHIBITED_DECIDER_ACTIONS).toContain('merge')
      expect(PROHIBITED_DECIDER_ACTIONS).toContain('scope-modify')
      expect(PROHIBITED_DECIDER_ACTIONS).toContain('waiver-grant')

      expect(STEERING_PLANES).toContain('external-steering')
      expect(STEERING_SEATS).toContain('steer.lead')
      expect(STEERING_SEATS).toContain('steer-lead@*')
      expect(STEERING_SEATS).toContain('steer')
      expect(STEERING_SEATS).toContain('steer.po')
      expect(STEERING_SEATS).not.toContain('antigravity')
      expect(STEERING_SEATS).not.toContain('orch.steer')

      expect(IN_RIG_EXECUTION_SEATS).toContain('dev.build')
      expect(IN_RIG_EXECUTION_SEATS).toContain('dev.test-eng')
      expect(IN_RIG_EXECUTION_SEATS).toContain('pm.manager')
      expect(IN_RIG_EXECUTION_SEATS).toContain('orch.arch')
      expect(IN_RIG_EXECUTION_SEATS).toContain('rev.review')
    })
  })

  describe('endpoint security validation (N1)', () => {
    it('accepts loopback HTTP endpoints', () => {
      expect(validateEndpoint('http://127.0.0.1:8002/v1/decide')).toBe(
        'http://127.0.0.1:8002/v1/decide',
      )
      expect(validateEndpoint('http://localhost:8002/v1/decide')).toBe(
        'http://localhost:8002/v1/decide',
      )
      expect(validateEndpoint('http://[::1]:8002/v1/decide')).toBe('http://[::1]:8002/v1/decide')
    })

    it('accepts loopback HTTPS endpoints', () => {
      expect(validateEndpoint('https://localhost:8002/v1/decide')).toBe(
        'https://localhost:8002/v1/decide',
      )
      expect(validateEndpoint('https://127.0.0.1:8002/v1/decide')).toBe(
        'https://127.0.0.1:8002/v1/decide',
      )
    })

    it('rejects remote endpoints (both HTTP and HTTPS) to prevent credential egress (M5)', () => {
      expect(() => validateEndpoint('https://decider.internal.net/v1/decide')).toThrow(
        /must be a loopback address/,
      )
      expect(() => validateEndpoint('https://attacker.example/v1/decide')).toThrow(
        /must be a loopback address/,
      )
      expect(() => validateEndpoint('http://decider.external.com/v1/decide')).toThrow(
        /must be a loopback address/,
      )
      expect(() => validateEndpoint('http://192.168.1.50:8002/v1/decide')).toThrow(
        /must be a loopback address/,
      )
    })

    it('rejects invalid or empty endpoint URLs', () => {
      expect(() => validateEndpoint('')).toThrow(/Decider endpoint URL is required/)
      expect(() => validateEndpoint('not-a-valid-url')).toThrow(/Invalid decider endpoint URL/)
      expect(() => validateEndpoint('ftp://127.0.0.1:8002/v1/decide')).toThrow(
        /Unsupported protocol/,
      )
    })
  })

  describe('Jev auth header adapter', () => {
    it('creates json headers without auth when no token is present', () => {
      delete process.env.JEV_AUTH_TOKEN
      delete process.env.JEV_TOKEN
      const headers = createJevAuthHeaders()
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Jev-Auth']).toBeUndefined()
      expect(headers['Authorization']).toBeUndefined()
    })

    it('attaches X-Jev-Auth and Authorization headers when token is provided', () => {
      const headers = createJevAuthHeaders('sec-jev-test-token-123')
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['X-Jev-Auth']).toBe('sec-jev-test-token-123')
      expect(headers['Authorization']).toBe('Jev sec-jev-test-token-123')
    })

    it('reads JEV_AUTH_TOKEN from environment when token argument is omitted', () => {
      process.env.JEV_AUTH_TOKEN = 'env-token-xyz'
      const headers = createJevAuthHeaders()
      expect(headers['X-Jev-Auth']).toBe('env-token-xyz')
      expect(headers['Authorization']).toBe('Jev env-token-xyz')
    })

    it('reads JEV_TOKEN from environment as fallback', () => {
      delete process.env.JEV_AUTH_TOKEN
      process.env.JEV_TOKEN = 'fallback-env-token'
      const headers = createJevAuthHeaders()
      expect(headers['X-Jev-Auth']).toBe('fallback-env-token')
      expect(headers['Authorization']).toBe('Jev fallback-env-token')
    })

    it('merges custom headers cleanly', () => {
      const headers = createJevAuthHeaders('tok', { 'X-Custom-Trace': 'trace-999' })
      expect(headers['X-Custom-Trace']).toBe('trace-999')
      expect(headers['X-Jev-Auth']).toBe('tok')
    })
  })

  describe('payload sanitization and source code redaction (M1 & N4)', () => {
    it('leaves safe primitive types and metadata intact', () => {
      const safe = {
        criterionId: 'crit_test_1',
        exitCode: 0,
        failuresCount: 2,
        blocked: false,
        diffStats: { filesChanged: 3, insertions: 120, deletions: 15 },
      }
      const sanitized = sanitizeDeciderPayload(safe)
      expect(sanitized).toEqual(safe)
    })

    it('preserves numeric exit codes under key "code" (N4)', () => {
      const payload = {
        criterionId: 'crit_test',
        code: 1, // exit code
        exitCode: 0,
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.code).toBe(1)
      expect(sanitized.exitCode).toBe(0)
    })

    it('redacts text or source code under key "code" (B3)', () => {
      const payload = {
        criterionId: 'crit_code_leak',
        code: 'function f(){ return db.query(sql) }',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.code).toBe('[REDACTED_CODE]')
      expect(sanitized.code).not.toContain('db.query')
    })

    it('redacts Python code, short JS, diff hunks without headers, and secret formats (M4)', () => {
      const payload = {
        criterionId: 'crit_multi_lang',
        pyCode: 'def verify_signature(token):\n    return secret_key',
        shortJs: 'function f(){ return db.query(sql) }',
        hunkNoHeader: '@@ -1 +1 @@\n-old\n+new',
        jwt: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature',
        awsKey: 'Reported key AKIAIOSFODNN7EXAMPLE for user',
        slackToken: 'Posting to hook xoxb-123456789012-1234567890123-abcdef',
        githubPat: 'Token github_pat_11ABCDEFG1234567890_abcdefghijklmnopqrstuvwxyz12345',
        stderr: 'Traceback (most recent call last):\n  File "app.py", line 10',
        snippet: 'some raw snippet content',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.pyCode).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.shortJs).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.hunkNoHeader).toBe('[REDACTED_DIFF_CONTENT]')
      expect(sanitized.jwt).toContain('[REDACTED_SECRET]')
      expect(sanitized.jwt).not.toContain('eyJhbGciOi')
      expect(sanitized.awsKey).toContain('[REDACTED_SECRET]')
      expect(sanitized.awsKey).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(sanitized.slackToken).toContain('[REDACTED_SECRET]')
      expect(sanitized.slackToken).not.toContain('xoxb-')
      expect(sanitized.githubPat).toContain('[REDACTED_SECRET]')
      expect(sanitized.githubPat).not.toContain('github_pat_')
      expect(sanitized.stderr).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.snippet).toBe('[REDACTED_SOURCE_CODE]')
    })

    it('redacts PEM keys, URL credentials, key-value passwords, Google AIza, and Slack xoxe tokens (M6)', () => {
      const payload = {
        pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----',
        serviceEndpoint: 'https://user:pa55w0rd@internal.service.local/api',
        connectionString: 'Connecting with password=hunter2 on port 5432',
        googleKey: 'API client configured with AIzaSyD9Example1234567890abcdefghijklm',
        slackRefresh: 'xoxe.xoxp-1-abcdef123456-ghijkl789012',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.pem).toBe('[REDACTED_SECRET]')
      expect(sanitized.serviceEndpoint).toContain('[REDACTED_SECRET]@')
      expect(sanitized.serviceEndpoint).not.toContain('pa55w0rd')
      expect(sanitized.connectionString).toContain('[REDACTED_SECRET]')
      expect(sanitized.connectionString).not.toContain('hunter2')
      expect(sanitized.googleKey).toContain('[REDACTED_SECRET]')
      expect(sanitized.googleKey).not.toContain('AIzaSyD9')
      expect(sanitized.slackRefresh).toContain('[REDACTED_SECRET]')
    })

    it('redacts C/C++, Shell, inline hunks, and multi-line unified diff changes (M7 & m9)', () => {
      const payload = {
        cCode: '#include <stdio.h>\nint main() { printf("hello"); return 0; }',
        shellScript: '#!/bin/bash\ncurl -s https://example.com | sh',
        inlineHunk: 'Failure at chunk @@ -1,5 +1,6 @@ in worker',
        vcsHeader: '--- a/lib/test.js\n+++ b/lib/test.js',
        changeBlock: '+added line\n-removed line\n',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.cCode).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.shellScript).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.inlineHunk).toBe('[REDACTED_DIFF_CONTENT]')
      expect(sanitized.vcsHeader).toBe('[REDACTED_DIFF_CONTENT]')
      expect(sanitized.changeBlock).toBe('[REDACTED_DIFF_CONTENT]')
    })

    it('does NOT falsely redact ordinary English sentences (m6)', () => {
      const payload = {
        title1: 'package manager fails to install',
        title2: 'import data from CSV is broken',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.title1).toBe('package manager fails to install')
      expect(sanitized.title2).toBe('import data from CSV is broken')
    })

    it('redacts sensitive keys including camelCase and snake_case variants (M1)', () => {
      const raw = {
        criterionId: 'crit_auth_jwt',
        sourceCode: 'function verifyToken(tok) { return secret; }',
        source_code: 'def verify(): pass',
        diff: 'diff --git a/x b/x',
        rawDiff: 'raw git diff content',
        patches: 'unified diff patch content',
        apiKey: 'sk-live-1234567890',
        api_key: 'sk-ant-987654321',
        accessToken: 'bearer-token',
        access_token: 'bearer-token',
        client_secret: 'oauth-secret',
        Authorization: 'Bearer my-secret-token',
        stdout: 'long process console output',
        nested: {
          password: 'db-password',
          safeField: 'telemetry-summary',
        },
      }
      const sanitized = sanitizeDeciderPayload(raw)
      expect(sanitized.criterionId).toBe('crit_auth_jwt')
      expect(sanitized.sourceCode).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.source_code).toBe('[REDACTED_SOURCE_CODE]')
      expect(sanitized.diff).toBe('[REDACTED_DIFF_STATISTICS_ONLY]')
      expect(sanitized.rawDiff).toBe('[REDACTED_DIFF_STATISTICS_ONLY]')
      expect(sanitized.patches).toBe('[REDACTED_DIFF_STATISTICS_ONLY]')
      expect(sanitized.apiKey).toBe('[REDACTED_SECRET]')
      expect(sanitized.api_key).toBe('[REDACTED_SECRET]')
      expect(sanitized.accessToken).toBe('[REDACTED_SECRET]')
      expect(sanitized.access_token).toBe('[REDACTED_SECRET]')
      expect(sanitized.client_secret).toBe('[REDACTED_SECRET]')
      expect(sanitized.Authorization).toBe('[REDACTED_SECRET]')
      expect(sanitized.nested.password).toBe('[REDACTED_SECRET]')
      expect(sanitized.nested.safeField).toBe('telemetry-summary')
    })

    it('preserves diff statistics when diff object contains count metrics', () => {
      const raw = {
        diffContent: {
          filesChanged: 4,
          insertions: 50,
          deletions: 12,
          rawLines: 'lots of code...',
        },
      }
      const sanitized = sanitizeDeciderPayload(raw)
      expect(sanitized.diffStats).toEqual({
        filesChanged: 4,
        insertions: 50,
        deletions: 12,
      })
    })

    it('redacts git diff strings inside generic text values (M1)', () => {
      const diffString =
        'diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,3 @@\n-old\n+new'
      const sanitized = sanitizeDeciderPayload(diffString)
      expect(sanitized).toBe('[REDACTED_DIFF_CONTENT]')
    })

    it('redacts token patterns inside generic string values (M1)', () => {
      const stringWithToken = 'Failure reported for key sk-live-abcdef1234567890abcdef during auth'
      const sanitized = sanitizeDeciderPayload(stringWithToken)
      expect(sanitized).not.toContain('sk-live-')
      expect(sanitized).toContain('[REDACTED_SECRET]')
    })

    it('redacts code fences and raw multiline code in string values', () => {
      const textWithFences =
        'Here is the failure context:\n```typescript\nconst x = 1;\nexport default x;\n```\nEnd trace.'
      const sanitized = sanitizeDeciderPayload(textWithFences)
      expect(sanitized).not.toContain('const x = 1')
      expect(sanitized).toContain('[REDACTED_CODE_BLOCK]')
    })

    it('redacts two-line diff without trailing newline (N1)', () => {
      const diffNoTrailingNewline = '-old line\n+new line'
      const sanitized = sanitizeDeciderPayload(diffNoTrailingNewline)
      expect(sanitized).toBe('[REDACTED_DIFF_CONTENT]')
    })

    it('redacts Stripe sk_live_, rk_live_, JSON-quoted secrets, Basic auth with padding, and unclosed PEM blocks (N2 & m3)', () => {
      const payload = {
        stripeKey: 'sk_live_1234567890123456',
        stripeRestricted: 'rk_live_1234567890123456',
        jsonConfig: '{"password":"hunter2","token":"abc12345"}',
        basicHeader: 'Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l==',
        unclosedPem: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.stripeKey).toContain('[REDACTED_SECRET]')
      expect(sanitized.stripeKey).not.toContain('sk_live_1234567890123456')
      expect(sanitized.stripeRestricted).toContain('[REDACTED_SECRET]')
      expect(sanitized.stripeRestricted).not.toContain('rk_live_1234567890123456')
      expect(sanitized.jsonConfig).toContain('[REDACTED_SECRET]')
      expect(sanitized.jsonConfig).not.toContain('hunter2')
      expect(sanitized.basicHeader).toBe('Authorization: [REDACTED_SECRET]')
      expect(sanitized.unclosedPem).toBe('[REDACTED_SECRET]')
    })

    it('redacts single-quoted credentials, multi-word quoted passphrases, and escaped JSON (B1 & M1)', () => {
      const payload = {
        singleQuotePw: "password='hunter2'",
        singleQuoteSecret: "secret: 'abc123'",
        multiWordPw: 'password = "correct horse battery"',
        escapedJsonLog: '{\\"token\\":\\"secret123\\"}',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.singleQuotePw).toBe('[REDACTED_SECRET]')
      expect(sanitized.singleQuoteSecret).toBe('[REDACTED_SECRET]')
      expect(sanitized.multiWordPw).toBe('[REDACTED_SECRET]')
      expect(sanitized.multiWordPw).not.toContain('horse')
      expect(sanitized.escapedJsonLog).toBe('{[REDACTED_SECRET]}')
    })

    it('redacts credentials with compound key names (Round 6 B1)', () => {
      const payload = {
        awsSecret: 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        awsUpper: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        privateKey: 'private_key: "abcdef1234567890abcdef"',
        passphrase: 'passphrase=hunterTwo',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.awsSecret).toBe('[REDACTED_SECRET]')
      expect(sanitized.awsUpper).toBe('[REDACTED_SECRET]')
      expect(sanitized.privateKey).toBe('[REDACTED_SECRET]')
      expect(sanitized.passphrase).toBe('[REDACTED_SECRET]')
    })

    it('redacts quoted values with inner quotes, escaped quotes, ruby rockets, and URL credentials with @ (Round 6 M1 & m1)', () => {
      const payload = {
        innerSingleQuote: 'password="it\'s a secret"',
        escapedQuotesInJson: '{"password":"ab\\"cdSECRETTAIL"}',
        rubyRocket: 'password => "rubySecret"',
        urlWithAt: 'postgres://admin:s3cr3tP@ss@db.local:5432/mydb',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.innerSingleQuote).toBe('[REDACTED_SECRET]')
      expect(sanitized.escapedQuotesInJson).toBe('{[REDACTED_SECRET]}')
      expect(sanitized.rubyRocket).toBe('[REDACTED_SECRET]')
      expect(sanitized.urlWithAt).toBe('postgres://[REDACTED_SECRET]@db.local:5432/mydb')
    })

    it('redacts two-line diffs with Windows CRLF endings (m1)', () => {
      const crlfDiff = '+added line\r\n-removed line'
      const sanitized = sanitizeDeciderPayload(crlfDiff)
      expect(sanitized).toBe('[REDACTED_DIFF_CONTENT]')
    })

    it('redacts sensitive keys in object property names (N3)', () => {
      const sensitiveKeyObj = {
        ghp_11ABCDEFG1234567890_abcdef1234567890: 'safeValue',
      }
      const sanitized = sanitizeDeciderPayload(sensitiveKeyObj)
      const keys = Object.keys(sanitized)
      expect(keys[0]).toBe('[REDACTED_SECRET]')
      expect(keys[0]).not.toContain('ghp_')
      expect(sanitized[keys[0]]).toBe('safeValue')
    })

    it('redacts pwd, Go :=, Token auth headers, and empty-user Redis URLs (Round 7 M1 & minor)', () => {
      const payload = {
        pwdKey: 'pwd=abc123SECRET',
        goAssign: 'client_secret := abc123SECRET',
        httpHeader: 'Authorization: Token abcdef1234567890',
        redisUrl: 'redis://:onlyPass@host:6379',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.pwdKey).toBe('[REDACTED_SECRET]')
      expect(sanitized.goAssign).toBe('[REDACTED_SECRET]')
      expect(sanitized.httpHeader).toBe('Authorization: [REDACTED_SECRET]')
      expect(sanitized.redisUrl).toBe('redis://[REDACTED_SECRET]@host:6379')
    })

    it('redacts unclosed quoted secrets across multi-line logs and Windows backslash paths (Round 8 R8-m1 & Round 9 R9-M1)', () => {
      const payload = {
        unclosedDoubleQuote: 'password="hunter2 still open in log',
        unclosedSingleQuote: "secret='hunter3 still open in log",
        unclosedEscapedDouble: '{\\"token\\":\\"secretVal99',
        unclosedMultiLineDouble: 'password="hunter2 still open\nnext line',
        unclosedMultiLineSingle: "token='abc123secret\nmore",
        unclosedWindowsPath: 'password="C:\\\\Users\\\\hunter2',
        unclosedWindowsMultiLine: 'password="C:\\\\Users\\\\hunter2\nnext line',
      }
      const sanitized = sanitizeDeciderPayload(payload)
      expect(sanitized.unclosedDoubleQuote).toBe('[REDACTED_SECRET]')
      expect(sanitized.unclosedSingleQuote).toBe('[REDACTED_SECRET]')
      expect(sanitized.unclosedEscapedDouble).toBe('{[REDACTED_SECRET]')
      expect(sanitized.unclosedMultiLineDouble).toBe('[REDACTED_SECRET]\nnext line')
      expect(sanitized.unclosedMultiLineSingle).toBe('[REDACTED_SECRET]\nmore')
      expect(sanitized.unclosedWindowsPath).toBe('[REDACTED_SECRET]')
      expect(sanitized.unclosedWindowsMultiLine).toBe('[REDACTED_SECRET]\nnext line')
    })

    it('sanitizes long unbroken strings linearly without ReDoS backtrack stall (Round 7 B1 timing test)', () => {
      const longHex = 'deadbeef'.repeat(12800) // ~102 KB
      const longA = 'a'.repeat(100000) // 100 KB
      const longSlash = '\\'.repeat(50000) // 50 KB slashes

      const t0 = performance.now()
      const sanitizedHex = sanitizeDeciderPayload(longHex)
      const durationHex = performance.now() - t0

      const t1 = performance.now()
      const sanitizedA = sanitizeDeciderPayload(longA)
      const durationA = performance.now() - t1

      const t2 = performance.now()
      const sanitizedSlash = sanitizeDeciderPayload(longSlash)
      const durationSlash = performance.now() - t2

      // Threshold set to 250ms to ensure stability across shared multi-core CI runners running Vitest
      // in parallel across repository test suites, while still catching catastrophic ReDoS backtracking (which takes >1500ms - 30000ms+).
      expect(durationHex).toBeLessThan(250)
      expect(durationA).toBeLessThan(250)
      expect(durationSlash).toBeLessThan(250)
      expect(sanitizedHex).toBe(longHex)
      expect(sanitizedA).toBe(longA)
      expect(sanitizedSlash).toBe(longSlash)
    })

    it('processes unclosed quotes with repeating backslashes, dotted URLs, and code detector probes in <250ms (Round 8 R8-B1 & R8-M1)', () => {
      const b1Probes = [
        'token="' + '\\\\'.repeat(30),
        "token='" + '\\\\'.repeat(30),
        "token=\\'" + '\\\\'.repeat(30),
        'token=\\"' + '\\\\'.repeat(30),
      ]
      for (const probe of b1Probes) {
        const start = performance.now()
        sanitizeDeciderPayload(probe)
        const dur = performance.now() - start
        expect(dur).toBeLessThan(250)
      }

      // URL scheme on 100KB repeating dotted letters (R8-M1 & R9-m1 warm-up)
      const url100k = 'a.'.repeat(50000)
      sanitizeDeciderPayload(url100k) // warm-up
      const tUrl = performance.now()
      sanitizeDeciderPayload(url100k)
      expect(performance.now() - tUrl).toBeLessThan(250)

      // Code detector probes on repeating for/import keywords (R8-M1)
      const forProbe = 'for in '.repeat(3000)
      const tFor = performance.now()
      sanitizeDeciderPayload(forProbe)
      expect(performance.now() - tFor).toBeLessThan(250)

      const importProbe = 'import '.repeat(15000)
      const tImport = performance.now()
      sanitizeDeciderPayload(importProbe)
      expect(performance.now() - tImport).toBeLessThan(250)
    })

    it('processes 100K backslashes after escaped quotes in <250ms without backtracking (Round 10 R10-B1)', () => {
      const probe1 = 'password=\\"' + '\\\\'.repeat(50000)
      const probe2 = "token=\\'" + '\\\\'.repeat(50000)

      // Warm-up
      sanitizeDeciderPayload(probe1.slice(0, 1000))
      sanitizeDeciderPayload(probe2.slice(0, 1000))

      const t1 = performance.now()
      sanitizeDeciderPayload(probe1)
      const dur1 = performance.now() - t1

      const t2 = performance.now()
      sanitizeDeciderPayload(probe2)
      const dur2 = performance.now() - t2

      expect(dur1).toBeLessThan(250)
      expect(dur2).toBeLessThan(250)
    })

    it('caps single-string payload scan to 256 KB defense-in-depth', () => {
      const hugeString = 'x'.repeat(300000)
      const sanitized = sanitizeDeciderPayload(hugeString)
      expect(sanitized.length).toBe(262144 + '...[TRUNCATED]'.length)
      expect(sanitized.endsWith('...[TRUNCATED]')).toBe(true)
    })
  })

  describe('plane separation and seat boundaries (B1 fail closed)', () => {
    it('throws error when plane is missing, null, or empty string', async () => {
      await expect(
        queryDecider({
          task: 'queue-ordering',
          seat: 'steer',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(/Plane is required/)

      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: '',
          seat: 'steer',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(/Plane is required/)

      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: null,
          seat: 'steer',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(/Plane is required/)
    })

    it('throws error when seat is missing, null, or empty string', async () => {
      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: 'external-steering',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(/Seat is required/)

      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: 'external-steering',
          seat: '',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(/Seat is required/)
    })

    it('throws error when invoked by an in-rig execution seat', async () => {
      for (const seat of IN_RIG_EXECUTION_SEATS) {
        await expect(
          queryDecider({
            task: 'queue-ordering',
            plane: 'external-steering',
            seat,
            state: {},
            question: { type: 'choice', criteria: { a: 'A' } },
          }),
        ).rejects.toThrow(/In-rig execution seats .* cannot connect to the decider port/)
      }
    })

    it('throws error when invoked by an in-rig execution seat session name', async () => {
      const sessionSeats = [
        'orch-arch@dendro-dev',
        'rev-review@dendro-dev',
        'dev-build@dendro-dev',
        'pm-manager@dendro-pm',
      ]
      for (const seat of sessionSeats) {
        await expect(
          queryDecider({
            task: 'queue-ordering',
            plane: 'external-steering',
            seat,
            state: {},
            question: { type: 'choice', criteria: { a: 'A' } },
          }),
        ).rejects.toThrow(/In-rig execution seats .* cannot connect to the decider port/)
      }
    })

    it('rejects removed steering seats orch.steer and antigravity', async () => {
      for (const seat of ['orch.steer', 'antigravity']) {
        await expect(
          queryDecider({
            task: 'queue-ordering',
            plane: 'external-steering',
            seat,
            state: {},
            question: { type: 'choice', criteria: { a: 'A' } },
          }),
        ).rejects.toThrow(/is not an authorized external steering seat/)
      }
    })

    it('throws error when invoked by an unapproved seat not on steering allowlist', async () => {
      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: 'external-steering',
          seat: 'random-seat-name',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(/is not an authorized external steering seat/)
    })

    it('throws error when plane is not an authorized steering plane', async () => {
      await expect(
        queryDecider({
          task: 'queue-ordering',
          plane: 'worker-plane',
          seat: 'steer',
          state: {},
          question: { type: 'choice', criteria: { a: 'A' } },
        }),
      ).rejects.toThrow(
        /Decider port is restricted exclusively to external supervisory steering plane/,
      )
    })
  })

  describe('allowlist and prohibited actions enforcement', () => {
    it('identifies allowed tasks correctly', () => {
      expect(isDeciderTaskAllowed('queue-ordering')).toBe(true)
      expect(isDeciderTaskAllowed('issue-dedupe')).toBe(true)
      expect(isDeciderTaskAllowed('nudge-level')).toBe(true)
      expect(isDeciderTaskAllowed('  QUEUE-ORDERING  ')).toBe(true)
    })

    it('rejects prohibited actions and unauthorized tasks', () => {
      expect(isDeciderTaskAllowed('gate-signoff')).toBe(false)
      expect(isDeciderTaskAllowed('merge')).toBe(false)
      expect(isDeciderTaskAllowed('scope-modify')).toBe(false)
      expect(isDeciderTaskAllowed('arbitrary-code-exec')).toBe(false)
      expect(isDeciderTaskAllowed('')).toBe(false)
      expect(isDeciderTaskAllowed(null)).toBe(false)
    })

    it('throws when prohibited action is requested', async () => {
      await expect(
        queryDecider({
          task: 'gate-signoff',
          plane: 'external-steering',
          seat: 'steer',
        }),
      ).rejects.toThrow(/Task "gate-signoff" involves prohibited decision actions/)

      await expect(
        queryDecider({
          task: 'merge-execute',
          plane: 'external-steering',
          seat: 'steer',
        }),
      ).rejects.toThrow(/involves prohibited decision actions/)
    })

    it('throws when task is not on the allowlist', async () => {
      await expect(
        queryDecider({
          task: 'generate-code',
          plane: 'external-steering',
          seat: 'steer',
        }),
      ).rejects.toThrow(/is not permitted on decider port allowlist/)
    })
  })

  describe('queryDecider with mocked fetch (M3 request verification)', () => {
    it('sends Jev headers and sanitized payload to decider endpoint', async () => {
      let capturedUrl = null
      let capturedOptions = null

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        capturedUrl = url
        capturedOptions = opts
        return {
          ok: true,
          json: async () => ({
            type: 'choice',
            choice: 'option_1',
            probabilities: { option_1: 0.9, option_2: 0.1 },
            confidence: 0.8,
          }),
        }
      })

      const res = await queryDecider({
        task: 'queue-ordering',
        plane: 'external-steering',
        seat: 'steer',
        state: {
          rawDiff: 'diff --git a/foo b/foo',
          apiKey: 'sk-live-12345678901234567890',
          criterionId: 'crit_1',
        },
        question: {
          type: 'choice',
          criteria: { option_1: 'First', option_2: 'Second' },
        },
        options: {
          jevToken: 'mock-jev-token-555',
        },
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.answer.choice).toBe('option_1')

      // Verify URL
      expect(capturedUrl).toBe('http://127.0.0.1:8002/v1/decide')

      // Verify headers
      expect(capturedOptions.headers['Content-Type']).toBe('application/json')
      expect(capturedOptions.headers['X-Jev-Auth']).toBe('mock-jev-token-555')
      expect(capturedOptions.headers['Authorization']).toBe('Jev mock-jev-token-555')

      // Verify body was sanitized
      const parsedBody = JSON.parse(capturedOptions.body)
      expect(parsedBody.model).toBe('d3-flash')
      expect(parsedBody.state.criterionId).toBe('crit_1')
      expect(parsedBody.state.rawDiff).toBe('[REDACTED_DIFF_STATISTICS_ONLY]')
      expect(parsedBody.state.apiKey).toBe('[REDACTED_SECRET]')
    })

    it('falls back cleanly on HTTP error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Model is busy loading weights',
      })

      const res = await queryDecider({
        task: 'nudge-level',
        plane: 'external-steering',
        seat: 'steer',
        state: {},
        question: { type: 'choice', criteria: { gentle: 'Gentle' } },
      })

      expect(res.ok).toBe(false)
      expect(res.source).toBe('fallback')
      expect(res.fallbackReason).toBe('http-error')
      expect(res.error).toContain('Decider HTTP 503')
    })

    it('falls back cleanly on timeout or network abort (B2)', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const error = new Error('The operation was aborted due to timeout')
        error.name = 'AbortError'
        throw error
      })

      const res = await queryDecider({
        task: 'nudge-level',
        plane: 'external-steering',
        seat: 'steer',
        state: {},
        question: { type: 'choice', criteria: { gentle: 'Gentle' } },
      })

      expect(res.ok).toBe(false)
      expect(res.source).toBe('fallback')
      expect(res.fallbackReason).toBe('timeout')
    })

    it('sets redirect: error on fetch to prevent token leakage on 3xx redirect (B4)', async () => {
      let capturedOpts = null
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        capturedOpts = opts
        return {
          ok: true,
          json: async () => ({ model: 'd3-flash', choice: 'ok' }),
        }
      })

      await queryDecider({
        task: 'queue-ordering',
        plane: 'external-steering',
        seat: 'steer',
        state: {},
        question: { type: 'choice', criteria: { a: 'A' } },
      })

      expect(capturedOpts.redirect).toBe('error')
    })

    it('returns fallback cleanly when endpoint URL is invalid (m4)', async () => {
      const res = await queryDecider({
        task: 'queue-ordering',
        plane: 'external-steering',
        seat: 'steer',
        state: {},
        question: { type: 'choice', criteria: { a: 'A' } },
        options: { endpoint: 'not-a-valid-url' },
      })

      expect(res.ok).toBe(false)
      expect(res.source).toBe('fallback')
      expect(res.fallbackReason).toBe('invalid-endpoint')
    })
  })

  describe('triage: queue ordering (M3 success & fallback paths)', () => {
    it('returns empty list when tasks array is empty', async () => {
      const res = await triageQueueOrdering({
        tasks: [],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.orderedTasks).toEqual([])
      expect(res.selectedTaskId).toBeNull()
    })

    it('returns single item immediately', async () => {
      const res = await triageQueueOrdering({
        tasks: [{ id: 'task-100' }],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.selectedTaskId).toBe('task-100')
      expect(res.orderedTasks.length).toBe(1)
    })

    it('orders tasks via decider when responsive and choice is valid', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 't2',
          confidence: 0.92,
          probabilities: { t1: 0.08, t2: 0.92 },
        }),
      })

      const tasks = [
        { id: 't1', criterionId: 'crit_a', reworkRound: 1 },
        { id: 't2', criterionId: 'crit_b', reworkRound: 0 },
      ]

      const res = await triageQueueOrdering({
        tasks,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.selectedTaskId).toBe('t2')
      expect(res.orderedTasks[0].id).toBe('t2')
      expect(res.orderedTasks[1].id).toBe('t1')
    })

    it('transmits grounded comparator attributes, explicit instructions, and structured criteria (capability 2 / #502)', async () => {
      let capturedBody = null
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body)
        return {
          ok: true,
          json: async () => ({
            type: 'choice',
            choice: 't1',
            confidence: 0.95,
          }),
        }
      })

      const tasks = [
        {
          id: 't1',
          criterionId: 'crit_fix',
          reworkRound: 2,
          failures: ['err1', 'err2'],
          blocked: false,
          priority: 1,
          createdAt: '2026-10-14T08:00:00Z',
        },
        {
          id: 't2',
          criterionId: 'crit_feat',
          reworkRound: 0,
          failureCount: 0,
          blocked: false,
          priority: 2,
          createdAt: '2026-10-14T09:00:00Z',
        },
      ]

      await triageQueueOrdering({
        tasks,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(capturedBody).not.toBeNull()
      expect(capturedBody.question.instructions).toBe(GROUNDED_QUEUE_ORDERING_INSTRUCTIONS)

      // Verify state items include priority, createdAt, and inputOrder
      const item0 = capturedBody.state.items[0]
      expect(item0.id).toBe('t1')
      expect(item0.blocked).toBe(false)
      expect(item0.reworkRound).toBe(2)
      expect(item0.failuresCount).toBe(2)
      expect(item0.priority).toBe(1)
      expect(item0.createdAt).toBe('2026-10-14T08:00:00Z')
      expect(item0.inputOrder).toBe(0)

      const item1 = capturedBody.state.items[1]
      expect(item1.id).toBe('t2')
      expect(item1.inputOrder).toBe(1)

      // Verify criteria strings format every comparator dimension
      expect(capturedBody.question.criteria.t1).toBe(
        'Task t1: blocked=false; reworkRound=2; failuresCount=2; priority=1; createdAt=2026-10-14T08:00:00Z; inputOrder=0.',
      )
      expect(capturedBody.question.criteria.t2).toBe(
        'Task t2: blocked=false; reworkRound=0; failuresCount=0; priority=2; createdAt=2026-10-14T09:00:00Z; inputOrder=1.',
      )
    })

    it('does not drop tasks if duplicate ids exist in input (N2)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'shared_id',
          confidence: 0.8,
        }),
      })

      const tasks = [
        { id: 'shared_id', name: 'task_one' },
        { id: 'shared_id', name: 'task_two' },
        { id: 'other_id', name: 'task_three' },
      ]

      const res = await triageQueueOrdering({
        tasks,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.orderedTasks.length).toBe(3)
    })

    it('orders tasks deterministically on fallback (unblocked first, higher rework rounds, higher failures, ISO string date) (N3)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

      const tasks = [
        { id: 't_blocked', blocked: true, reworkRound: 2, failureCount: 5 },
        {
          id: 't_clean_older',
          blocked: false,
          reworkRound: 0,
          failureCount: 0,
          priority: 2,
          createdAt: '2026-10-14T08:00:00Z',
        },
        {
          id: 't_clean_newer',
          blocked: false,
          reworkRound: 0,
          failureCount: 0,
          priority: 2,
          createdAt: '2026-10-14T09:00:00Z',
        },
        { id: 't_critical_rework', blocked: false, reworkRound: 2, failureCount: 3, priority: 1 },
      ]

      const res = await triageQueueOrdering({
        tasks,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('fallback')
      // critical rework first (round 2 > 0)
      expect(res.orderedTasks[0].id).toBe('t_critical_rework')
      // clean older before clean newer (FIFO)
      expect(res.orderedTasks[1].id).toBe('t_clean_older')
      expect(res.orderedTasks[2].id).toBe('t_clean_newer')
      // blocked last
      expect(res.orderedTasks[3].id).toBe('t_blocked')
    })

    it('preserves task and issue IDs of 0 without dropping or blanking (m5)', async () => {
      const tasks = [
        { id: 0, criterionId: 'crit_zero' },
        { id: 1, criterionId: 'crit_one' },
      ]
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 0,
        }),
      })

      const res = await triageQueueOrdering({
        tasks,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.selectedTaskId).toBe('0')
    })

    it('returns selectedTaskId consistently as string or null across all paths (N7)', async () => {
      // 1. Empty list
      const emptyRes = await triageQueueOrdering({
        tasks: [],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(emptyRes.selectedTaskId).toBeNull()

      // 2. Single item with numeric ID
      const singleRes = await triageQueueOrdering({
        tasks: [{ id: 42 }],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(typeof singleRes.selectedTaskId).toBe('string')
      expect(singleRes.selectedTaskId).toBe('42')

      // 3. Fallback path with numeric ID
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Down'))
      const fallbackRes = await triageQueueOrdering({
        tasks: [{ id: 101 }, { id: 102 }],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(typeof fallbackRes.selectedTaskId).toBe('string')
      expect(fallbackRes.selectedTaskId).toBe('101')

      // 4. Task with null id returns null, not string "null" (m2)
      const nullSingleRes = await triageQueueOrdering({
        tasks: [{ id: null }],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(nullSingleRes.selectedTaskId).toBeNull()

      const nullFallbackRes = await triageQueueOrdering({
        tasks: [{ id: null }, { id: undefined }],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(nullFallbackRes.selectedTaskId).toBeNull()
    })

    it('safely handles special property names in queue ordering without prototype pollution (N8)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'toString',
        }),
      })

      const tasks = [
        { id: '__proto__', reworkRound: 1 },
        { id: 'toString', reworkRound: 0 },
        { id: 'constructor', reworkRound: 0 },
      ]

      const res = await triageQueueOrdering({
        tasks,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.selectedTaskId).toBe('toString')
      expect(Object.prototype.hasOwnProperty('__proto__')).toBe(true)
    })
  })

  describe('triage: issue deduplication (M2 exact pre-match, choice validation, fallback)', () => {
    it('returns isDuplicate=false when existing list is empty', async () => {
      const res = await triageIssueDedupe({
        candidate: { title: 'New bug in token refresh' },
        existingIssues: [],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.isDuplicate).toBe(false)
      expect(res.duplicateOf).toBeNull()
    })

    it('pre-emptively matches exact criterionId and errorCategory deterministically without decider call', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const candidate = {
        title: 'Token expiry calculation error',
        criterionId: 'crit_jwt_expiry',
        errorCategory: 'token-expired',
      }
      const existing = [
        { id: '101', title: 'Unrelated issue', criterionId: 'crit_other' },
        {
          id: '102',
          title: 'JWT token expired early',
          criterionId: 'crit_jwt_expiry',
          errorCategory: 'token-expired',
        },
      ]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('deterministic')
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('102')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('pre-emptively matches exact title deterministically without decider call', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const candidate = { title: 'SyntaxError in parser.mjs' }
      const existing = [{ id: '55', title: 'syntaxerror in parser.mjs' }]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('deterministic')
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('55')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('transmits symmetrical attributes, normalized unknown values, and grounded instructions (capability 3 / #503)', async () => {
      let capturedBody = null
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body)
        return {
          ok: true,
          json: async () => ({
            type: 'choice',
            choice: 'none',
            confidence: 0.9,
          }),
        }
      })

      const candidate = {
        title: 'Network timeout during sync',
        // criterionId omitted -> should be 'unknown'
        errorCategory: 'timeout',
        exitCode: 1,
      }
      const existing = [
        {
          id: '101',
          title: 'Sync worker stalled',
          criterionId: 'crit_sync',
          // errorCategory omitted -> should be 'unknown'
          exitCode: 2,
        },
      ]

      await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(capturedBody).not.toBeNull()
      expect(capturedBody.question.instructions).toBe(GROUNDED_ISSUE_DEDUPE_INSTRUCTIONS)

      // Symmetrical candidate schema
      expect(capturedBody.state.candidate).toEqual({
        title: 'Network timeout during sync',
        criterionId: 'unknown',
        errorCategory: 'timeout',
        exitCode: 1,
      })

      // Symmetrical existingIssues array in state
      expect(capturedBody.state.existingIssues).toEqual([
        {
          id: '101',
          title: 'Sync worker stalled',
          criterionId: 'crit_sync',
          errorCategory: 'unknown',
          exitCode: 2,
        },
      ])

      // Grounded criteria descriptions
      expect(capturedBody.question.criteria.none).toBe(
        'No existing issue is sufficiently supported as the same defect.',
      )
      expect(capturedBody.question.criteria['101']).toBe(
        'Existing issue 101: title="Sync worker stalled"; criterionId=crit_sync; errorCategory=unknown; exitCode=2.',
      )
    })

    it('tightens deterministic matching to prevent false duplicates on missing category or conflicting identifiers (capability 3 / #503)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'none',
          confidence: 0.95,
        }),
      })

      // Sub-case 1: Matching criterionId but candidate has NO errorCategory (does NOT match deterministically)
      const candMissingCategory = {
        title: 'Some auth failure',
        criterionId: 'crit_auth',
        // errorCategory is undefined
      }
      const existingWithCategory = [
        {
          id: '201',
          title: 'Different auth error',
          criterionId: 'crit_auth',
          errorCategory: 'token-expired',
        },
      ]

      const resMissingCat = await triageIssueDedupe({
        candidate: candMissingCategory,
        existingIssues: existingWithCategory,
        plane: 'external-steering',
        seat: 'steer',
      })
      // Must not match deterministically; passes to decider which returned 'none'
      expect(resMissingCat.source).toBe('decider')
      expect(resMissingCat.isDuplicate).toBe(false)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      fetchSpy.mockClear()

      // Sub-case 2: Exact matching titles, but conflicting known criterionId (does NOT match deterministically)
      const candConflict = {
        title: 'Identical Error Title',
        criterionId: 'crit_alpha',
      }
      const existingConflict = [
        {
          id: '202',
          title: 'Identical Error Title',
          criterionId: 'crit_beta',
        },
      ]

      const resConflict = await triageIssueDedupe({
        candidate: candConflict,
        existingIssues: existingConflict,
        plane: 'external-steering',
        seat: 'steer',
      })
      // Conflicting identifiers prevent title match; passes to decider which returned 'none'
      expect(resConflict.source).toBe('decider')
      expect(resConflict.isDuplicate).toBe(false)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('identifies duplicate via decider choice when no exact match exists', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: '202',
          confidence: 0.88,
          probabilities: { none: 0.12, 202: 0.88 },
        }),
      })

      const candidate = { title: 'User session reset prematurely' }
      const existing = [
        { id: '201', title: 'DB migration fail' },
        { id: '202', title: 'Unexpected session logout on idle' },
      ]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('202')
    })

    it('identifies new distinct issue when decider chooses none', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'none',
          confidence: 0.95,
        }),
      })

      const candidate = { title: 'Brand new isolated UI glitch' }
      const existing = [{ id: '301', title: 'Backend deadlock' }]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.isDuplicate).toBe(false)
      expect(res.duplicateOf).toBeNull()
    })

    it('falls back to deterministic matching if decider returns an unrecognized choice (M2)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'invalid_unrecognized_id_9999',
        }),
      })

      const candidate = { title: 'Some novel bug' }
      const existing = [{ id: '401', title: 'Completely different bug' }]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('fallback')
      expect(res.isDuplicate).toBe(false)
      expect(res.duplicateOf).toBeNull()
    })

    it('does not falsely mark distinct issues as duplicates when titles contain code blocks (m1)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'none',
          confidence: 0.95,
        }),
      })

      const candidate = {
        title: 'Error in ```foo()``` handler',
        criterionId: 'crit_1',
      }
      const existing = [
        {
          id: '10',
          title: 'Different bug in ```bar()``` handler',
          criterionId: 'crit_2',
        },
      ]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.isDuplicate).toBe(false)
      expect(res.duplicateOf).toBeNull()
    })

    it('ignores existing issues with empty or missing IDs in dedupe (m1)', async () => {
      const candidate = {
        title: 'Crash on startup',
        criterionId: 'crit_startup',
      }
      const existing = [
        {
          id: '',
          title: 'Crash on startup',
          criterionId: 'crit_startup',
        },
      ]

      const res = await triageIssueDedupe({
        candidate,
        existingIssues: existing,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.isDuplicate).toBe(false)
      expect(res.duplicateOf).toBeNull()
    })

    it('handles numeric decider choice cleanly in dedupe and queue ordering (m2)', async () => {
      // 1. Dedupe with numeric choice
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 42,
          confidence: 0.9,
        }),
      })

      const dedupeRes = await triageIssueDedupe({
        candidate: { title: 'Some finding', criterionId: 'crit_x' },
        existingIssues: [{ id: 42, title: 'Previous issue', criterionId: 'crit_prev' }],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(dedupeRes.ok).toBe(true)
      expect(dedupeRes.isDuplicate).toBe(true)
      expect(dedupeRes.duplicateOf).toBe('42')

      // 2. Queue ordering with numeric choice
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 99,
          confidence: 0.88,
        }),
      })

      const queueRes = await triageQueueOrdering({
        tasks: [
          { id: 10, criterionId: 'crit_10' },
          { id: 99, criterionId: 'crit_99' },
        ],
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(queueRes.ok).toBe(true)
      expect(queueRes.source).toBe('decider')
      expect(queueRes.selectedTaskId).toBe('99')
      expect(queueRes.orderedTasks[0].id).toBe(99)
    })

    it('safely handles special property names in issue dedupe without prototype pollution (N8)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'toString',
        }),
      })

      const existingIssues = [
        { id: '__proto__', title: 'Proto issue', criterionId: 'crit_p' },
        { id: 'toString', title: 'ToString issue', criterionId: 'crit_s' },
        { id: 'constructor', title: 'Constructor issue', criterionId: 'crit_c' },
      ]

      const res = await triageIssueDedupe({
        candidate: { title: 'Some fresh defect', criterionId: 'crit_fresh' },
        existingIssues,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.isDuplicate).toBe(true)
      expect(res.duplicateOf).toBe('toString')
      expect(Object.prototype.hasOwnProperty('__proto__')).toBe(true)
    })
  })

  describe('triage: nudge level (deterministic escalation boundaries and grounded decider)', () => {
    it('evaluates nudge escalation boundaries deterministically without network calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      // Boundary 1: idle < 120s and rework < 2 -> gentle (119s)
      const resGentle = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 119,
        reworkRound: 1,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(resGentle.ok).toBe(true)
      expect(resGentle.source).toBe('deterministic')
      expect(resGentle.level).toBe('gentle')

      // Boundary 2: idle >= 120s and rework < 2 -> standard (120s)
      const resStandard120 = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 120,
        reworkRound: 0,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(resStandard120.ok).toBe(true)
      expect(resStandard120.source).toBe('deterministic')
      expect(resStandard120.level).toBe('standard')

      // Boundary 3: idle 299s and rework < 2 -> standard
      const resStandard299 = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 299,
        reworkRound: 1,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(resStandard299.ok).toBe(true)
      expect(resStandard299.source).toBe('deterministic')
      expect(resStandard299.level).toBe('standard')

      // Boundary 4: idle >= 300s -> interrupt (300s)
      const resInterrupt300 = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 300,
        reworkRound: 0,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(resInterrupt300.ok).toBe(true)
      expect(resInterrupt300.source).toBe('deterministic')
      expect(resInterrupt300.level).toBe('interrupt')

      // Boundary 5: 360s idle (the empirical log case that previously collapsed) -> interrupt
      const resInterrupt360 = await triageNudgeLevel({
        seatTarget: 'unknown',
        idleSeconds: 360,
        reworkRound: 2,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(resInterrupt360.ok).toBe(true)
      expect(resInterrupt360.source).toBe('deterministic')
      expect(resInterrupt360.level).toBe('interrupt')

      // Boundary 6: reworkRound >= 2 -> interrupt even if idle is low
      const resInterruptRound = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 10,
        reworkRound: 2,
        plane: 'external-steering',
        seat: 'steer',
      })
      expect(resInterruptRound.ok).toBe(true)
      expect(resInterruptRound.source).toBe('deterministic')
      expect(resInterruptRound.level).toBe('interrupt')

      // Verify zero network calls were made
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('evaluates nudge level via decider with grounded instructions when useDecider is enabled', async () => {
      let capturedBody = null
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body)
        return {
          ok: true,
          json: async () => ({
            type: 'choice',
            choice: 'standard',
            confidence: 0.91,
          }),
        }
      })

      const res = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 150,
        reworkRound: 0,
        plane: 'external-steering',
        seat: 'steer',
        options: { useDecider: true },
      })

      expect(res.ok).toBe(true)
      expect(res.source).toBe('decider')
      expect(res.level).toBe('standard')
      expect(capturedBody.question.instructions).toBe(GROUNDED_NUDGE_INSTRUCTIONS)
      expect(capturedBody.question.criteria).toEqual(GROUNDED_NUDGE_CRITERIA)
    })

    it('sanitizes seatTarget and lastState before query when useDecider is enabled', async () => {
      let capturedBody = null
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body)
        return {
          ok: true,
          json: async () => ({ type: 'choice', choice: 'gentle' }),
        }
      })

      await triageNudgeLevel({
        seatTarget: 'dev.build-with-token-sk-live-12345678901234567890',
        lastState: 'diff --git a/x b/x\n@@ -1 +1 @@',
        plane: 'external-steering',
        seat: 'steer',
        options: { useDecider: true },
      })

      expect(capturedBody.state.seatTarget).toContain('[REDACTED_SECRET]')
      expect(capturedBody.state.lastState).toBe('[REDACTED_DIFF_CONTENT]')
    })

    it('falls back to deterministic level when decider fails under useDecider', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Decider down'))

      const res = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 350,
        reworkRound: 0,
        plane: 'external-steering',
        seat: 'steer',
        options: { useDecider: true },
      })
      expect(res.level).toBe('interrupt')
      expect(res.source).toBe('fallback')
    })

    it('reports invalid-choice when decider returns invalid nudge level under useDecider', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'choice',
          choice: 'extreme',
        }),
      })

      const res = await triageNudgeLevel({
        seatTarget: 'dev.build',
        idleSeconds: 30,
        plane: 'external-steering',
        seat: 'steer',
        options: { useDecider: true },
      })
      expect(res.ok).toBe(true)
      expect(res.source).toBe('fallback')
      expect(res.fallbackReason).toBe('invalid-choice')
    })
  })

  describe('service availability probe', () => {
    it('returns true when health endpoint returns 200 ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true })
      const available = await isDeciderAvailable()
      expect(available).toBe(true)
    })

    it('returns false for unreachable endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))
      const available = await isDeciderAvailable({
        endpoint: 'http://127.0.0.1:9999/v1/decide',
        timeoutMs: 200,
      })
      expect(available).toBe(false)
    })
  })
})
