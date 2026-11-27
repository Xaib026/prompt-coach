import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, parseWindow } from '../src/report.mjs';
import { RUBRIC_VERSION } from '../src/rubric.mjs';

const now = new Date('2026-11-27T12:00:00Z');
const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();
const e = (d, [clarity, context, specificity, success_criteria], gaps = [], prompt = `p${d}`) => ({
  ts: daysAgo(d), rubric_version: RUBRIC_VERSION, prompt, rewrite: `r${d}`, scores: { clarity, context, specificity, success_criteria },
  overall: Math.round(((clarity + context + specificity + success_criteria) / 4) * 10) / 10,
  missing: gaps.map((category) => ({ category, note: 'n' })),
});

const three = [
  e(10, [8, 4, 6, 2], ['no-files', 'no-done-criteria']),
  e(2, [6, 6, 6, 6], ['no-done-criteria']),
  e(1, [10, 8, 8, 6], ['no-done-criteria', 'vague-goal']),
];

test('averages and gap counts', () => {
  const r = summarize(three, { now });
  assert.equal(r.count, 3);
  assert.deepEqual(r.averages, { clarity: 8, context: 6, specificity: 6.7, success_criteria: 4.7 });
  assert.equal(r.overall_avg, 6.3);
  assert.deepEqual(r.gap_counts, [
    { category: 'no-done-criteria', n: 3 }, { category: 'no-files', n: 1 }, { category: 'vague-goal', n: 1 },
  ]);
});

test('trend: last 7 days vs previous 7', () => {
  const r = summarize(three, { now });
  assert.deepEqual(r.trend, { last7: 7, prev7: 5, delta: 2 });
});

test('trend ignores grades from an older rubric, averages keep them', () => {
  const old = { ...e(10, [2, 2, 2, 2]), rubric_version: RUBRIC_VERSION - 1 };
  const r = summarize([old, e(1, [6, 6, 6, 6])], { now });
  assert.deepEqual(r.trend, { last7: 6, prev7: null, delta: null });
  assert.equal(r.overall_avg, 4);
});

test('trend null when a week has no data', () => {
  const r = summarize([e(1, [5, 5, 5, 5])], { now });
  assert.deepEqual(r.trend, { last7: 5, prev7: null, delta: null });
});

test('worst = lowest 3 of newest 30, lowest first', () => {
  const many = Array.from({ length: 35 }, (_, i) => e(40 - i, [i < 5 ? 1 : 9, 9, 9, 9], [], `old${i}`));
  many.push(e(0.5, [2, 2, 2, 2], [], 'bad'), e(0.4, [3, 3, 3, 3], [], 'meh'));
  const r = summarize(many, { now });
  assert.deepEqual(r.worst.map((w) => w.prompt), ['bad', 'meh', 'old7']);
  assert.deepEqual(Object.keys(r.worst[0]).sort(), ['overall', 'prompt', 'rewrite', 'ts']);
});

test('window 7d drops older entries', () => {
  const r = summarize(three, { days: 7, now });
  assert.equal(r.count, 2);
  assert.equal(r.window_days, 7);
});

test('empty log -> count 0, nulls, no throw', () => {
  const r = summarize([], { now });
  assert.equal(r.count, 0);
  assert.equal(r.overall_avg, null);
  assert.deepEqual(r.gap_counts, []);
  assert.deepEqual(r.worst, []);
});

test('parseWindow', () => {
  assert.equal(parseWindow(undefined), null);
  assert.equal(parseWindow('all'), null);
  assert.equal(parseWindow('7d'), 7);
  assert.equal(parseWindow('30d'), 30);
  for (const bad of ['abc', '0d', '-3d', '7']) assert.throws(() => parseWindow(bad), bad);
});

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const report = (home, ...args) => spawnSync(process.execPath, [cli, 'report', ...args], {
  env: { ...process.env, PROMPT_COACH_HOME: home }, encoding: 'utf8',
});

test('cli report prints JSON with skipped_lines', () => {
  const home = mkdtempSync(join(tmpdir(), 'pc-rep-'));
  writeFileSync(join(home, 'scores.jsonl'), three.map((x) => JSON.stringify(x)).join('\n') + '\n{"half":\n{}\n');
  const r = report(home, 'all');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.count, 3);
  assert.equal(out.skipped_lines, 2);
});

test('cli report last prints the newest grade', () => {
  const home = mkdtempSync(join(tmpdir(), 'pc-rep-'));
  writeFileSync(join(home, 'scores.jsonl'), three.map((x) => JSON.stringify(x)).join('\n') + '\n');
  assert.match(report(home, 'last').stdout, /^Prompt score 8\/10/);
});

test('cli report last with no log says so', () => {
  assert.match(report(mkdtempSync(join(tmpdir(), 'pc-rep-')), 'last').stdout, /No prompts graded yet/);
});

test('cli report with a bad window exits 1 with usage', () => {
  const r = report(mkdtempSync(join(tmpdir(), 'pc-rep-')), 'abc');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});
