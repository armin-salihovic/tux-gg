FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS migration
WORKDIR /app
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node drizzle.config.ts ./drizzle.config.ts
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node scripts/db_migrate.mjs scripts/database-connection.mjs scripts/database-identifiers.mjs scripts/games-catalog.mjs scripts/restore_games.mjs ./scripts/
COPY --chown=node:node src/lib/server/db/schema.ts ./src/lib/server/db/schema.ts
ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=$VCS_REF
USER node
ENTRYPOINT ["node", "scripts/db_migrate.mjs"]

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/static ./static
COPY package.json ./package.json
ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=$VCS_REF
USER node
EXPOSE 3000
CMD ["node", "build"]
