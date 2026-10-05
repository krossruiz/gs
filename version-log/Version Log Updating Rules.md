# Version Log Updating Rules

## Purpose

`version-log/` stores the **exact** conversation text that shaped each GS version, for later reference by people and agents.

## Folder layout

- One folder per version: `version-log/<version>/` (example: `version-log/0.967/`).
- This rules file: `version-log/Version Log Updating Rules.md` (do not put a version number here).
- Optional root `version-log/README.md` may point here.

## What to store

Store **verbatim** text only:

1. **User messages** — the exact words the user typed (including widget answers), for GS-related threads.
2. **Assistant replies** — the exact text delivered to the user (SendToUser content).

## What not to store

- Summaries, paraphrases, or “topic lists”
- Hidden system / automation prompts
- Tool dumps, subagent internals, raw JSON transcripts of tools
- Secrets, API keys, passwords, tokens, private emails beyond what the user already put in public chat

## Format

Prefer markdown files such as `conversation.md` or `thread-<date>.md` inside the version folder:

```markdown
### User
<exact user text>

### Assistant
<exact assistant reply>
```

Keep chronological order. Multiple files per version are fine if threads are long.

## When to update

1. While working on a version: append GS-relevant exchanges as they happen.
2. **After each ship:** refresh that version’s folder so it includes the full exact thread that led to the deploy.
3. Agents: follow `DEPLOY.md` and these rules together. Ask the user for the version number before deploying; then write or update `version-log/<that-version>/`.

## Naming

- Version folders: numeric / semver style matching `GS_VERSION` (e.g. `0.967`).
- Do not invent version numbers.
