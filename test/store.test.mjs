import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dataDir, safeId, appendEntry, readEntries, writePending, takePending, writeJob, readJob,
} from '../src/store.mjs';

const sample = (over = {}) => ({
  ts: '2026-11-27T10:00:00.000Z', rubric_version: 1, model: 'haiku', session_id: 's1', cwd: '/x',
  prompt: 'fix the bug', scores: { clarity: 8, context: 5, specificity: 6, success_criteria: 6 },
  overall: 6.3, missing: [], rewrite: 'r', ...over,
});

beforeEach(() => { process.env.PROMPT_COACH_HOME = mkdtempSync(join(tmpdir(), 'pc-')) + '/data'; });

test('dataDir follows PROMPT_COACH_HOME', () => assert.equal(dataDir(), process.env.PROMPT_COACH_HOME));

test('first append creates dir 700 and log 600, and later appends keep them', () => {
  appendEntry(sample());
  appendEntry(sample());
  assert.equal(statSync(dataDir()).mode & 0o777, 0o700);
  assert.equal(statSync(join(dataDir(), 'scores.jsonl')).mode & 0o777, 0o600);
  assert.equal(readEntries().entries.length, 2);
});

test('readEntries skips broken lines and counts them', () => {
  appendEntry(sample());
  appendFileSync(join(dataDir(), 'scores.jsonl'), '{"half":\n');
  appendEntry(sample({ overall: 9 }));
  const r = readEntries();
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[1].overall, 9);
  assert.equal(r.skipped, 1);
});

test('readEntries on missing log', () => assert.deepEqual(readEntries(), { entries: [], skipped: 0 }));

test('safeId keeps files inside data dir', () => {
  assert.equal(safeId('../../etc/x'), 'etcx');
  assert.equal(safeId('a3e6e60b-9bf2_X'), 'a3e6e60b-9bf2_X');
  assert.equal(safeId(''), 'unknown');
  assert.equal(safeId(undefined), 'unknown');
  assert.equal(safeId({}), 'unknown');
});

test('pending: newer replaces older, take deletes', () => {
  writePending('s1', sample({ overall: 4 }));
  writePending('s1', sample({ overall: 7 }));
  assert.equal(takePending('s1').overall, 7);
  assert.equal(takePending('s1'), null);
});

test('pending with hostile session id stays in pending dir', () => {
  writePending('../../evil', sample());
  assert.deepEqual(readdirSync(join(dataDir(), 'pending')), ['evil.json']);
  assert.equal(takePending('../../evil').overall, 6.3);
});

test('takePending with no data dir', () => assert.equal(takePending('nobody'), null));

test('job round-trip deletes file', () => {
  const p = writeJob({ session_id: 's', cwd: '/x', prompt: 'p', transcript_path: '' });
  assert.ok(p.startsWith(join(dataDir(), 'jobs')));
  assert.equal(readJob(p).prompt, 'p');
  assert.equal(existsSync(p), false);
});

test('readJob on a missing file', () => assert.equal(readJob(join(dataDir(), 'jobs', 'none.json')), null));
