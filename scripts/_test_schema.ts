import { getDb } from "../lib/db.ts";
const db = getDb();
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
).all() as Array<{ name: string }>;
console.log("tables:", tables.map((t) => t.name).join(", "));
db.close();
