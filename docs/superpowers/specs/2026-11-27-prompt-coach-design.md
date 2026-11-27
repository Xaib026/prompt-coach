# Prompt Coach: design

Working name: **prompt-coach** (Claude's placeholder; rename freely).
Date: 2026-11-27

## Intent and the why

The owner wants to get better at prompting Claude Code. Every time they give
Claude Code a prompt or task, they want to see how effective it was: where it's
weak and how to fix it. Over time, they want to see patterns: which weaknesses
keep coming back and whether they're improving.

It's also an **open-source portfolio project**. Strangers will install it, read
the code and judge the work. So it has to install in one step, work on other
people's machines, have a clear README, and have code that's clean and tested.

## Goals

1. **Feedback on each prompt.** Each substantive prompt gets a score, a
   breakdown by criterion, what was missing, and a rewritten, stronger version
   of the prompt.
2. **Patterns over time.** A `/prompt-report` command shows averages per
   criterion, trends, the most common gaps, and the worst recent prompts with
   their rewrites.
3. **Fair grading.** A separate model grades the prompt, not the Claude that
   answers it.
4. **Easy for strangers to install.** One `/plugin` install from the GitHub
   repo, with no API key. It uses the person's existing Claude Code login.

## Non-goals

- The claude.ai web or desktop **Chat** tab. They have no hooks, so this is
  Claude Code only (CLI, desktop app Code tab, IDE extensions).
- Team or cloud dashboards, or sharing scores anywhere.
- Changing the prompt that gets sent. It coaches; it never rewrites your
  prompt on the way through.
- Blocking or refusing "bad" prompts.

## Anti-goals (failure even if it technically works)

- **It slows every prompt noticeably, or breaks a session.** Any grader error,
  timeout or missing dependency must let the prompt through untouched.
- **It nags.** Quick replies ("yes", "continue", "2") and slash commands are
  never scored.
- **Prompts leave the machine** for anywhere other than the Claude call the
  user already makes. The log is local only.
- **Scores you can't compare.** If the criteria or scale drift between runs,
  the patterns are meaningless.
- **It pollutes Claude's context.** Grading output is shown to the user and
  must not be injected into the main model's context.

## Constraints (verified on Claude Code 2.1.325)

- `claude -p --model <m> --json-schema <schema> --output-format json` gives
  structured output using the user's normal login.
- `--bare` would skip hooks but **can't use OAuth/subscription login**, so it
  can't be used. The grader call will fire this plugin's hook again. **The
  hook must guard against recursion** with an environment variable it sets for
  the child process and checks on entry.
- Plugin hooks live in `hooks/hooks.json` and reference scripts via
  `${CLAUDE_PLUGIN_ROOT}`.
- A `UserPromptSubmit` hook's `systemMessage` is shown to the user;
  `additionalContext` goes to the model. Use `systemMessage` only.
- A `UserPromptSubmit` hook runs before Claude starts answering, so it must
  only *start* grading in the background and return at once. Grading never
  delays the reply.
- **Measured (2026-11-27, two runs):** a plain `claude -p --model haiku
  --json-schema` grading call took **12.5–14s** wall time and **$0.007–0.011**
  (list price). Most of that is a ~50k-token default system prompt and tool
  list. Claude's call: the grader passes `--tools ""` and its own
  `--system-prompt`, which should cut both a lot. The builder must re-measure,
  and the README must quote real numbers.
- **Not yet verified:** that a `Stop` or `UserPromptSubmit` hook's
  `systemMessage` shows in the desktop app's Code tab and in the IDE
  extensions, not only the CLI. The builder tests this first. If it doesn't
  show somewhere, fall back to `/prompt-report last` for that surface.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Claude grades itself inline; a Stop hook copies the score out of its reply into a log | Free and instant, but self-grading is generous, parsing free text is fragile (corrupts history), and every reply gets longer |
| **B** | **Separate grader: the UserPromptSubmit hook starts Haiku via `claude -p` in the background with a fixed rubric and a JSON schema, appends the result to a local log, and a Stop hook shows it after Claude's reply** | **Fair and consistent, with clean structured data for patterns and no API key. No wait; costs a little usage per prompt** |

**Picked: B** (the owner chose it). The patterns half depends on consistent
data, and a fair grader is the point of a tool for getting better.

## The design

### Flow on each prompt

1. The user submits a prompt. The `UserPromptSubmit` hook receives JSON on stdin
   (`prompt`, `session_id`, `cwd`, …).
2. **Guard:** if the recursion env var is set, exit 0 with no output.
3. **Skip** (exit 0, no output, nothing logged) if any of these holds:
   - the prompt starts with `/`;
   - it's under a minimum length (Claude's call: fewer than 4 words);
   - it's a bare number or option pick;
   - the user has turned scoring off.
