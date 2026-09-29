FROM ghcr.io/puppeteer/puppeteer:23.5.0

# The base image already has Chromium + all system deps for Puppeteer,
# and runs as a non-root "pptruser" user.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY --chown=pptruser:pptruser server/package.json ./server/
RUN cd server && npm install --omit=dev

# Keep server/ and public/ as siblings, matching local dev layout, so
# server.js's path.join(__dirname, '../public') resolves the same way
# in both environments.
COPY --chown=pptruser:pptruser server/ ./server/
COPY --chown=pptruser:pptruser public/ ./public/

ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "server.js"]
