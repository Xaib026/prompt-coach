// Turns the log into numbers. Claude writes the coaching from these; it never makes numbers up.
import { CRITERIA } from './rubric.mjs';

const DAY = 86_400_000;
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const isEntry = (e) => e && typeof e.overall === 'number' && e.scores && typeof e.scores === 'object';

/** '7d' -> 7, 'all' or nothing -> null (all time). Throws on anything else. */
export function parseWindow(arg) {
  if (arg === undefined || arg === 'all') return null;
  const m = /^(\d+)d$/.exec(arg);
  if (!m || Number(m[1]) < 1) throw new Error(`bad window: ${arg}`);
  return Number(m[1]);
}

export function summarize(entries, { days = null, now = new Date(), skipped = 0 } = {}) {
  const valid = entries.filter(isEntry);
  const age = (e) => now - Date.parse(e.ts);
  const list = days ? valid.filter((e) => age(e) <= days * DAY) : valid;
  const overallIn = (from, to) => avg(list.filter((e) => age(e) > from * DAY && age(e) <= to * DAY).map((e) => e.overall));
  const last7 = overallIn(-Infinity, 7);
  const prev7 = overallIn(7, 14);

  const gaps = new Map();
  for (const e of list) for (const m of e.missing || []) gaps.set(m.category, (gaps.get(m.category) || 0) + 1);

  return {
    window_days: days,
    count: list.length,
    skipped_lines: skipped + entries.length - valid.length,
    averages: Object.fromEntries(CRITERIA.map((c) => [c, avg(list.map((e) => e.scores[c]))])),
    overall_avg: avg(list.map((e) => e.overall)),
    trend: { last7, prev7, delta: last7 !== null && prev7 !== null ? round1(last7 - prev7) : null },
    gap_counts: [...gaps].map(([category, n]) => ({ category, n }))
      .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category)),
    worst: list.slice(-30).sort((a, b) => a.overall - b.overall).slice(0, 3)
      .map(({ ts, prompt, overall, rewrite }) => ({ ts, prompt, overall, rewrite })),
  };
}
