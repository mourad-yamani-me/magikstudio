---
title: "ask-first: questions in a card, not a paragraph"
date: 2026-09-08
description: A free Claude Code plugin that moves every question out of prose and into a card — one question at a time, with a recommended answer. Here is why I built it, how it works, and how to install it.
tags: [claude-code, ai, workflow]
keySections: [How do I install it, The motivation, What is the difference between a skill and a hook]
code: https://github.com/IndieCoreDev/ask-first
codeLabel: ask-first — the skill, the hooks and the tests
linkedin: false
draft: false
---

I have released **[ask-first](https://github.com/IndieCoreDev/ask-first)**, a free Claude Code
plugin that makes Claude ask clarifying questions properly. When it needs a decision from you,
it stops writing the question into a paragraph and puts it in an interactive card instead. One
question at a time, with the option it recommends first.

You have seen the card already if you use planning mode — that menu with arrow keys is the
`AskUserQuestion` tool. This plugin makes Claude reach for it everywhere else too, and it
works across every session on your machine rather than for as long as you remember to ask.

```
/plugin marketplace add IndieCoreDev/ask-first
```

```
/plugin install ask-first@ask-first
```

Then restart Claude Code. That is the whole setup. MIT licensed, no configuration, no
account, nothing to sign up for.

## The motivation

I did not set out to write a plugin. I set out to stop losing an hour a day to reading.

Every reply a coding agent writes costs me time twice over, and the two costs stack.

**The first is length.** A reply holds three different things at the same weight:

- what was done or found — information, read once, act never
- what was assumed — a decision made for me, quietly
- what is actually needed from me — the only part that blocks progress

In plain text those three look identical. Same font, same paragraphs, same tone. So I read
the entire answer to locate the one sentence that needs me, and I do that on every turn of
every session. A question sitting in paragraph four gets missed. Then I answer it
vaguely, and we spend another turn establishing what I should have been asked plainly.

**The second is vocabulary.** Recent Claude models write with words harder than the work
requires. English is not my first language. A rare word costs me twice — once to read it,
once to be sure I read it right — and multiplied across a day that is real lost time, not a
complaint about style. Most people using a coding agent are not reading their first language
either.

I tried the obvious thing first: asking for shorter answers, plainer words, questions at the
end. It works for about three turns. Instructions in a conversation fade as the conversation
grows, and I was re-typing the same request every session without ever fixing the cause.

The cause is that a plain reply has no shape. Nothing limits its length and nothing separates
a question from a fact, so both are left to the model's judgement on every single turn.

Claude Code already ships the fix and underuses it. `AskUserQuestion` draws a card in the
terminal: a real list, arrow keys, one keypress. It cannot run long and it cannot hide a
choice inside a sentence, because the format will not let it. I already keep the rules of
this repo in the repo rather than in prompts — [I stopped writing prompts, I write the
repo](/blog/context-engineering-repo/) — so packaging this as a skill was the obvious shape.

The rule turned out to be short enough to write on one line.

**A question in prose is a bug.**

## What it looks like

The same moment, both ways. First as prose:

> I read the scheduling code — the calendar lives in `schedule-rule.mjs`, the allocator in
> `schedule.mjs`, and the gate runs inside `build.mjs`. There are a few ways to do this. A
> frontmatter flag would be simplest, though you could also track it in the ledger, or push
> the post to the next free day, which changes how the calendar reports it. Let me know which
> you prefer and I'll get started.

Sixty words to learn that a decision is waiting. Now as a card:

```
 ☐ Skip shape

 What should "skip" do to a post that's dated and waiting?

 ❯ 1. skip: in frontmatter (Recommended)
      One line in the post itself. The calendar hands the day back.
   2. Track it in the ledger
      Keeps posts untouched, but the reason lives away from the post.
   3. Push to the next free day
      No new field, but it silently moves a date you chose.
```

Same information. One glance, one keypress.

## The rules it follows

1. **Every question goes in a card**, never in prose.
2. **Only questions.** Plain information stays as normal text.
3. **One question at a time.** Never a batch.
4. **The first option is the recommendation**, and it says so.
5. **Ask the goal when the request does not say why**, and judge every option against it.

Rule 4 is the one I care about most. A neutral list of three options hands the work back to
you: now you have to become the expert to choose. Claude has read the code and you have not.
It should say which option wins, and let you overrule it.

Rule 5 is what stops a confident answer to the wrong problem. Told to "make this script
faster", the plugin makes Claude measure first, then ask what faster is *for* — a CI run that
cannot hang, or a quicker local run — because those lead to different code.

## How it works

The plugin bundles an **Agent Skill** and two **hooks**, and the split between them is the
interesting part.

A skill is instruction. It loads rules into Claude's context, and Claude mostly follows them.
A hook is enforcement: it is an event-driven script that Claude Code runs itself, so it does
not depend on the model agreeing with you. Skills are something Claude chooses to use. Hooks
are invisible and simply run. It is the same trade I made with code review — [I don't review AI
code, my build does](/blog/build-reviews-ai-code/) — moved up a layer, from the code the model
writes to the way it talks to me.

| Rule | How it holds |
| --- | --- |
| One question per card | Hook. Rejected before the card is drawn. |
| Recommendation first, marked | Hook. Rejected, naming where it actually was. |
| No question left in prose | Hook. The turn is blocked until it becomes a card. |
| Only questions in the card | Skill text. |
| Ask the goal, judge against it | Skill text. |

The skill came first. I rewrote one rule three times and Claude kept slipping past it, each
rewrite helping less than the last. One hook fixed a different rule on the first attempt, while I was
actively telling Claude to break it.

So: a hook can check a shape. Whether a question named your real goal is a judgement, and
judgement has no shape to check. Sort your own rules into those two piles before you write
them.

## Does it actually help?

Yes, and here is the run that proved it.

I asked Claude to deal with three pages Search Console said had never been crawled. Instead
of fixing them, it checked whether the finding was true. All three were already linked from
every page on the site, and their inbound links matched indexed sibling pages exactly — so
the obvious fix would have done nothing.

The real cause was a bug in my own code: my watcher skips its fourteen-day grace period on a
first run, assuming sitemap URLs are older than the watcher. My site is seven days old and
the watcher is two.

The card that followed recommended closing all three as `wontfix`, which lets the grace
period apply again so they reopen by themselves if Google still has not crawled them.

Without the plugin, that session ends in three cosmetic edits that change nothing.

## Questions

### How do I install it?

```
/plugin marketplace add IndieCoreDev/ask-first
```

```
/plugin install ask-first@ask-first
```

Then restart Claude Code. Installing at user scope means every project on your machine gets
it, in every session from then on, not just the one you are in.

There is no slash command to remember and nothing to invoke. The skill loads itself when a
decision is due, and the hooks run on their own.

### Why doesn't my skill show up?

Because `/reload-plugins` does not load skills. It reports `0 skills` and skills are only read
when a session starts, so restart. This cost me twenty minutes of believing the plugin was
broken when it was fine.

If a restart does not fix it, run `claude plugin validate` on both the plugin folder and the
marketplace root. It names the problem, and almost nobody mentions it.

### Will it ask too many questions?

It is written not to. It does not ask about a small reversible fix with an obvious default,
about anything the code already answers, or about a decision you already made. Those get
done, and reported in one line.

The hook that catches questions in prose ignores question marks inside code, turns that
already used a card, and reporting language like "the profiler will tell me where the time
goes". It never blocks on input it cannot read.

If it does interrupt you without a real reason, that is the bug I most want reported. A
plugin that gets in the way gets uninstalled, and I would rather relax a rule than defend
it.

### Is it safe? What do the hooks read?

Both hooks are short, unminified Node scripts with no dependencies, about 50 and 110 lines.

The first reads the pending question from stdin. The second reads your session transcript at
the path Claude Code passes it, to check whether the turn ended with a question in prose.
Neither writes a file, starts a process, or makes a network request. Nothing leaves your
machine. Read them before you install — you should do that with any plugin that ships hooks.

### What is the difference between a skill and a hook?

Short answer: a skill asks Claude to behave. A hook makes it.

- **Agent Skills** are Markdown instructions loaded into context. Claude decides when to use
  one, based on its description. Good for judgement — taste, tone, what counts as a good
  recommendation.
- **Hooks** are scripts wired to events like `PreToolUse` or `Stop`. Claude Code runs them
  whether or not Claude agrees, and a hook can reject a tool call outright. Good for anything
  with a checkable shape.
- **Subagents** run a separate context for a delegated task, and **MCP servers** connect
  outside tools. Neither is involved here.

Most plugins that "drift" are trying to enforce with a skill. If your rule has a shape a
script can check, it wants a hook.

### Can I change the rules?

Yes. The skill is one Markdown file and the hooks are two small scripts. Fork it, edit
`SKILL.md`, or drop a hook you disagree with from `hooks.json`.

If you fix something, the repo takes pull requests. There are 22 tests that CI runs on every
push, and the bar for a new rule is that it exists because a real session got past the old
one.

### Does it work with Claude Cowork?

Untested, so it is not claimed. Claude Code only for now.

### What does it cost?

Nothing. MIT licence, no account, no telemetry.

## If you build your own plugin, two warnings

Both cost me hours, and both are the same mistake: trusting the documentation over the binary.

**Prompt hooks did not run.** Claude Code documents two kinds of hook — a `command` hook runs
a script, a `prompt` hook runs an LLM evaluation — and the official docs call the prompt kind
*recommended* for judgement calls. Mine never fired. One grep explained it: the official
marketplace lists 291 plugins and not one ships a prompt hook. I rewrote the rule as a simple
script that checks the text directly, and the simple version caught the case the clever one
missed.

**Two documented manifest fields are rejected.** `$schema` and `displayName` are in the
reference; my CLI fails on both as errors, not warnings. The marketplace review runs
`claude plugin validate`, so following the docs would have failed my submission.

Run `claude plugin validate` on your plugin folder *and* your marketplace root before you
believe anything.

## Where it goes next

It is on GitHub, MIT, and submitted to the Claude Code community marketplace. Version 0.6.0.

The one thing I want back from anyone who tries it is a false block — a reply the hook stopped
that was not asking you anything. That is the failure I cannot find on my own, because my
tests only contain the mistakes I already thought of.
