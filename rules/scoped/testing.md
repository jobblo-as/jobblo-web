
### `rules/scoped/testing.md`

```md
---
description: Testing strategy and regression prevention rules.
alwaysApply: false
trigger: glob
globs:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
paths:
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
---

# Testing

Tests should validate observable behavior rather than unnecessary implementation details.

# Bug fixes

When practical, bug fixes should include a regression test.

The regression test should:

1. fail with the broken behavior
2. pass after the fix
3. describe the expected behavior clearly

# Unit tests

Use unit tests for isolated logic.

Mock external boundaries where appropriate.

Examples:

- external API
- filesystem
- email provider
- payment provider

Do not mock the function being tested.

# Integration tests

Use integration tests when behavior depends on several pieces working together.

Examples:

- route + middleware
- controller + database
- authentication flow
- API response behavior

# Test isolation

Tests should be:

- deterministic
- independent
- repeatable
- readable

Do not make tests depend on execution order.

# Timing

Avoid arbitrary sleeps such as:

```js
await new Promise(resolve => setTimeout(resolve, 5000));