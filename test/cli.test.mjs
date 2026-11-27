import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { formatMessage, formatQuote } from '../src/format.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const fake = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
chmodSync(fake, 0o755);
const TASK = 'fix the 401 in auth.ts when tokens are valid';

let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'pc-cli-')); });

function hook(cmd, input, extraEnv = {}) {
  const env = { ...process.env, PROMPT_COACH_HOME: home, PROMPT_COACH_CLAUDE_BIN: fake, FAKE_MODE: 'ok', ...extraEnv };
  for (const k of ['CLAUDE_CODE_ENTRYPOINT', 'PROMPT_COACH', 'PROMPT_COACH_GRADING']) if (!(k in extraEnv)) delete env[k];
  const t = Date.now();
  const r = spawnSync(process.execPath, [cli, cmd], {
    input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8',
  });
  return { ...r, ms: Date.now() - t };
}
const prompt = (p, s = 's1') => ({ hook_event_name: 'UserPromptSubmit', session_id: s, prompt: p, cwd: '/proj', transcript_path: '' });
// What the next prompt's hook hands Claude to quote, or '' when nothing is shown.
const next = (s = 's1', env) => {
  const r = hook('on-prompt', prompt('yes', s), env);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
};
const logPath = () => join(home, 'scores.jsonl');
async function waitForLog(n = 1) {
  for (let i = 0; i < 100; i++) {
    if (existsSync(logPath()) && readFileSync(logPath(), 'utf8').trim().split('\n').length >= n) return;
    await sleep(50);
  }
  throw new Error('grader never logged');
}
const jobs = () => (existsSync(join(home, 'jobs')) ? readdirSync(join(home, 'jobs')) : []);

test('on-prompt returns fast, prints nothing on the first prompt', () => {
  const r = hook('on-prompt', prompt(TASK));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
});

test('grade worker logs and leaves pending; next prompt shows it once', async () => {
  hook('on-prompt', prompt(TASK));
  await waitForLog();
  const entry = JSON.parse(readFileSync(logPath(), 'utf8'));
  assert.equal(entry.prompt, TASK);
  assert.equal(entry.session_id, 's1');
  assert.equal(entry.cwd, '/proj');
  assert.equal(entry.model, 'haiku');
  assert.equal(entry.rubric_version, 2);
  assert.equal(entry.overall, 6.3);
  assert.ok(!Number.isNaN(Date.parse(entry.ts)));
  const r = hook('on-prompt', prompt('yes'));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /> \*\*Last prompt: 6\.3\/10\*\*/);
  assert.equal(out.decision, undefined);
  assert.equal(out.systemMessage, undefined);
  assert.equal(next(), '');
  assert.deepEqual(jobs(), []);
});

test('grader is told the project folder name', async () => {
  hook('on-prompt', prompt(TASK), { FAKE_MODE: 'echo-env' });
  await waitForLog();
  assert.match(JSON.parse(readFileSync(logPath(), 'utf8')).rewrite, /PROJECT FOLDER[^\n]*: proj\n/);
});

test('PROMPT_COACH_MODEL is passed through and logged', async () => {
  hook('on-prompt', prompt(TASK), { PROMPT_COACH_MODEL: 'sonnet' });
  await waitForLog();
  assert.equal(JSON.parse(readFileSync(logPath(), 'utf8')).model, 'sonnet');
});

test('grades from another session are not shown here', async () => {
  hook('on-prompt', prompt(TASK, 'other'));
  await waitForLog();
  assert.equal(next('s1'), '');
});

test('skip prompt starts no worker', async () => {
  hook('on-prompt', prompt('yes'));
  await sleep(300);
  assert.deepEqual(jobs(), []);
  assert.equal(existsSync(logPath()), false);
});

test('grader skip:true logs nothing and shows nothing', async () => {
  hook('on-prompt', prompt(TASK), { FAKE_MODE: 'skip' });
  for (let i = 0; i < 40 && jobs().length; i++) await sleep(50);
  await sleep(200);
  assert.equal(existsSync(logPath()), false);
  assert.equal(next(), '');
});

test('grader failure logs nothing and leaves no job behind', async () => {
  hook('on-prompt', prompt(TASK), { FAKE_MODE: 'bad-json' });
  for (let i = 0; i < 40 && jobs().length; i++) await sleep(50);
  await sleep(200);
  assert.equal(existsSync(logPath()), false);
  assert.deepEqual(jobs(), []);
});

test('guard env: hook prints nothing and starts nothing', async () => {
  const g = { PROMPT_COACH_GRADING: '1' };
  assert.equal(hook('on-prompt', prompt(TASK), g).stdout, '');
  await sleep(300);
  assert.deepEqual(jobs(), []);
  assert.equal(existsSync(logPath()), false);
});

test('garbage stdin -> exit 0, no output', () => {
  const r = hook('on-prompt', 'not json{');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('unwritable data dir -> exit 0, no output', () => {
  const file = join(home, 'a-file');
  writeFileSync(file, 'x');
  const r = spawnSync(process.execPath, [cli, 'on-prompt'], {
    input: JSON.stringify(prompt(TASK)), encoding: 'utf8',
    env: { ...process.env, PROMPT_COACH_HOME: join(file, 'sub'), CLAUDE_CODE_ENTRYPOINT: 'cli' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

const entry = (rewrite) => ({ overall: 6.3, scores: { clarity: 8, context: 5, specificity: 6, success_criteria: 6 },
  missing: [{ category: 'no-files', note: 'name the file' }], rewrite });

test('formatMessage: three lines with score, gap and rewrite', () => {
  assert.equal(formatMessage(entry('Fix X in a.ts')), [
    'Prompt score 6.3/10 · clarity 8 · context 5 · specificity 6 · done-criteria 6',
    'Biggest gap (no-files): name the file',
    'Try: "Fix X in a.ts"',
  ].join('\n'));
});

test('formatMessage cuts long rewrite to 300 chars with …', () => {
  const line = formatMessage(entry('x'.repeat(500))).split('\n')[2];
  assert.equal(line, `Try: "${'x'.repeat(300)}…"`);
});

test('formatMessage with no gaps omits the gap line', () => {
  assert.equal(formatMessage({ ...entry('ok'), missing: [] }).split('\n').length, 2);
});

test('final review: pending file holds no prompt text', async () => {
  hook('on-prompt', prompt(TASK));
  await waitForLog();
  const [file] = readdirSync(join(home, 'pending'));
  assert.equal(JSON.parse(readFileSync(join(home, 'pending', file), 'utf8')).prompt, undefined);
  assert.match(next(), /Last prompt: 6\.3/);
});

test('formatQuote: quote block with score and one-line gap', () => {
  const e = { ...entry('ok'), missing: [{ category: 'no-files', note: 'name\n the  file' }] };
  assert.equal(formatQuote(e), [
    '> **Last prompt: 6.3/10** · Clarity 8 · Context 5 · Specificity 6 · Done criteria 6',
    '> **Better:** name the file',
  ].join('\n'));
  assert.equal(formatQuote({ ...e, missing: [] }).split('\n').length, 1);
});
