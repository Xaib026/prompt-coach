// Decides which prompts get graded, and gathers what the grader sees.
import { readFileSync } from 'node:fs';

const OPTION_PICK = /^\s*(\d+|[a-d])\s*[.)]?\s*$/i;

export function shouldSkip(prompt, env = process.env) {
  if (env.PROMPT_COACH === 'off') return true;
  // Scripts and SDK runs set an "sdk-*" entrypoint; nobody typed those prompts.
  if ((env.CLAUDE_CODE_ENTRYPOINT || '').startsWith('sdk')) return true;
  if (typeof prompt !== 'string') return true;
  const p = prompt.trim();
  if (p.startsWith('/')) return true;
  if (OPTION_PICK.test(p)) return true;
  return p.split(/\s+/).filter(Boolean).length < 4;
}

export const capPrompt = (prompt, max = 8000) => prompt.slice(0, max);

/** Text of Claude's last reply in the transcript, keeping the end. Never throws. */
export function lastAssistantText(transcriptPath, maxChars = 1500) {
  if (!transcriptPath) return '';
  let lines;
  try { lines = readFileSync(transcriptPath, 'utf8').split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let rec;
    try { rec = JSON.parse(lines[i]); } catch { continue; }
    if (rec?.type !== 'assistant' || !Array.isArray(rec.message?.content)) continue;
    const text = rec.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    if (text) return text.slice(-maxChars);
  }
  return '';
}
