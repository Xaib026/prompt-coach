# Prompt Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that grades each prompt in the background with Haiku, shows the score after Claude's reply, logs it locally, and reports patterns with `/prompt-report`.

**Architecture:** A `UserPromptSubmit` hook writes a job file and starts a detached worker, then returns at once. The worker runs `claude -p` with a fixed rubric and JSON schema, validates the result, and appends it to a local JSONL log plus a per-session "pending" file. A `Stop` hook (and the next `UserPromptSubmit`) shows that pending file as a `systemMessage`. A report script turns the log into numbers, and a skill has Claude coach from them.

**Tech Stack:** Node.js ≥ 18, ES modules, no npm dependencies, `node:test` for tests, `sh` launcher, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-27-prompt-coach-design.md`

## Global Constraints

- No npm dependencies; Node ≥ 18 built-ins only. `package.json` has `"type": "module"`.
- Every hook path exits 0. A hook never blocks a prompt, never uses `decision`, and never writes `additionalContext`.
- The `UserPromptSubmit` hook only starts grading and returns; it never waits for the grader.
- The recursion guard env var is `PROMPT_COACH_GRADING=1`. Both hooks exit 0 silently when it's set.
- `PROMPT_COACH=off` disables everything. `PROMPT_COACH_MODEL` overrides the grader model (default `haiku`).
- Data dir: `$PROMPT_COACH_HOME` or else `~/.claude/prompt-coach`, created with mode 700. The log is `scores.jsonl` (mode 600); pending files go in `pending/`, job files in `jobs/`.
- Rubric criteria, scored 1–10: `clarity`, `context`, `specificity`, `success_criteria`. `RUBRIC_VERSION = 1`. Overall = mean of the four, rounded to 1 decimal, computed in code.
- Gap categories (fixed): `vague-goal`, `no-files`, `no-error-text`, `no-examples`, `no-constraints`, `no-done-criteria`, `missing-background`.
- Grader timeout 60s, then SIGKILL. Previous reply cut to 1,500 chars. Prompt cut to 8,000 chars for both grading and logging.
- Grader runs from a fresh temp dir with `--tools ""`, `--strict-mcp-config`, no setting sources, and `--no-session-persistence`. The exact flag spellings come from Task 0's notes.
- Platforms: macOS and Linux (Windows via WSL). CI runs on `ubuntu-latest` and `macos-latest`.

## Review Focus

1. **A huge pasted prompt** (e.g. a 50 KB log). It's cut to 8,000 chars before grading and logging, not sent or stored whole. Test in Task 3.
2. **A hostile or odd `session_id`** (`../../etc/x`, empty). It's sanitized to `[A-Za-z0-9_-]` (empty becomes `unknown`), so files stay inside the data dir. Test in Task 2.
3. **A missing or odd transcript** (no file, no assistant turn, non-JSON lines). The previous reply is `""` and grading still happens. Test in Task 3.
4. **Grader output that's malformed or out of range** (bad JSON, a score of 11, an unknown gap category, missing fields). Nothing is logged or shown. Test in Task 1.
5. **First run on a clean machine.** The data dir is created as 700 and the log as 600, and later appends keep those modes. Test in Task 2.

---

### Task 0: Verify platform assumptions (spike, no product code)

**Files:**
- Create: `docs/notes/verification.md`

The design rests on four things nobody has tested yet. Find out each one, and write the answer and the exact commands into the notes file. Later tasks read it.

- [ ] **Step 1: Find the lean grader command.** Run `claude -p` from `mktemp -d` with `--model haiku --output-format json --json-schema '<small schema>' --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --system-prompt "<short>"`. If `--setting-sources ""` is rejected, try the nearest form that loads no user plugins. Confirm it works with the normal (OAuth) login, and record the wall time and `total_cost_usd` over 3 runs. Expected: it works, and it's well under the 12.5–14s / $0.007–0.011 baseline.
- [ ] **Step 2: Check whether hook messages show.** Install a throwaway Stop hook that prints `{"systemMessage":"coach test"}`. Note where the text appears: CLI, desktop Code tab, VS Code. Then do the same for `UserPromptSubmit`.
- [ ] **Step 3: Check the transcript format.** From one real session's `transcript_path`, record the JSON shape of an assistant text line (expected: `type: "assistant"`, `message.content[]` items with `type: "text"`).
- [ ] **Step 4: Look for a non-interactive signal.** Dump the stdin of a `UserPromptSubmit` hook in an interactive session and in a `claude -p` session. Record any field that tells them apart, or "none".
- [ ] **Step 5: Check the skill path variable.** Confirm whether `${CLAUDE_PLUGIN_ROOT}` is substituted inside a plugin skill's `SKILL.md`. If it isn't, record the fallback (a `commands/` file with an inline `!` shell line).
- [ ] **Step 6: Remove the throwaway hooks and commit the notes.**

```bash
git init && git add docs && git commit -m "docs: design, plan, platform verification notes"
```

If Step 1 can't run with the user's login without loading their plugins, **stop and report**. The design's cost/latency promise depends on it.

---

### Task 1: Scaffold and rubric

**Files:**
- Create: `package.json`, `.gitignore`, `src/rubric.mjs`
- Test: `test/rubric.test.mjs`

**Interfaces:**
- Produces:
  - `RUBRIC_VERSION: 1`, `CRITERIA: string[]`, `GAP_CATEGORIES: string[]`
  - `SYSTEM_PROMPT: string`, `GRADE_SCHEMA: object` (JSON Schema)
  - `validateGrade(raw: unknown) -> Grade | null`
  - `Grade = { skip: boolean, scores: {clarity, context, specificity, success_criteria}, overall: number, missing: {category, note}[], rewrite: string }`

`GRADE_SCHEMA` is the shape the grader returns: `skip` (boolean), the four criteria as top-level integers (1–10), `missing` (an array of up to 3 `{category, note}` items, with `category` drawn from the enum), and `rewrite` (a string). All fields are required. `validateGrade` turns that into a `Grade`, nesting the four scores under `scores` and adding `overall`. When `skip` is true it returns `{ skip: true }` and ignores the rest.

`SYSTEM_PROMPT` tells the grader to:
- score only the user's prompt, using the previous reply only as context;
- set `skip: true` when the prompt is just a reply to a question the assistant asked;
- write a `rewrite` the user could paste in place of the original.

- [ ] **Step 1: Write the failing tests**

```js
test('valid grade gets overall = mean, 1 decimal', () => {
  const g = validateGrade({ skip:false, clarity:8, context:5, specificity:6, success_criteria:6,
    missing:[{category:'no-files', note:'name the file'}], rewrite:'Fix X in a.ts' });
  assert.equal(g.overall, 6.3);
  assert.deepEqual(g.scores, { clarity:8, context:5, specificity:6, success_criteria:6 });
});
test('skip grade passes through', () => assert.deepEqual(validateGrade({ skip:true }), { skip:true }));
for (const bad of [null, 'x', {skip:false, clarity:11, context:5, specificity:6, success_criteria:6, missing:[], rewrite:'r'},
  {skip:false, clarity:8, context:5, specificity:6, success_criteria:6, missing:[{category:'made-up', note:'n'}], rewrite:'r'},
  {skip:false, clarity:8, context:5, specificity:6, missing:[], rewrite:'r'}])
  test(`rejects ${JSON.stringify(bad)}`, () => assert.equal(validateGrade(bad), null));
