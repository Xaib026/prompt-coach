#!/usr/bin/env node
// Stands in for `claude -p` in tests. Behavior is picked with FAKE_MODE.
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE || 'ok';
  const grade = { skip: false, clarity: 8, context: 5, specificity: 6, success_criteria: 6,
    missing: [{ category: 'no-files', note: 'name the file' }], rewrite: 'Fix X in a.ts' };
  const out = (structured_output) => process.stdout.write(JSON.stringify({ type: 'result', structured_output }));
  switch (mode) {
    case 'ok': return out(grade);
    case 'skip': return out({ ...grade, skip: true });
    case 'out-of-range': return out({ ...grade, clarity: 11 });
    case 'bad-json': return process.stdout.write('not json');
    case 'exit1': out(grade); return process.exit(1);
    case 'hang': return setInterval(() => {}, 1000);
    case 'echo-env':
      return out({ ...grade, rewrite: `cwd=${process.cwd()} GRADING=${process.env.PROMPT_COACH_GRADING} input=${input}` });
  }
});
