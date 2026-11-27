# prompt-coach

**Get better at prompting Claude Code, one prompt at a time.**

prompt-coach is a Claude Code plugin. It quietly grades every prompt you give Claude Code,
and when Claude finishes replying you see where the prompt was weak and a stronger version
to use next time. Over time, `/prompt-report` shows your patterns: your weakest area,
whether you're improving, and the gaps you keep repeating.

```
Prompt score 1.8/10 · clarity 3 · context 2 · specificity 1 · done-criteria 1
Biggest gap (no-files): Name the login page's file or route (e.g. src/pages/Login.tsx or /login).
Try: "In <path/to/login page>, improve the login page. Current problems: <list what is wrong>. Keep the existing auth flow…"
```

<!-- screenshot: add docs/screenshot.png here -->

## Install

In Claude Code:

```
/plugin marketplace add xaib026/prompt-coach
/plugin install prompt-coach@prompt-coach
```

You need Node.js 18 or newer (`node --version`). There's no API key to set: grading uses
your existing Claude Code login.

## How it works

1. **You send a prompt.** A hook starts grading in the background and returns right away
   (about 0.3 s), so Claude starts answering with no wait.
2. **A separate grader scores it.** A lean `claude -p` call to Haiku checks your prompt
   against a fixed rubric, using Claude's previous reply as context, so follow-ups like
   "now do the same for auth" are judged fairly. It has no tools, no MCP servers and none
   of your plugins. Scoring is 1–10 on:
   - **Clarity:** is it obvious what's being asked?
   - **Context:** does Claude have the files, background and constraints it needs?
   - **Specificity:** concrete names, error text and examples rather than vague wishes?
   - **Done-criteria:** does it say what "done" or "good" looks like?

   The overall score is the average of the four.
3. **You see the result after Claude's reply.** If grading isn't finished yet, it shows
   with your next prompt instead.
4. **`/prompt-report`** turns your history into coaching. Use `/prompt-report 7d` or
   `30d` to limit the window, or `/prompt-report last` to see the newest grade again.

**Not graded:** slash commands, prompts under 4 words, option picks like `2` or `b)`,
replies to Claude's own questions ("yes, go with option B"), and scripted `claude -p` runs.

### Cost and speed

Measured on Claude Code 2.1.325:

| | |
|---|---|
| Model time per grade | 1.0–1.6 s |
| Wall time per grade | about 8 s, in the background, so you never wait |
| Cost per grade | about $0.0002–0.0004 at list price |

On a Claude subscription, grading uses a small amount of your plan's usage.

## Privacy

- Prompts are graded only through your own Claude Code login, the same service your prompts
  already go to.
- Results, including the **text of your prompts**, are stored only on your machine, in
  `~/.claude/prompt-coach/scores.jsonl`. The file is readable only by you (mode 600).
- To clear your history:

  ```bash
  rm ~/.claude/prompt-coach/scores.jsonl
  ```

If you paste secrets into prompts, they end up in that file too.

## Settings

Settings are environment variables:

| Variable | Effect |
|---|---|
| `PROMPT_COACH=off` | Turn grading off. Set it in CI, scripts, and any `claude -p` you start from inside a Claude Code session |
| `PROMPT_COACH_MODEL=sonnet` | Use another grader model. Defaults to `haiku` |

## Platforms

- macOS and Linux.
- Windows through WSL. Native Windows isn't supported.
- Works in the Claude Code CLI, the desktop app's Code tab, and the IDE extensions.
- Doesn't work in the claude.ai Chat tab, which has no hooks.

## Development

```bash
npm test                       # node:test, no dependencies
claude --plugin-dir .          # try your local copy in Claude Code
```

Code layout:

| Path | What's in it |
|---|---|
| `src/cli.mjs` | Hook entry points and the background worker |
| `src/rubric.mjs` | Rubric, JSON schema and validation |
| `src/grader.mjs` | The `claude -p` call |
| `src/store.mjs` | Local files |
| `src/input.mjs` | Skip rules and the previous reply |
| `src/report.mjs` | Report numbers |
| `skills/prompt-report/` | The report skill |

The design doc and implementation plan are in `docs/superpowers/`.

## License

MIT © 2026 xaib026 (Shoaib Hussain)
