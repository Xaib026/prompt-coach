import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGrade, GRADE_SCHEMA, GAP_CATEGORIES, CRITERIA, RUBRIC_VERSION } from '../src/rubric.mjs';

const good = { skip: false, clarity: 8, context: 5, specificity: 6, success_criteria: 6,
  missing: [{ category: 'no-files', note: 'name the file' }], rewrite: 'Fix X in a.ts' };

test('valid grade gets overall = mean, 1 decimal', () => {
  const g = validateGrade(good);
  assert.equal(g.overall, 6.3);
  assert.deepEqual(g.scores, { clarity: 8, context: 5, specificity: 6, success_criteria: 6 });
  assert.deepEqual(g.missing, good.missing);
  assert.equal(g.rewrite, 'Fix X in a.ts');
  assert.equal(g.skip, false);
});

test('skip grade passes through', () => assert.deepEqual(validateGrade({ skip: true }), { skip: true }));

const bads = [
  null, 'x', [],
  { ...good, clarity: 11 },
  { ...good, context: 0 },
  { ...good, specificity: 6.5 },
  { ...good, missing: [{ category: 'made-up', note: 'n' }] },
  { ...good, missing: [{ category: 'no-files' }] },
  { ...good, missing: 'nope' },
  { ...good, rewrite: '' },
  (({ success_criteria, ...rest }) => rest)(good),
];
for (const bad of bads) test(`rejects ${JSON.stringify(bad)}`, () => assert.equal(validateGrade(bad), null));

test('schema enum matches GAP_CATEGORIES', () =>
  assert.deepEqual(GRADE_SCHEMA.properties.missing.items.properties.category.enum, GAP_CATEGORIES));

test('schema requires every criterion', () => {
  for (const c of CRITERIA) assert.ok(GRADE_SCHEMA.required.includes(c), c);
  assert.equal(RUBRIC_VERSION, 2);
});
