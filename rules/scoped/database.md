---
description: MongoDB and Mongoose safety, consistency, and performance rules.
alwaysApply: false
trigger: glob
globs:
  - "backend/**/models/**"
  - "backend/**/database/**"
  - "backend/**/db/**"
  - "backend/**/repositories/**"
  - "server/**/models/**"
paths:
  - "backend/**"
  - "server/**"
---

# Database

Follow existing MongoDB and Mongoose conventions.

# Schemas

Inspect existing schemas before creating or changing fields.

Preserve existing:

- naming
- timestamps
- indexes
- references
- validation rules
- serialization behavior

unless requirements explicitly change them.

# Queries

Query only required data where practical.

Use projection when appropriate.

Avoid loading very large collections into memory.

Avoid N+1 query patterns.

Use `lean()` for read-only Mongoose queries when appropriate and when Mongoose document methods or behavior are not required.

# Indexes

Do not add indexes blindly.

Before adding an index, understand:

- query filters
- sorting
- cardinality
- expected traffic
- write overhead
- storage cost

Indexes improve reads but increase write and storage cost.

# Atomic operations

Prefer atomic database operations when appropriate.

Be careful with read-then-write flows that may cause race conditions.

Example concern:

```js
const product = await Product.findById(id);

product.stock -= 1;

await product.save();