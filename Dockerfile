# syntax=docker/dockerfile:1
# Build: needs a read:packages token for the org registry (BuildKit secret —
# it is used in one build-stage RUN and never lands in any image layer):
#   docker build --secret id=npm_token,env=NPM_TOKEN -t hiero-notify .
# Run (state + dead-letter land in /data — mount it):
#   docker run --rm -v notify-data:/data hiero-notify 0.0.1234 --state /data/state.json

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.json ./
COPY src ./src
# npm ci runs `prepare` → tsc → dist/. The token file is written and removed
# inside one RUN, and this whole stage is discarded from the final image.
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" > /root/.npmrc && \
    npm ci && \
    rm /root/.npmrc && \
    npm prune --omit=dev

FROM node:22-slim
LABEL org.opencontainers.image.source="https://github.com/hiero-hackers/hiero-notifications" \
      org.opencontainers.image.description="Watch Hedera activity and deliver provenance-stamped receipt notifications" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production
COPY --from=build /app/dist /app/dist
COPY --from=build /app/node_modules /app/node_modules
COPY package.json /app/
# Non-root, with a writable /data for --state / --dead-letter files.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /data
ENTRYPOINT ["node", "/app/dist/cli.js"]
