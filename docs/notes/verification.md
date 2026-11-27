# Platform verification (Task 0), 2026-11-27, Claude Code 2.1.325, macOS

## 1. Lean grader command: works with the normal (OAuth) login

Run from a fresh `mktemp -d`, with the prompt on stdin:

```
claude -p --model haiku --output-format json --json-schema '<schema>' \
  --tools "" --strict-mcp-config --setting-sources "" \
  --no-session-persistence --system-prompt '<rubric>'
```

- `--setting-sources ""` is accepted. It drops user plugins and hooks, so cache
  input fell from ~48,000 tokens to ~1,500.
- Over 3 runs, model time (`duration_ms`) was **1.0–1.6 s** and cost
  (`total_cost_usd`, list price) was **$0.0002–0.0004** per grade. The
  baseline was 12.5–14 s and $0.007–0.011. Wall time adds process start-up,
  but it doesn't matter here because grading runs in the background.
- The result is in `.structured_output`.

## 2. Is `systemMessage` shown?

- I couldn't check the screen from this headless session.
- The hooks fired, and both printed `{"systemMessage": ...}` without errors.
- **This still needs eyes on it:** the user checks during the Task 5 live run,
  in the desktop Code tab and the CLI. If the message doesn't show somewhere,
  `/prompt-report last` is the fallback.

## 3. Transcript format

- `transcript_path` is a JSONL file. Assistant lines look like:
  `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}, ...]}}`
  (some content items are `thinking` or `tool_use`; keep only `type:"text"`).
- The Stop hook's input also has `last_assistant_message` (a string).

## 4. Non-interactive signal

- **Hook stdin** has no interactive flag. Its fields are `session_id`,
  `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`,
  `hook_event_name` and `prompt`.
- **The env var `CLAUDE_CODE_ENTRYPOINT`** reaches hooks:
  - a fresh `claude -p` sets `sdk-cli`;
  - the desktop app sets `claude-desktop`;
  - but a `claude -p` started *from inside* a desktop session inherits
    `claude-desktop`.
- **Use:** skip grading when `CLAUDE_CODE_ENTRYPOINT` starts with `sdk`. Nested
  runs aren't caught this way, so the README tells people to set
  `PROMPT_COACH=off` for them.

## 5. Skill path

- A loaded skill's content begins with `Base directory for this skill: <dir>`,
  so `SKILL.md` can tell Claude to run
  `node "<base dir>/../../src/cli.mjs" report`.
- I didn't verify whether `${CLAUDE_PLUGIN_ROOT}` gets substituted inside a
  SKILL.md, so don't rely on it.
