# The dependencies are installed without scripts, so this stage runs on the build machine's own
# platform; only the small final stage is built for each target platform. sharp (the image library)
# comes as a prebuilt binary per platform, so npm is told which one the target needs: without
# --cpu, an arm64 image built on an amd64 machine would get the amd64 binary. The WebAssembly
# fallback (9 MB) is not needed next to the native binary.
FROM --platform=$BUILDPLATFORM node:22-alpine AS dependencies
ARG TARGETARCH
WORKDIR /app
COPY package.json package-lock.json ./
RUN cpu="$([ "$TARGETARCH" = amd64 ] && echo x64 || echo "${TARGETARCH:-x64}")" \
 && npm ci --omit=dev --ignore-scripts --os=linux --libc=musl --cpu="$cpu" \
 && test -d "node_modules/@img/sharp-linuxmusl-$cpu" \
 && rm -rf node_modules/@img/sharp-wasm32 \
 && npm cache clean --force

FROM node:22-alpine
LABEL org.opencontainers.image.title="Proxmox Notes" \
      org.opencontainers.image.description="Web GUI, REST API and MCP server for Proxmox guest Notes" \
      org.opencontainers.image.source="https://github.com/Snille/Proxmox-Notes-MCP" \
      org.opencontainers.image.licenses="MIT"
RUN addgroup -S -g 10001 notes && adduser -S -D -H -u 10001 -G notes notes
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY src ./src
RUN mkdir -p /data && chown notes:notes /data
USER notes
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/live >/dev/null || exit 1
CMD ["node", "src/index.mjs"]