test('schema enum matches GAP_CATEGORIES', () =>
  assert.deepEqual(GRADE_SCHEMA.properties.missing.items.properties.category.enum, GAP_CATEGORIES));
```

- [ ] **Step 2: Run them to see them fail.** `node --test test/` → FAIL (module not found).
- [ ] **Step 3: Implement `src/rubric.mjs`.** Add `package.json` (`"type":"module"`, `"engines":{"node":">=18"}`, `"scripts":{"test":"node --test test/"}`) and `.gitignore` (`node_modules`, `.DS_Store`).
- [ ] **Step 4: Run the tests to see them pass.** `npm test` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: rubric, schema and grade validation"`

---

### Task 2: Storage (log, pending, jobs)

**Files:**
- Create: `src/store.mjs`
- Test: `test/store.test.mjs`

**Interfaces:**
- Produces:
  - `dataDir() -> string`
  - `safeId(id: unknown) -> string`
  - `appendEntry(entry: Entry) -> void`
  - `readEntries() -> { entries: Entry[], skipped: number }`
  - `writePending(sessionId, entry) -> void`
  - `takePending(sessionId) -> Entry | null`, which reads the file and then deletes it
  - `writeJob(job: Job) -> string` (returns the path)
  - `readJob(path) -> Job | null`, which reads the file and then deletes it
  - `Entry = { ts: string (ISO), rubric_version, model, session_id, cwd, prompt, scores, overall, missing, rewrite }`
  - `Job = { session_id, cwd, prompt, transcript_path }`

