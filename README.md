# prompt-coach: a Claude Code plugin that grades your prompts

**Get better at prompting Claude Code, one prompt at a time.**

prompt-coach is a Claude Code plugin that grades every prompt you write and shows you how to
improve it. It scores each prompt on clarity, context, specificity and done criteria, and Claude
opens its next reply with that grade and the biggest gap to fix. Over time, `/prompt-report` shows your patterns: your weakest area,
whether you're improving, and the gaps you keep repeating.

> **Last prompt: 1.8/10** · Clarity 3 · Context 2 · Specificity 1 · Done criteria 1
> **Better:** Name the login page's file or route (e.g. src/pages/Login.tsx or /login).

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
   against a fixed rubric. It also gets the project folder's name and Claude's previous reply
   as context, so "fix this repo's tests" or "now do the same for auth" are judged fairly. It has no tools, no MCP servers and none
   of your plugins. Scoring is 1–10 on:
   - **Clarity:** is it obvious what's being asked?
   - **Context:** does Claude have the files, background and constraints it needs?
   - **Specificity:** concrete names, error text and examples rather than vague wishes?
   - **Done-criteria:** does it say what "done" or "good" looks like?

   The overall score is the average of the four.
3. **Claude quotes the grade at the top of its next reply.** When you send your next
   prompt, the hook hands the finished grade to Claude, which opens its reply with it. So
   each grade shows one turn late, and the last prompt of a session only shows in
   `/prompt-report last`, which also has the full rewrite.
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
  `~/.claude/prompt-coach/`. Files there are readable only by you.
- To clear everything:

  ```bash
  rm -rf ~/.claude/prompt-coach
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
- Built for Claude Code: the CLI, the desktop app's Code tab, and the IDE extensions, all of
  which run plugin hooks. Grading uses the same Claude Code that runs the hook. If that can't
  be found, it falls back to `claude` on your `PATH`.
- Doesn't work in the claude.ai Chat tab, which has no hooks.

**Nothing showing up?** Run `/prompt-report last`. If it says nothing has been graded, check:
- that `node --version` works;
- that `PROMPT_COACH` isn't set to `off`;
- that your prompt was long enough to be graded.

## FAQ

**How do I write better prompts for Claude Code?**
Say what you want, name the files or error text involved, and say what "done" looks like.
prompt-coach checks those four things on every prompt and tells you which one you skipped.

**Does it need an API key?**
No. Grading uses your existing Claude Code login.

**Does it slow Claude Code down?**
No. The hook returns in about 0.3 s and grading runs in the background.

**Does it send my prompts anywhere new?**
No. Prompts go only to Claude, through your own login, and results stay in
`~/.claude/prompt-coach/` on your machine.

**Can I turn it off?**
Set `PROMPT_COACH=off`, or uninstall with `/plugin uninstall prompt-coach@prompt-coach`.

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
