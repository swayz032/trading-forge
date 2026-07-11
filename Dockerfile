FROM node:20-alpine
WORKDIR /app
COPY railway-relay/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY railway-relay/server.js ./server.js
# server.js does `require("./ip-sanitize.js")` — without this COPY the image crash-loops
# MODULE_NOT_FOUND on boot (deep-scan SEC-INFRA-01 2026-07-11). The primary relay build
# (railway-relay/Dockerfile) already copies it; this hardens the root/repo-context build too.
COPY railway-relay/ip-sanitize.js ./ip-sanitize.js
EXPOSE 3000
CMD ["node", "server.js"]
