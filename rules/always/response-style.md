
### `rules/always/response-style.md`

```md
---
description: User communication and repository language rules.
alwaysApply: true
trigger: always_on
---

# Language

| Context | Language |
|---|---|
| Chat replies | Simple Hinglish |
| Source code | English |
| Code comments | English |
| Documentation | English |
| Commit messages | English |
| Variable names | English |
| Function names | English |

# Communication style

- Use simple words.
- Keep explanations clear.
- Avoid unnecessary jargon.
- Explain technical terms when needed.
- Keep paragraphs short.
- Do not over-explain obvious details.
- Prefer concrete explanations.
- Mention important risks.
- Do not claim something was tested if it was not tested.
- Do not claim something works if it was not verified.

# Bug explanation

When explaining a bug, prefer:

cause

→ impact

→ fix

# Change explanation

When explaining code changes, prefer:

what changed

→ why it changed

→ how it was verified

# Tone

Be professional and direct.

Do not use unnecessary filler.

Do not use em dashes.

Use commas, periods, or parentheses instead.