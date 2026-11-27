---
name: prompt-report
description: Show the user how their Claude Code prompts score over time - weakest areas, trend, most common gaps, and their worst recent prompts with rewrites. Use when the user runs /prompt-report or asks how good their prompts are, where their prompting is weak, or whether they are improving.
argument-hint: "[7d|30d|all|last]"
---

# Prompt report

prompt-coach grades the user's prompts in the background and logs the results locally.
This skill turns that log into coaching.

1. Run the report script. It sits two folders up from this skill's base directory (shown
   above as "Base directory for this skill"):

   ```bash
   node "<base directory>/../../src/cli.mjs" report $ARGUMENTS
   ```

   With no argument it covers all time. `7d` or `30d` limit the window. `last` prints only
   the newest grade: show that output as-is and stop.

2. If it exits with a usage error, show the usage line and stop.

3. If `count` is 0, say no prompts have been graded yet. Grading starts automatically for
   prompts of 4+ words typed in Claude Code, and turns off with `PROMPT_COACH=off`.

4. Otherwise write a short coaching summary, using only numbers from the JSON:
   - **Weakest area:** the lowest of `averages` (`success_criteria` means "saying what done
     looks like"), with one concrete habit that would raise it.
   - **Trend:** `trend.last7` vs `trend.prev7`. Say "not enough data yet" when either is null.
   - **Most common gaps:** the top two of `gap_counts`, in plain words
     (`no-files` = didn't name the files, `no-done-criteria` = didn't say what done looks
     like, `vague-goal` = unclear goal, `no-error-text` = no error message,
     `no-examples` = no example, `no-constraints` = no limits or rules,
     `missing-background` = missing background).
   - **Learn from your own prompts:** each prompt in `worst`, shown as the original, its
     score, and the rewrite.
   - If `skipped_lines` is above 0, mention that that many log lines were unreadable and skipped.

Keep it under about 250 words. Be direct and encouraging, never generic. Write only these sections; don't add claims the JSON doesn't support (it has no "most recent" or per-prompt dates beyond `worst[].ts`).
