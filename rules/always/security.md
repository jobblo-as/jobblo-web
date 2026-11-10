
### `rules/always/security.md`

```md
---
description: Security, secrets, data safety, Git safety, and destructive-operation rules.
alwaysApply: true
trigger: always_on
---

# Security

Treat security boundaries as hard constraints.

Never expose:

- passwords
- access tokens
- refresh tokens
- API keys
- database credentials
- private keys
- session secrets
- production secrets

# Environment files

Do not edit unless explicitly requested:

- `.env`
- `.env.local`
- `.env.production`
- `.env.development`
- other `.env.*` files containing secrets

Prefer documenting required variables in:

`.env.example`

Never put real secret values in `.env.example`.

# Authentication

Never store plain-text passwords.

Use the project's existing password-hashing implementation.

Do not weaken:

- password hashing
- token verification
- authentication middleware
- authorization checks
- cookie security
- rate limiting
- CSRF protection

only to make code work.

# Authorization

Authentication answers:

"Who is this user?"

Authorization answers:

"Is this user allowed to perform this action?"

Do not treat successful authentication as automatic permission.

Check:

- ownership
- role
- permissions
- tenant boundaries

where required.

# Sensitive data

Do not log:

- passwords
- full authentication tokens
- authorization headers
- private keys
- secrets
- sensitive cookies

Do not return sensitive database fields unnecessarily.

# Database safety

Do not perform destructive database actions without explicit permission.

This includes:

```js
deleteMany({})