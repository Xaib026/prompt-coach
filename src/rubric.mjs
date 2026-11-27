// The fixed grading rubric. Bump RUBRIC_VERSION whenever the criteria, scale or
// wording change, so the report can tell old scores from new ones.
export const RUBRIC_VERSION = 2;

export const CRITERIA = ['clarity', 'context', 'specificity', 'success_criteria'];

export const GAP_CATEGORIES = [
  'vague-goal', 'no-files', 'no-error-text', 'no-examples',
  'no-constraints', 'no-done-criteria', 'missing-background',
];

const score = { type: 'integer', minimum: 1, maximum: 10 };

export const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    skip: { type: 'boolean' },
    ...Object.fromEntries(CRITERIA.map((c) => [c, score])),
    missing: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: { category: { type: 'string', enum: GAP_CATEGORIES }, note: { type: 'string' } },
        required: ['category', 'note'],
      },
    },
    rewrite: { type: 'string' },
  },
  required: ['skip', ...CRITERIA, 'missing', 'rewrite'],
};

export const SYSTEM_PROMPT = `You grade prompts that a developer wrote to Claude Code, an AI coding agent.
You are a coach: honest, specific, never generous. You do not answer the prompt.

You get the developer's PROMPT and, for context only, the PROJECT FOLDER the agent is working
in and the agent's PREVIOUS REPLY in the same conversation (may be empty). Grade only the PROMPT.
The agent can read every file in that project, so "this repo", "this plugin" or "this app"
clearly means the project itself: do not mark the prompt down for not naming or describing it.
Use the previous reply to judge whether a follow-up like "now do the same for auth" is clear in context.

If the PROMPT is just a reply to a question the agent asked (for example "yes", "option B",
"go ahead with the second one"), set skip to true and fill the other fields with any valid values.

Otherwise set skip to false and score each criterion from 1 (poor) to 10 (excellent):
- clarity: is it obvious what is being asked?
- context: does the agent have the files, background, constraints and audience it needs?
- specificity: concrete details (names, error text, examples) rather than vague wishes?
- success_criteria: does it say what "done" or "good" looks like?

missing: up to 3 gaps that would most improve the prompt, most important first, each with one
category from the allowed list and a short note in plain words naming exactly what to add.
rewrite: an improved version of the prompt the developer could paste instead. Keep their
intent and voice. Where you would need facts you do not have, use a short <placeholder>.`;

const isScore = (n) => Number.isInteger(n) && n >= 1 && n <= 10;
const isGap = (m) => m && GAP_CATEGORIES.includes(m.category) && typeof m.note === 'string' && m.note.length > 0;

/** Checks the grader's raw answer. Returns a Grade, { skip: true }, or null if anything is off. */
export function validateGrade(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.skip === true) return { skip: true };
  if (raw.skip !== false) return null;
  if (!CRITERIA.every((c) => isScore(raw[c]))) return null;
  if (!Array.isArray(raw.missing) || raw.missing.length > 3 || !raw.missing.every(isGap)) return null;
  if (typeof raw.rewrite !== 'string' || raw.rewrite.trim() === '') return null;
  const scores = Object.fromEntries(CRITERIA.map((c) => [c, raw[c]]));
  const overall = Math.round((CRITERIA.reduce((s, c) => s + raw[c], 0) / CRITERIA.length) * 10) / 10;
  return {
    skip: false,
    scores,
    overall,
    missing: raw.missing.map(({ category, note }) => ({ category, note })),
    rewrite: raw.rewrite,
  };
}
