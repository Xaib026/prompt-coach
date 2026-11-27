import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldSkip, lastAssistantText, capPrompt } from '../src/input.mjs';

const task = 'fix the 401 in auth.ts when tokens are valid';

for (const p of ['yes', '/prompt-report', '/compact keep the plan please', '  2 ', 'b)', 'go ahead now', '', '   '])
  test(`skips ${JSON.stringify(p)}`, () => assert.ok(shouldSkip(p, {})));

test('grades a real task', () => assert.equal(shouldSkip(task, {}), false));
test('off switch', () => assert.ok(shouldSkip(task, { PROMPT_COACH: 'off' })));
test('skips script runs (sdk entrypoint)', () => assert.ok(shouldSkip(task, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' })));
test('grades interactive entrypoints', () => {
  for (const e of ['cli', 'claude-desktop', undefined]) assert.equal(shouldSkip(task, { CLAUDE_CODE_ENTRYPOINT: e }), false);
});
test('non-string prompt is skipped', () => assert.ok(shouldSkip(undefined, {})));

test('capPrompt cuts a 50 KB paste to 8000', () => assert.equal(capPrompt('x'.repeat(50_000)).length, 8000));
test('capPrompt leaves short prompts alone', () => assert.equal(capPrompt(task), task));

const dir = mkdtempSync(join(tmpdir(), 'pc-tr-'));
const line = (o) => JSON.stringify(o);
const assistant = (...texts) => line({ type: 'assistant', message: { content: texts.map((t) => ({ type: 'text', text: t })) } });

test('lastAssistantText: missing file -> ""', () => assert.equal(lastAssistantText(join(dir, 'nope.jsonl')), ''));
test('lastAssistantText: empty/undefined path -> ""', () => {
  assert.equal(lastAssistantText(''), '');
  assert.equal(lastAssistantText(undefined), '');
});

test('lastAssistantText: last assistant text, garbage ignored, other parts dropped, capped to the end', () => {
  const f = join(dir, 't.jsonl');
  const long = 'a'.repeat(1000) + 'Z'.repeat(1000);
  writeFileSync(f, [
    line({ type: 'user', message: { content: 'hi' } }),
    'not json',
    assistant('first'),
    line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: long }] } }),
    line({ type: 'user', message: { content: 'next' } }),
    '',
  ].join('\n'));
  const out = lastAssistantText(f);
  assert.equal(out.length, 1500);
  assert.ok(out.endsWith('Z'.repeat(1000)));
  assert.ok(!out.includes('hmm'));
});

test('lastAssistantText: skips assistant lines that are only tool calls', () => {
  const f = join(dir, 't2.jsonl');
  writeFileSync(f, [assistant('Which option?'), line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })].join('\n'));
  assert.equal(lastAssistantText(f), 'Which option?');
});

test('lastAssistantText: no assistant turn -> ""', () => {
  const f = join(dir, 't3.jsonl');
  writeFileSync(f, line({ type: 'user', message: { content: 'hi' } }));
  assert.equal(lastAssistantText(f), '');
});

test('final review: grades prompts in languages without spaces', () => {
  assert.equal(shouldSkip('请修复auth.ts中的401错误，令牌有效时仍然失败，并添加测试', {}), false);
  assert.ok(shouldSkip('はい', {}));
  assert.ok(shouldSkip('ok thanks', {}));
});
