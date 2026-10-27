# Start from an official Node.js image (version 20)
FROM node:20

# Make /app the folder we work inside the container
WORKDIR /app

# Run as the image's unprivileged "node" user, not root.
RUN chown node:node /app
USER node

# Copy the package files first (so Docker can cache installed packages)
COPY --chown=node:node package.json package-lock.json ./

# Install the project dependencies
RUN npm install

# Copy the rest of the frontend code into the container
COPY --chown=node:node . .

# Vite's dev server runs on port 5173
EXPOSE 5173

# Start the dev server. --host lets you open it from your browser
# (outside the container), not just from inside it.
CMD ["npm", "run", "dev", "--", "--host"]
