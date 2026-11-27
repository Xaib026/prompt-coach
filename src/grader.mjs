// Runs the grader: a separate, lean `claude -p` call that only scores the prompt.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { GRADE_SCHEMA, SYSTEM_PROMPT, validateGrade } from './rubric.mjs';

// No tools, no MCP servers, no user plugins/hooks, nothing saved: fast, cheap, unbiased.
export const graderArgs = (model) => [
  '-p', '--model', model, '--output-format', 'json',
  '--json-schema', JSON.stringify(GRADE_SCHEMA),
  '--tools', '', '--strict-mcp-config', '--setting-sources', '',
  '--no-session-persistence', '--system-prompt', SYSTEM_PROMPT,
];

// Only the folder name: the agent can see the project, the grader just needs to know which one.
export const buildGraderInput = (prompt, previousReply, cwd) =>
  `PROJECT FOLDER (the agent is working inside it): ${cwd ? basename(cwd) : '(unknown)'}\n\n` +
  `PREVIOUS REPLY (context only):\n${previousReply || '(none)'}\n\nPROMPT TO GRADE:\n${prompt}`;

/** Resolves to a Grade, { skip: true }, or null on any failure. Never rejects. */
export function runGrader({ prompt, previousReply, projectDir, model, timeoutMs = 60_000,
  // CLAUDE_CODE_EXECPATH is the Claude Code that's running the hook; the desktop app's copy
  // usually isn't on PATH.
  bin = process.env.PROMPT_COACH_CLAUDE_BIN || process.env.CLAUDE_CODE_EXECPATH || 'claude' }) {
  // An empty folder, so no project CLAUDE.md is picked up.
  const cwd = mkdtempSync(join(tmpdir(), 'prompt-coach-'));
  return new Promise((resolve) => {
    let done = false;
    let out = '';
    let timer;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      resolve(value);
    };
    let child;
    try {
      child = spawn(bin, graderArgs(model), {
        cwd, env: { ...process.env, PROMPT_COACH_GRADING: '1' }, stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch { return finish(null); }
    timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, timeoutMs);
    child.on('error', () => finish(null));
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      try { finish(validateGrade(JSON.parse(out).structured_output)); } catch { finish(null); }
    });
    child.stdin.on('error', () => {}); // child may exit before reading; the exit code decides
    child.stdin.end(buildGraderInput(prompt, previousReply, projectDir));
  });
}
