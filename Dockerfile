FROM node:20-alpine
WORKDIR /app
COPY railway-relay/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY railway-relay/server.js ./server.js
EXPOSE 3000
CMD ["node", "server.js"]
