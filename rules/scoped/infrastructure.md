
### `rules/scoped/infrastructure.md`

```md
---
description: Docker, CI, deployment, proxy, and infrastructure rules.
alwaysApply: false
trigger: glob
globs:
  - "Dockerfile"
  - "Dockerfile.*"
  - "docker-compose*.yml"
  - "docker-compose*.yaml"
  - ".github/**"
  - "infra/**"
  - "deploy/**"
  - "nginx/**"
paths:
  - "infra/**"
  - ".github/**"
  - "deploy/**"
  - "nginx/**"
---

# Infrastructure

Treat infrastructure changes as high-impact changes.

# Environment configuration

Use environment variables for environment-specific configuration when appropriate.

Do not hardcode:

- production URLs
- database credentials
- tokens
- passwords
- secrets
- private keys

# Docker

Follow existing project conventions for:

- base images
- working directory
- build stages
- exposed ports
- health checks
- startup commands

Keep images minimal where practical.

Do not copy unnecessary files into images.

Do not expose secrets through image layers or build arguments.

# Multi-stage builds

Use multi-stage builds when they meaningfully reduce production image size or keep build dependencies out of runtime images.

Do not add complexity if the project does not benefit from it.

# CI

Do not disable failing quality checks merely to make CI pass.

Understand the failure first.

Preserve relevant:

- lint
- typecheck
- test
- build
- security

gates.

# Deployment

Avoid changes likely to cause unnecessary downtime.

Consider backward compatibility during:

- API changes
- database changes
- environment changes
- rolling deployments

# Health checks

Preserve existing:

- health checks
- readiness checks
- liveness checks

Do not remove them merely to simplify deployment.

# Nginx and reverse proxies

When changing proxy configuration, consider:

- forwarded headers
- timeouts
- request-size limits
- compression
- caching
- WebSocket upgrades
- TLS termination
- upstream availability

Do not cache authenticated or private responses unless explicitly designed to be safe.

# Logging

Preserve useful infrastructure logging.

Do not log secrets or credentials.

# Production safety

Do not change production infrastructure values without understanding the impact.

Do not perform destructive deployment actions without explicit permission.