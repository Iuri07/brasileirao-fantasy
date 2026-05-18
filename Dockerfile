# syntax=docker/dockerfile:1.7
FROM denoland/deno:alpine-2.5.0

# /app writable by deno for Fresh's _fresh build artifacts
RUN mkdir -p /app && chown deno:deno /app
WORKDIR /app

USER deno
COPY --chown=deno:deno . .

# Pre-build the Fresh app (generates _fresh/ with esbuilt islands).
# Build step needs --unstable-kv because some routes/cron files import KV
# at module top-level during manifest scan.
RUN deno cache --unstable-kv --unstable-cron main.ts dev.ts
RUN deno task build

# Persistent KV volume — mounted to /data, owned by deno
USER root
RUN mkdir -p /data && chown deno:deno /data
VOLUME /data
USER deno

ENV PORT=8080
EXPOSE 8080

CMD ["deno", "run", \
     "--allow-net", "--allow-env", "--allow-read", "--allow-write=/data,/tmp", \
     "--allow-run", \
     "--unstable-kv", "--unstable-cron", \
     "main.ts"]
