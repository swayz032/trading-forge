FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY ip-sanitize.js ./
EXPOSE 3000
CMD ["node", "server.js"]
