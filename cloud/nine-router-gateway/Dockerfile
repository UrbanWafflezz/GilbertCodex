FROM node:22-bookworm-slim AS nine-router

ARG NINE_ROUTER_REPO=https://github.com/decolua/9router.git
ARG NINE_ROUTER_REF=master

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/9router
RUN git clone --depth=1 --branch "${NINE_ROUTER_REF}" "${NINE_ROUTER_REPO}" .
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npm run build
RUN npm prune --omit=dev || true

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV GILBERT_NINE_ROUTER_COMMAND=npm
ENV GILBERT_NINE_ROUTER_ARGS=run,start
ENV GILBERT_NINE_ROUTER_CWD=/opt/9router
ENV GILBERT_NINE_ROUTER_TENANT_DATA_ROOT=/data/tenants

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY --from=nine-router /opt/9router /opt/9router

EXPOSE 8080
CMD ["node", "src/server.js"]
