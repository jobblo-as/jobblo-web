# Start from an official Node.js image (version 20)
FROM node:20

# Make /app the folder we work inside the container
WORKDIR /app

# Run as the image's unprivileged "node" user, not root.
RUN chown node:node /app
USER node

# Copy the package files first (so Docker can cache installed packages)
COPY --chown=node:node package.json package-lock.json ./

# Production by default: exact lockfile install without dev dependencies, NODE_ENV set so
# every production safety switch is on. docker-compose.yml (local dev, nodemon) builds with
# NODE_ENV=development. --include=optional downloads sharp's Linux binary in the container.
# Behind a host nginx the client address arrives from the Docker bridge, not loopback: set
# TRUST_PROXY to the bridge gateway (e.g. 172.17.0.1) at runtime, or every client shares one IP.
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
RUN if [ "$NODE_ENV" = "production" ]; then npm ci --omit=dev --include=optional; else npm ci --include=optional; fi

# Copy the rest of the backend code into the container
COPY --chown=node:node . .

# Second lock behind .dockerignore: refuse to produce an image that contains a
# private key (e.g. a Firebase service-account JSON). Firebase credentials are
# provided at runtime via GOOGLE_APPLICATION_CREDENTIALS pointing at a mounted file.
RUN if grep -rlIq --exclude-dir=node_modules -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' . ; then \
      echo 'Refusing to build: a private key is in the build context (see .dockerignore).' >&2; \
      exit 1; \
    fi

# The server runs on port 5001 (see server.js)
EXPOSE 5001

# API worker processes: 1 = one process (one CPU core). With REDIS_URL set, use N or
# "auto" (one per CPU the container may use); see cluster.js. Without Redis it stays at 1.
# Set it at runtime (env_file / -e), not here: an image ENV would hide the value in .env.

# Command that starts the app (with WEB_CONCURRENCY>1 this is the cluster primary, which
# forwards SIGTERM to the workers as a graceful drain)
CMD ["node", "server.js"]
