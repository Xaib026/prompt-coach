import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graderArgs, buildGraderInput, runGrader } from '../src/grader.mjs';
import { SYSTEM_PROMPT } from '../src/rubric.mjs';

const bin = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
chmodSync(bin, 0o755);

const run = (mode, opts = {}) => {
  process.env.FAKE_MODE = mode;
  return runGrader({ prompt: 'fix the bug in auth.ts', previousReply: 'Done earlier.', model: 'haiku', bin, ...opts });
};

test('ok -> Grade', async () => {
  const g = await run('ok');
  assert.equal(g.overall, 6.3);
  assert.equal(g.skip, false);
});

test('skip -> { skip: true }', async () => assert.deepEqual(await run('skip'), { skip: true }));

for (const m of ['bad-json', 'out-of-range', 'exit1'])
  test(`${m} -> null`, async () => assert.equal(await run(m), null));

test('missing binary -> null', async () => assert.equal(await run('ok', { bin: '/no/such/claude' }), null));

test('hang -> null within timeout', async () => {
  const t = Date.now();
  assert.equal(await run('hang', { timeoutMs: 300 }), null);
  assert.ok(Date.now() - t < 2000);
});

test('child gets guard env, a temp cwd that is removed, and the input on stdin', async () => {
  const g = await run('echo-env');
  assert.match(g.rewrite, /GRADING=1/);
  const childCwd = g.rewrite.match(/^cwd=(\S+) /)[1];
  assert.match(basename(childCwd), /^prompt-coach-/);
  assert.equal(existsSync(childCwd), false);
  assert.match(g.rewrite, /fix the bug in auth\.ts/);
  assert.match(g.rewrite, /Done earlier\./);
});

test('args carry the lean flags, the model and the rubric', () => {
  const a = graderArgs('haiku');
  for (const f of ['-p', '--strict-mcp-config', '--no-session-persistence']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--model') + 1], 'haiku');
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.equal(a[a.indexOf('--setting-sources') + 1], '');
  assert.equal(a[a.indexOf('--output-format') + 1], 'json');
  assert.equal(a[a.indexOf('--system-prompt') + 1], SYSTEM_PROMPT);
  assert.equal(JSON.parse(a[a.indexOf('--json-schema') + 1]).type, 'object');
});

test('input labels both parts, and says when there is no previous reply', () => {
  assert.match(buildGraderInput('do X', ''), /PREVIOUS REPLY[\s\S]*\(none\)[\s\S]*PROMPT TO GRADE:\ndo X$/);
  assert.match(buildGraderInput('do X', 'ok'), /\nok\n/);
});

test('input names only the project folder, not the full path', () => {
  const input = buildGraderInput('do X', '', '/Users/someone/code/prompt-coach');
  assert.match(input, /^PROJECT FOLDER[^\n]*: prompt-coach\n/);
  assert.doesNotMatch(input, /someone/);
  assert.match(buildGraderInput('do X', ''), /^PROJECT FOLDER[^\n]*: \(unknown\)/);
  for (const dir of ['/', homedir()]) assert.match(buildGraderInput('do X', '', dir), /^PROJECT FOLDER[^\n]*: \(unknown\)/);
});

test('final review: uses the running Claude (CLAUDE_CODE_EXECPATH) when no bin is given', async () => {
  const saved = { ...process.env };
  delete process.env.PROMPT_COACH_CLAUDE_BIN;
  process.env.CLAUDE_CODE_EXECPATH = bin;
  // A PATH with only `node` on it (the fake needs it), so a `claude` lookup on PATH would fail.
  const onlyNode = mkdtempSync(join(tmpdir(), 'pc-path-'));
  symlinkSync(process.execPath, join(onlyNode, 'node'));
  process.env.PATH = onlyNode;
  process.env.FAKE_MODE = 'ok';
  try {
    const g = await runGrader({ prompt: 'fix the bug in auth.ts', previousReply: '', model: 'haiku', bin: undefined });
    assert.equal(g?.overall, 6.3);
  } finally { process.env = saved; }
});
