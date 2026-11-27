// Everything prompt-coach keeps on disk. All of it is local and private to the user.
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const dataDir = () => process.env.PROMPT_COACH_HOME || join(homedir(), '.claude', 'prompt-coach');

const ensureDir = (dir) => { mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
const logPath = () => join(dataDir(), 'scores.jsonl');

/** Session ids come from hook input; reduce them to a safe file name. */
export function safeId(id) {
  const clean = typeof id === 'string' ? id.replace(/[^A-Za-z0-9_-]/g, '') : '';
  return clean || 'unknown';
}

/** One write call per line, so parallel sessions can't interleave half-lines. */
export function appendEntry(entry) {
  ensureDir(dataDir());
  appendFileSync(logPath(), JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export function readEntries() {
  let text;
  try { text = readFileSync(logPath(), 'utf8'); } catch { return { entries: [], skipped: 0 }; }
  const entries = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped++; }
  }
  return { entries, skipped };
}

// Write to a temp name, then rename: a reader never sees a half-written file.
function writeAtomic(dir, name, value) {
  ensureDir(dir);
  const path = join(dir, name);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

// Claim by rename first, so two hooks racing for the same file can't both get it.
function takeFile(path) {
  const claimed = `${path}.${process.pid}.taking`;
  try { renameSync(path, claimed); } catch { return null; }
  try { return JSON.parse(readFileSync(claimed, 'utf8')); } catch { return null; } finally {
    try { unlinkSync(claimed); } catch { /* already gone */ }
  }
}

const pendingDir = () => join(dataDir(), 'pending');

export const writePending = (sessionId, entry) => { writeAtomic(pendingDir(), `${safeId(sessionId)}.json`, entry); };
export const takePending = (sessionId) => takeFile(join(pendingDir(), `${safeId(sessionId)}.json`));

export const writeJob = (job) => writeAtomic(join(dataDir(), 'jobs'), `${safeId(job.session_id)}-${Date.now()}.json`, job);
export const readJob = (path) => takeFile(path);