Notes:
- Each log line is written with a single `fs.appendFileSync(path, JSON.stringify(e) + '\n', { mode: 0o600 })`.
- Directories are created with `{ recursive: true, mode: 0o700 }`.
- Pending files are written to a temp name and then renamed, so the Stop hook never reads a half-written file.
- Job files are named `${safeId}-${Date.now()}.json`.

- [ ] **Step 1: Write the failing tests.** Each test sets `process.env.PROMPT_COACH_HOME` to a fresh `mkdtemp` dir.

```js
test('first append creates dir 700 and log 600', () => {
  appendEntry(sample());
  assert.equal(statSync(dataDir()).mode & 0o777, 0o700);
  assert.equal(statSync(join(dataDir(),'scores.jsonl')).mode & 0o777, 0o600);
});
test('readEntries skips broken lines and counts them', () => {
  appendEntry(sample()); appendFileSync(join(dataDir(),'scores.jsonl'), '{"half":');
  appendFileSync(join(dataDir(),'scores.jsonl'), '\n'); appendEntry(sample());
  const r = readEntries(); assert.equal(r.entries.length, 2); assert.equal(r.skipped, 1);
});
test('readEntries on missing log', () => assert.deepEqual(readEntries(), { entries: [], skipped: 0 }));
test('safeId keeps files inside data dir', () => {
  assert.equal(safeId('../../etc/x'), 'etcx'); assert.equal(safeId(''), 'unknown'); assert.equal(safeId(undefined), 'unknown');
});
test('pending: newer replaces older, take deletes', () => {
  writePending('s1', {...sample(), overall: 4}); writePending('s1', {...sample(), overall: 7});
  assert.equal(takePending('s1').overall, 7); assert.equal(takePending('s1'), null);
});
test('job round-trip deletes file', () => {
  const p = writeJob({ session_id:'s', cwd:'/x', prompt:'p', transcript_path:'' });
  assert.equal(readJob(p).prompt, 'p'); assert.equal(existsSync(p), false);
});
```

- [ ] **Step 2: Run them to see them fail.** `npm test` → FAIL.
- [ ] **Step 3: Implement `src/store.mjs`** with the interfaces above.
- [ ] **Step 4: Run the tests to see them pass.** `npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: local log, pending and job storage"`

---

### Task 3: Skip rules and grader input

**Files:**
- Create: `src/input.mjs`
- Test: `test/input.test.mjs`

**Interfaces:**
- Produces:
  - `shouldSkip(prompt: string, env = process.env) -> boolean`
  - `lastAssistantText(transcriptPath: string, maxChars = 1500) -> string`, which never throws
  - `capPrompt(prompt: string, max = 8000) -> string`

Notes:
- **Skip** when any of these is true:
  - `env.PROMPT_COACH === 'off'`;
  - the trimmed prompt starts with `/`;
  - it has fewer than 4 words;
  - it matches `/^\s*(\d+|[a-d])\s*[.)]?\s*$/i`.
  - the hook input carries the "non-interactive" signal Task 0 Step 4 found, if it found one. In that case `shouldSkip` takes `(prompt, env, hookInput = {})` and gets one extra test.
- **`lastAssistantText`** reads the JSONL file and keeps the text parts of the last assistant line, using the shape from Task 0's notes. It skips lines that aren't JSON, and keeps the **last** `maxChars` characters.

- [ ] **Step 1: Write the failing tests**

