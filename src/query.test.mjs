import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery } from './query.mjs';

test('normalizes whitespace and case', () => {
  assert.equal(normalizeQuery('  AgentFlow TEST  '), 'agentflow test');
});
