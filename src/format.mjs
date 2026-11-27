// The few lines the user sees after Claude's reply.
const MAX_REWRITE = 300;

export function formatMessage(entry) {
  const s = entry.scores;
  const rewrite = entry.rewrite.length > MAX_REWRITE ? `${entry.rewrite.slice(0, MAX_REWRITE)}…` : entry.rewrite;
  const gap = entry.missing?.[0];
  return [
    `Prompt score ${entry.overall}/10 · clarity ${s.clarity} · context ${s.context} · specificity ${s.specificity} · done-criteria ${s.success_criteria}`,
    ...(gap ? [`Biggest gap (${gap.category}): ${gap.note}`] : []),
    `Try: "${rewrite}"`,
  ].join('\n');
}