```js
for (const p of ['yes', '/prompt-report', '  2 ', 'b)', 'go ahead now']) test(`skips ${p}`, () => assert.ok(shouldSkip(p, {})));
test('grades a real task', () => assert.equal(shouldSkip('fix the 401 in auth.ts when tokens are valid', {}), false));
test('off switch', () => assert.ok(shouldSkip('fix the 401 in auth.ts when tokens are valid', { PROMPT_COACH: 'off' })));
test('capPrompt cuts a 50 KB paste to 8000', () => assert.equal(capPrompt('x'.repeat(50_000)).length, 8000));
test('lastAssistantText: missing file -> ""', () => assert.equal(lastAssistantText('/nope/t.jsonl'), ''));
test('lastAssistantText: last assistant text, garbage lines ignored, capped', () => {
  // fixture: user line, "not json", assistant "first", assistant with 2000-char text
  assert.equal(lastAssistantText(fixture).length, 1500);
});
test('lastAssistantText: no assistant turn -> ""', () => assert.equal(lastAssistantText(userOnlyFixture), ''));
```

- [ ] **Step 2: Run them to see them fail.** `npm test` → FAIL.
- [ ] **Step 3: Implement `src/input.mjs`.**
- [ ] **Step 4: Run the tests to see them pass.** `npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: skip rules and grader input"`

---

### Task 4: Grader runner

**Files:**
- Create: `src/grader.mjs`
- Test: `test/grader.test.mjs`, `test/fixtures/fake-claude.mjs`

**Interfaces:**
- Consumes: `SYSTEM_PROMPT`, `GRADE_SCHEMA`, `validateGrade` (Task 1)
- Produces:
  - `graderArgs(model: string) -> string[]`
  - `buildGraderInput(prompt: string, previousReply: string) -> string`
  - `runGrader({ prompt, previousReply, model, timeoutMs = 60_000, bin = process.env.PROMPT_COACH_CLAUDE_BIN || 'claude' }) -> Promise<Grade | null>`

Notes:
- **`graderArgs`** returns the lean flag set recorded in Task 0, plus `--model`, `--output-format json`, `--json-schema JSON.stringify(GRADE_SCHEMA)` and `--system-prompt SYSTEM_PROMPT`.
- **The input text** is passed on stdin, with the previous reply and the prompt clearly labelled.
- **How `runGrader` runs the grader:**
  - it spawns with `cwd` set to a fresh `mkdtemp`;
  - it sets `env` to `{ ...process.env, PROMPT_COACH_GRADING: '1' }`;
  - it kills the child with SIGKILL when the timeout hits.
- **How it reads the result:** it parses stdout as JSON and takes `.structured_output`, then runs it through `validateGrade`.
- **On any failure** it returns `null`: a spawn error, a non-zero exit, bad JSON, or a timeout. The temp dir is always removed.
- **The fake CLI** (`fake-claude.mjs`) behaves according to `FAKE_MODE`: `ok`, `skip`, `bad-json`, `out-of-range`, `hang`, `exit1` or `echo-env`. In `echo-env` mode it puts its `cwd` and `PROMPT_COACH_GRADING` into `rewrite`.

- [ ] **Step 1: Write the failing tests** (`bin` set to the fake, via a `sh` wrapper or `process.execPath`).

```js
test('ok -> Grade', async () => assert.equal((await run('ok')).overall, 6.3));
for (const m of ['bad-json', 'out-of-range', 'exit1']) test(`${m} -> null`, async () => assert.equal(await run(m), null));
test('hang -> null within timeout', async () => {
  const t = Date.now(); assert.equal(await run('hang', { timeoutMs: 300 }), null); assert.ok(Date.now() - t < 2000);
});
test('child gets guard env and a temp cwd', async () => {
  const g = await run('echo-env'); assert.match(g.rewrite, /GRADING=1/); assert.doesNotMatch(g.rewrite, new RegExp(process.cwd()));
});
test('args carry the lean flags and the model', () => {
  const a = graderArgs('haiku'); assert.ok(a.includes('--strict-mcp-config')); assert.equal(a[a.indexOf('--model') + 1], 'haiku');
});
```

