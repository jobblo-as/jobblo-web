---
description: Project safety rules.
alwaysApply: true
trigger: always_on
---

# Safety

Do not perform destructive operations without explicit permission.

Ask before:

- deleting database data
- dropping collections
- resetting the database
- deleting files
- killing processes
- restarting important services
- force pushing
- rewriting Git history

# Protected files

Do not edit unless explicitly requested:

- `.env`
- `.env.*`
- `.git/`
- production secrets
- private keys
- deployment credentials

Never expose:

- passwords
- API keys
- access tokens
- database credentials
- private keys

Do not bypass Git hooks with `--no-verify`.