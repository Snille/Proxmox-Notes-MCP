FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
RUN addgroup -S -g 10001 notes && adduser -S -D -H -u 10001 -G notes notes
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown notes:notes /data
USER notes
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/live >/dev/null || exit 1
CMD ["node", "src/index.mjs"]
