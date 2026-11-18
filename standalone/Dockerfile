# Build browser assets. The runtime API uses only Node's standard library.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html vite.config.mjs tsconfig.json ./
COPY web ./web
RUN npm run typecheck && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/moa.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node package.json ./package.json
RUN mkdir -p /app/data && chmod 700 /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