- [ ] **Step 2: Run them to see them fail.** `npm test` → FAIL.
- [ ] **Step 3: Implement `src/grader.mjs`** and the fake.
- [ ] **Step 4: Run the tests to see them pass.** `npm test` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: background grader runner with timeout"`

---

### Task 5: Hooks, worker and plugin packaging

**Files:**
- Create:
  - `src/cli.mjs` and `src/format.mjs`
  - `scripts/run.sh`
  - `hooks/hooks.json`
  - `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `formatMessage(entry: Entry) -> string`
  - `node src/cli.mjs on-prompt`, `on-stop` and `grade <jobPath>`

Notes:
- **`formatMessage`** returns three lines. The rewrite is cut to 300 chars, with `…` when cut:
  ```
  Prompt score 6.3/10 · clarity 8 · context 5 · specificity 6 · done-criteria 6
  Biggest gap (no-files): name the file
  Try: "Fix X in a.ts"
  ```
- **`on-prompt`:**
  1. Read the hook JSON from stdin.
  2. If `PROMPT_COACH_GRADING` is set, exit.
  3. If this session has a pending grade, take it and print `{"systemMessage": formatMessage(...)}`.
  4. If `shouldSkip`, exit.
  5. Otherwise write the job, then spawn `process.execPath cli.mjs grade <job>` with `detached: true`, `stdio: 'ignore'` and `.unref()`.
  6. Exit 0. Wrap everything in try/catch, and exit 0 on any error.
- **`on-stop`:** guard as above, then take the session's pending grade and print it. It prints no `decision`, ever.
- **`grade <jobPath>`:**
  1. `readJob`.
  2. `runGrader`, using `lastAssistantText(job.transcript_path)` and `capPrompt(job.prompt)`.
  3. If the grade is null or `skip`, stop.
  4. Otherwise build the `Entry` (with `model = PROMPT_COACH_MODEL || 'haiku'`), then call `appendEntry` and `writePending`.
- **`run.sh`:** `command -v node >/dev/null 2>&1 || exit 0; node "$(dirname "$0")/../src/cli.mjs" "$@" || exit 0`.
- **`hooks.json`:**
  - `UserPromptSubmit` → `sh "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" on-prompt`
  - `Stop` → `sh "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh" on-stop`
- **`plugin.json`:** name `prompt-coach`, version `0.1.0`, description, MIT license.
- **`marketplace.json`:** one plugin with source `./`.

- [ ] **Step 1: Write the failing tests.** Each test runs the real CLI as a child process with `PROMPT_COACH_HOME` set to a temp dir and `PROMPT_COACH_CLAUDE_BIN` pointing to the fake.

```js
test('on-prompt returns fast and prints nothing on first prompt', ...);          // < 500 ms, stdout ''
test('grade worker logs and leaves pending; on-stop shows it once', ...);        // after waiting for the log line: on-stop stdout has systemMessage matching /Prompt score 6.3\/10/, second on-stop prints ''
test('next on-prompt shows an unshown grade', ...);
test('skip prompt starts no worker', ...);                                       // 'yes' -> no job file, no log line
test('grader skip:true logs nothing', ...);                                      // FAKE_MODE=skip
test('guard env: both hooks print nothing and start nothing', ...);
test('garbage stdin -> exit 0, no output', ...);
test('formatMessage cuts long rewrite to 300 chars with …', ...);
```

- [ ] **Step 2: Run them to see them fail.** `npm test` → FAIL.
- [ ] **Step 3: Implement** the CLI, the formatter, the launcher and the plugin files.
- [ ] **Step 4: Run the tests to see them pass.** `npm test` → PASS. Then run `sh -n scripts/run.sh` and `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json'))"` to check syntax.
- [ ] **Step 5: Live check.** Run `claude --plugin-dir .`. Send a real prompt and confirm the score appears after the reply, on the surfaces Task 0 found. Confirm that `yes` shows nothing.
- [ ] **Step 6: Commit.** `git commit -m "feat: hooks, background worker and plugin packaging"`

---

### Task 6: `/prompt-report`

**Files:**
- Create: `src/report.mjs`, `skills/prompt-report/SKILL.md` (or the `commands/` fallback from Task 0)
- Modify: `src/cli.mjs` (add `report [window]`)
- Test: `test/report.test.mjs`

