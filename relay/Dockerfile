# Crewhouse's relay. Build from this folder: docker build -t crewhouse-relay relay/
FROM node:22.19.0-bookworm-slim
WORKDIR /relay
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7300 RELAY_DATA=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /data && chown node:node /data
COPY main.ts health.ts ./
USER node
VOLUME /data
EXPOSE 7300
HEALTHCHECK --interval=30s --timeout=6s --start-period=5s --retries=3 CMD ["node", "health.ts"]
CMD ["node", "main.ts"]
