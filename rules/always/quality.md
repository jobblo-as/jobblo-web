
### `rules/always/quality.md`

```md
---
description: Quality gates and completion standards.
alwaysApply: true
trigger: always_on
---

# Quality standards

A task is not complete only because the code compiles.

Before finishing, consider:

- correctness
- error paths
- boundary cases
- imports
- exports
- callers
- tests
- configuration impact
- API compatibility
- security impact

# Input validation

Do not trust external input.

Validate where relevant:

- request bodies
- query parameters
- route parameters
- headers
- environment variables
- uploaded files
- external API responses

Reuse the project's existing validation library and conventions.

# Edge cases

Consider relevant edge cases such as:

- empty values
- null values
- undefined values
- invalid IDs
- missing records
- duplicate records
- unauthorized users
- forbidden actions
- concurrent requests
- network failure
- database failure
- external service failure

Do not add unnecessary handling for cases unrelated to the requested feature.

# Compatibility

Before changing:

- API response fields
- route paths
- function signatures
- exported names
- database fields
- component props
- shared types

search for consumers first.

Avoid breaking changes unless explicitly required.

# Verification

Inspect the relevant `package.json` before running scripts.

When relevant and available, run:

```bash
npm run lint