**Interfaces:**
- Consumes: `readEntries` (Task 2), `formatMessage` (Task 5)
- Produces:
  - `parseWindow(arg?: string) -> number | null` (days; `'7d'` → 7, `'all'`/undefined → null; anything else throws)
  - `summarize(entries, { days = null, now = new Date() }) -> Report`
  - `node src/cli.mjs report [7d|30d|all|last]` prints the `Report` JSON; `last` prints `formatMessage` of the newest entry
- `Report` contains:
  - `count`, `skipped_lines`
  - `averages` (per criterion), `overall_avg`
  - `trend`: `{ last7, prev7, delta }`. Each is an average of `overall`, or `null` when there's no data.
  - `gap_counts`: `[{ category, n }]`, sorted by `n` descending
  - `worst`: up to 3 `{ ts, prompt, overall, rewrite }`, the lowest `overall` among the newest 30 entries

The skill tells Claude to run the report command with the user's argument. If `count` is 0, it says so and explains how scoring starts. Otherwise it writes a short coaching summary:
- the weakest criterion;
- whether the trend is up or down;
- the top two gaps, in plain words;
- the worst prompts, each with its rewrite.

All numbers come from the JSON; Claude makes none up.

- [ ] **Step 1: Write the failing tests**

```js
test('averages and gap counts', ...);                       // 3 fixture entries -> exact averages, gap_counts sorted
test('trend: last 7 days vs previous 7', ...);              // fixed `now`, entries at -2d and -10d -> delta exact
test('trend null when a week has no data', ...);
test('worst = lowest 3 of newest 30', ...);
test('window 7d drops older entries', ...);
test('empty log -> count 0, no throw', ...);
test('parseWindow rejects "abc"', () => assert.throws(() => parseWindow('abc')));
```

- [ ] **Step 2: Run them to see them fail.** `npm test` → FAIL.
- [ ] **Step 3: Implement** `summarize`, `parseWindow`, the CLI `report` command and the skill. A bad window prints a one-line usage message to stderr and exits 1, which is fine here because this isn't a hook.
- [ ] **Step 4: Run the tests to see them pass.** `npm test` → PASS. Then, in `claude --plugin-dir .`, run `/prompt-report` and `/prompt-report last`, and check that the numbers match the JSON.
- [ ] **Step 5: Commit.** `git commit -m "feat: /prompt-report patterns over time"`

---

### Task 7: README, license and CI

**Files:**
- Create: `README.md`, `LICENSE` (MIT, `Copyright (c) 2026 xaib026 (Shoaib Hussain)`), `.github/workflows/test.yml`

- **The README covers:**
  - what it does, with an example `systemMessage`;
  - install: `/plugin marketplace add <owner>/prompt-coach` then `/plugin install prompt-coach@prompt-coach`;
  - how scoring works: the four criteria, the background grade, and when it shows;
  - **real time and cost numbers from Task 0**;
  - privacy: prompts are stored locally at `~/.claude/prompt-coach/scores.jsonl` (mode 600) and graded only through the user's own Claude call, and `rm ~/.claude/prompt-coach/scores.jsonl` clears them;
  - the switches: `PROMPT_COACH=off` (set it in CI and scripts) and `PROMPT_COACH_MODEL`;
  - platforms: macOS and Linux, Windows via WSL, not native Windows;
  - Claude Code only, not the claude.ai Chat tab;
  - a screenshot placeholder.
- **The CI workflow:** `on: [push, pull_request]`, a matrix over `ubuntu-latest` and `macos-latest` with Node 18 and 22, steps `actions/checkout` → `actions/setup-node` → `npm test`.

- [ ] **Step 1: Write the README, LICENSE and workflow.**
- [ ] **Step 2: Verify.** `npm test` → PASS. The workflow YAML parses (`ruby -ryaml -e 'YAML.load_file(".github/workflows/test.yml")'` or equivalent). The README's install commands match `plugin.json` and `marketplace.json` names.
- [ ] **Step 3: Commit.** `git commit -m "docs: README, license and CI"`
