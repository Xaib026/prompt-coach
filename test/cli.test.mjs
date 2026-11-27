import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { formatMessage } from '../src/format.mjs';

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
const stop = (s = 's1') => ({ hook_event_name: 'Stop', session_id: s, stop_hook_active: false });
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

test('grade worker logs and leaves pending; on-stop shows it once', async () => {
  hook('on-prompt', prompt(TASK));
  await waitForLog();
  const entry = JSON.parse(readFileSync(logPath(), 'utf8'));
  assert.equal(entry.prompt, TASK);
  assert.equal(entry.session_id, 's1');
  assert.equal(entry.cwd, '/proj');
  assert.equal(entry.model, 'haiku');
  assert.equal(entry.rubric_version, 1);
  assert.equal(entry.overall, 6.3);
  assert.ok(!Number.isNaN(Date.parse(entry.ts)));
  const r = hook('on-stop', stop());
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.match(out.systemMessage, /Prompt score 6\.3\/10/);
  assert.equal(out.decision, undefined);
  assert.equal(out.hookSpecificOutput, undefined);
  assert.equal(hook('on-stop', stop()).stdout, '');
  assert.deepEqual(jobs(), []);
});

test('PROMPT_COACH_MODEL is passed through and logged', async () => {
  hook('on-prompt', prompt(TASK), { PROMPT_COACH_MODEL: 'sonnet' });
  await waitForLog();
  assert.equal(JSON.parse(readFileSync(logPath(), 'utf8')).model, 'sonnet');
});

test('next on-prompt shows an unshown grade', async () => {
  hook('on-prompt', prompt(TASK));
  await waitForLog();
  const r = hook('on-prompt', prompt('yes'));
  assert.match(JSON.parse(r.stdout).systemMessage, /Prompt score 6\.3\/10/);
});

test('grades from another session are not shown here', async () => {
  hook('on-prompt', prompt(TASK, 'other'));
  await waitForLog();
  assert.equal(hook('on-stop', stop('s1')).stdout, '');
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
  assert.equal(hook('on-stop', stop()).stdout, '');
});

test('grader failure logs nothing and leaves no job behind', async () => {
  hook('on-prompt', prompt(TASK), { FAKE_MODE: 'bad-json' });
  for (let i = 0; i < 40 && jobs().length; i++) await sleep(50);
  await sleep(200);
  assert.equal(existsSync(logPath()), false);
  assert.deepEqual(jobs(), []);
});

test('guard env: both hooks print nothing and start nothing', async () => {
  const g = { PROMPT_COACH_GRADING: '1' };
  assert.equal(hook('on-prompt', prompt(TASK), g).stdout, '');
  assert.equal(hook('on-stop', stop(), g).stdout, '');
  await sleep(300);
  assert.deepEqual(jobs(), []);
  assert.equal(existsSync(logPath()), false);
});

test('garbage stdin -> exit 0, no output', () => {
  for (const cmd of ['on-prompt', 'on-stop']) {
    const r = hook(cmd, 'not json{');
    assert.equal(r.status, 0, cmd);
    assert.equal(r.stdout, '', cmd);
  }
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
  assert.match(JSON.parse(hook('on-stop', stop()).stdout).systemMessage, /Prompt score 6\.3/);
});
