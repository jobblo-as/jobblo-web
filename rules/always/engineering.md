---
description: Senior engineering standards for implementation and architecture.
alwaysApply: true
trigger: always_on
---

# Engineering standards

Write code for maintainability, readability, correctness, and predictable behavior.

Prefer:

- simple control flow
- clear names
- explicit behavior
- small focused functions
- predictable APIs
- reusable existing abstractions

Avoid:

- hidden side effects
- excessive abstraction
- magic values
- duplicated business logic
- deeply nested conditions
- large multi-purpose functions
- premature generalization

# Architecture

The existing project architecture is authoritative.

Do not introduce a new:

- service layer
- repository pattern
- event bus
- state management library
- dependency injection framework
- ORM or ODM abstraction
- caching layer
- queue system
- microservice

unless the requirement justifies it.

Do not redesign working architecture while implementing a small task.

# Separation of concerns

Keep responsibilities clear.

UI components should not contain unnecessary business logic.

Routes should not contain large business workflows when the project already uses controllers or services.

Database-specific logic should not leak into unrelated application layers.

Configuration logic should remain separate from feature logic where practical.

# Functions

A function should have one primary responsibility.

Prefer early returns over deeply nested conditions.

Example:

```js
if (!user) {
  return null;
}

if (!user.isActive) {
  return null;
}

return processUser(user);