/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />

import config from "./fresh.config.ts";
import manifest from "./fresh.gen.ts";

import { start } from "$fresh/server.ts";
import { registrarCrons } from "./lib/crons.ts";
registrarCrons();
await start(manifest, config);
