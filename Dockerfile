# syntax=docker/dockerfile:1.7
FROM denoland/deno:alpine-2.5.0

# @db/sqlite usa FFI pra libsqlite3 — instala system lib + headers
USER root
RUN apk add --no-cache sqlite-libs sqlite

# /app writable by deno for Fresh's _fresh build artifacts
RUN mkdir -p /app && chown deno:deno /app
WORKDIR /app

USER deno
COPY --chown=deno:deno . .

# Pre-build the Fresh app (generates _fresh/ with esbuilt islands).
# --unstable-cron pra crons.ts; --unstable-kv ainda usado pelo
# migrate script (lê o KV antigo).
RUN deno cache --unstable-kv --unstable-cron main.ts dev.ts
RUN deno task build

# Persistent volume — kv.db (antigo) + app.db (novo SQLite)
USER root
RUN mkdir -p /data && chown deno:deno /data
VOLUME /data
USER deno

ENV PORT=8080
ENV DB_PATH=/data/app.db
EXPOSE 8080

CMD ["deno", "run", \
     "--allow-net", "--allow-env", "--allow-read", "--allow-write=/data,/tmp", \
     "--allow-ffi", "--allow-run", \
     "--unstable-kv", "--unstable-cron", \
     "main.ts"]
