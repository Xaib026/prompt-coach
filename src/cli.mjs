#!/usr/bin/env node
// Entry point for the hooks and the background grader.
//   on-prompt     UserPromptSubmit hook: show any unshown grade, start grading, return at once
//   on-stop       Stop hook: show this session's grade if it's ready
//   grade <job>   background worker started by on-prompt
//   report [win]  numbers for /prompt-report (JSON), or `last` for the newest grade
// Hooks must never get in the user's way: every hook path exits 0, and errors are swallowed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUBRIC_VERSION } from './rubric.mjs';
import { appendEntry, writePending, takePending, writeJob, readJob, readEntries } from './store.mjs';
import { summarize, parseWindow } from './report.mjs';
import { shouldSkip, capPrompt, lastAssistantText } from './input.mjs';
import { runGrader } from './grader.mjs';
import { formatMessage } from './format.mjs';

const model = () => process.env.PROMPT_COACH_MODEL || 'haiku';

function readHookInput() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    return input && typeof input === 'object' ? input : null;
  } catch { return null; }
}

function showPending(sessionId) {
  const entry = takePending(sessionId);
  if (entry) process.stdout.write(JSON.stringify({ systemMessage: formatMessage(entry) }));
}

function onPrompt() {
  const input = readHookInput();
  if (!input) return;
  showPending(input.session_id);
  if (shouldSkip(input.prompt)) return;
  const job = writeJob({
    session_id: input.session_id, cwd: input.cwd, prompt: capPrompt(input.prompt), transcript_path: input.transcript_path,
  });
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'grade', job], { detached: true, stdio: 'ignore' }).unref();
}

function onStop() {
  const input = readHookInput();
  if (input) showPending(input.session_id);
}

async function grade(jobPath) {
  const job = readJob(jobPath);
  if (!job) return;
  const result = await runGrader({ prompt: job.prompt, previousReply: lastAssistantText(job.transcript_path), model: model() });
  if (!result || result.skip) return;
  const entry = {
    ts: new Date().toISOString(), rubric_version: RUBRIC_VERSION, model: model(),
    session_id: job.session_id, cwd: job.cwd, prompt: job.prompt,
    scores: result.scores, overall: result.overall, missing: result.missing, rewrite: result.rewrite,
  };
  appendEntry(entry);
  writePending(job.session_id, entry);
}

// Run by the user (through /prompt-report), not a hook, so it may fail loudly.
function report(arg) {
  const { entries, skipped } = readEntries();
  if (arg === 'last') {
    const newest = entries.at(-1);
    process.stdout.write(newest ? `${formatMessage(newest)}\n` : 'No prompts graded yet.\n');
    return;
  }
  let days;
  try { days = parseWindow(arg); } catch {
    process.stderr.write('usage: report [7d|30d|<N>d|all|last]\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(summarize(entries, { days, skipped }), null, 2)}\n`);
}

async function main([cmd, arg]) {
  if (cmd === 'report') return report(arg);
  // Set on the grader's own `claude -p` call, so its hooks don't grade it again.
  if (process.env.PROMPT_COACH_GRADING) return;
  try {
    if (cmd === 'on-prompt') return onPrompt();
    if (cmd === 'on-stop') return onStop();
    if (cmd === 'grade') return await grade(arg);
  } catch { /* never break the user's session */ }
}

await main(process.argv.slice(2));