4. **Start grading in the background and return at once** (decided by the
   owner: the score shows *after* Claude's reply, and the prompt never waits).
   The hook spawns a detached grader process and exits 0 with no output, so
   Claude starts answering immediately.
5. **Grader process:** runs `claude -p` with:
   - the grader model (default Haiku);
   - the rubric as the system prompt;
   - the prompt plus the previous reply as input;
   - `--json-schema`, `--tools ""` and `--no-session-persistence`;
   - **a lean, neutral run:** it starts in an empty temp folder (no project
     CLAUDE.md), with `--strict-mcp-config` (no MCP servers) and no setting
     sources (no user plugins or hooks). The builder must confirm the user's
     normal login still works this way, and re-measure the time and cost;
   - the guard env var set (both hooks check it).

   The grader's answer includes `skip: true` when the "prompt" is just a reply
   to Claude's question ("yes, go with option B please"). Nothing is logged
   or shown for those.

   It has a hard timeout (Claude's call: 60s). On success it validates the
   result, appends it to the log, and writes the session's "pending" file. On
   timeout or error it writes nothing and leaves no stray process.
6. **Show (Stop hook):** when Claude finishes its reply, a `Stop` hook checks
   for that session's pending file. If it's there, the hook prints a
   `systemMessage` and deletes the file. The message holds the overall score,
   the four criteria, the top gap, and the rewritten prompt, kept to a few
   lines. If the grade isn't ready yet, the hook doesn't wait; the next
   `UserPromptSubmit` (or next `Stop`) shows it instead. The Stop hook must
   never block or continue Claude: no `decision`, and it always exits 0.
   - One pending file per session. A newer grade replaces an older unshown
     one (the older one is still in the log for the report). There's no
     cleanup by age.

### Rubric (fixed, versioned)

Four criteria, each scored 1–10, plus an overall score:

- **Clarity:** is it obvious what's being asked?
- **Context:** does Claude have the files, background, constraints and
  audience it needs?
- **Specificity:** concrete details over vague wishes (names, errors,
  examples)?
- **Success criteria:** does it say what "done" or "good" looks like?

The grader also returns `missing` (a short list of what would most improve the
prompt) and `rewrite` (the improved prompt). The rubric carries a
`rubric_version`, stored in every log line, so the report can tell old scores
from new ones if the rubric ever changes.

### Log

- Location (Claude's call): `~/.claude/prompt-coach/scores.jsonl`. It's local
  and outside any project, so it covers all projects and never gets committed
  by accident.
- One line per graded prompt: timestamp, rubric_version, grader model,
  project dir, prompt text, the four scores, overall, missing, rewrite.
- The README states plainly that prompt text is stored locally.
- The log is created readable by the owner only (mode 600). Each entry is
  written in a single append, so parallel sessions can't mix their lines. The
  README gives a one-line way to clear it.
- The report skips any line it can't read (e.g. half-written after a kill)
  and says how many it skipped. This is tested.

### `/prompt-report`

- A plugin skill or command. A small script reads the log and computes the
  numbers (no guessing by the model):
  - averages per criterion;
  - a trend (this week vs the previous week, or over the last N prompts);
  - how often each gap appears;
  - the lowest-scoring recent prompts.
- Claude then turns those numbers into a short coaching summary: your weakest
  area, whether you're improving, and two or three of your own low-scoring
  prompts with their rewrites.
- Optional argument for a time window (e.g. `7d`, `30d`); default all time.

### Controls

- Env vars only: `PROMPT_COACH=off` to disable, and `PROMPT_COACH_MODEL` to
  change the grader model. No config file, no settings UI.

### Packaging (open-source)

- The GitHub repo is its own plugin marketplace, so users run two `/plugin`
  commands to install. Layout:
  - `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
  - `hooks/hooks.json`
  - `scripts/` (the grader hook and the report aggregator)
  - `skills/prompt-report/` (or `commands/`)
  - `README.md` (install, a screenshot or GIF, privacy note, how scoring
    works, cost and latency note), `LICENSE` (MIT, Claude's call)
- Tests for: skip rules, the recursion guard, parsing and validating grader
  output, log writing, report aggregation, and the timeout/error passthrough.

## Calls Claude made after the builder check (owner can override)

- **The grader sees a little conversation.** It gets the prompt plus Claude's
  previous reply in the session, cut to ~1,500 characters and read from
  `transcript_path`. Without it, follow-ups like "now do the same for auth"
  get unfairly low Context scores and skew the patterns. The previous reply is
  **not** logged; only the prompt is.
- **Scripted and headless runs.** Users opt out with `PROMPT_COACH=off`, and
  the README tells people to set it in CI and scripts. The builder checks
  whether the hook input carries a reliable "non-interactive" signal; if it
  does, skip those runs by default.
- **Platforms:** macOS and Linux, plus Windows through WSL. Native Windows is
  out of scope, and the README says so. The hook is launched through a tiny
  `sh` wrapper that exits 0 when Node is missing; CI runs on Ubuntu and macOS.
- **Countable gaps:** `missing` entries are tagged with a fixed set of
  categories (e.g. `no-files`, `no-error-text`, `no-done-criteria`,
  `vague-goal`, `no-constraints`), so the report can count them.
- **Overall score** = the average of the four criteria, computed in code
  rather than by the grader, so it stays comparable.

## Decided by the owner

- Purpose: see where prompts are weak, improve them, and use it as an
  open-source portfolio piece.
- Both feedback on each prompt and patterns over time.
- Approach B: a separate grader.
- The score shows after Claude's reply; grading never makes a prompt wait.
- **Approved 2026-11-27**, including review fixes 1–7.

## Left to the builder

- Implementation language and runtime. Claude's call: **Node.js with no npm
  dependencies**. It's on most Claude Code users' machines, and it handles JSON
  and child processes with nothing else installed. If Node is missing, the hook
  exits 0 silently.
- Exact rubric wording and the grader's system prompt.
- Exact `systemMessage` layout.
- Whether `/prompt-report` is a skill or a command, and how the trend window
  is computed.
- Test framework (Node's built-in `node:test` keeps it dependency-free).
- Whether to also ship a GitHub Actions workflow to run tests (nice for a
  portfolio).
