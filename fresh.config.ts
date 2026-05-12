import { defineConfig } from "$fresh/server.ts";

export default defineConfig({
  server: {
    hostname: Deno.env.get("HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("PORT") ?? 8000),
  },
});
