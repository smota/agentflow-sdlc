import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(readFileSync('candidate.txt', 'utf8'), 'AgentFlow public CLI qualification candidate.\n');
