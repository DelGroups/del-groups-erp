#!/usr/bin/env node
/**
 * Fails when the code references a table, view or RPC that the live Supabase
 * database does not expose (P0-2: `production_stock_reservations` was used for
 * weeks without ever being created).
 *
 * Migrations here are not a full schema — core tables such as `sales` were
 * created outside them — so the check runs against the database itself, via
 * PostgREST's OpenAPI description. Read-only: one GET, no data is touched.
 *
 *   node scripts/check-schema.mjs            # reads .env.local / .env.production
 *   node scripts/check-schema.mjs --env-file path/to/.env
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service
 * role sees every object; the anon key has no privileges on public tables).
 * Exit codes: 0 ok, 1 missing objects, 2 could not run the check.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "src");

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = unquote(match[2]);
  }
}

function resolveEnv() {
  const flag = process.argv.indexOf("--env-file");
  if (flag !== -1) loadEnvFile(path.resolve(process.argv[flag + 1] || ""));
  loadEnvFile(path.join(ROOT, ".env.local"));
  loadEnvFile(path.join(ROOT, ".env.production"));
  return {
    url: unquote(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
    key: unquote(process.env.SUPABASE_SERVICE_ROLE_KEY || ""),
  };
}

/** Collects `.from("table")` (not storage buckets) and `.rpc("fn")` names under src/. */
function collectReferences() {
  const tables = new Map();
  const rpcs = new Map();
  const files = fs
    .readdirSync(SOURCE_DIR, { recursive: true })
    .map((rel) => path.join(SOURCE_DIR, rel))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts") && !file.includes("supabase.generated"));

  const add = (map, name, file) => {
    const rel = path.relative(ROOT, file).replaceAll("\\", "/");
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(rel);
  };

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/(\.storage)?\s*\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) {
      if (!match[1]) add(tables, match[2], file);
    }
    for (const match of text.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)) {
      add(rpcs, match[1], file);
    }
  }
  return { tables, rpcs };
}

async function fetchExposedObjects({ url, key }) {
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`PostgREST schema request failed: HTTP ${response.status}`);
  const spec = await response.json();
  const tables = new Set();
  const rpcs = new Set();
  for (const route of Object.keys(spec.paths || {})) {
    if (route.startsWith("/rpc/")) rpcs.add(route.slice(5));
    else if (route !== "/") tables.add(route.slice(1));
  }
  return { tables, rpcs };
}

function report(kind, referenced, exposed) {
  const missing = [...referenced.keys()].filter((name) => !exposed.has(name)).sort();
  console.log(`${kind}: ${referenced.size} referenced, ${missing.length} missing`);
  for (const name of missing) {
    console.log(`  ✖ ${name}`);
    for (const file of referenced.get(name)) console.log(`      ${file}`);
  }
  return missing.length;
}

async function main() {
  const env = resolveEnv();
  if (!env.url || !env.key) {
    console.error("check-schema: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(2);
  }

  const referenced = collectReferences();
  let exposed;
  try {
    exposed = await fetchExposedObjects(env);
  } catch (err) {
    console.error(`check-schema: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }

  const missing =
    report("Tables/views", referenced.tables, exposed.tables) +
    report("RPC functions", referenced.rpcs, exposed.rpcs);

  if (missing > 0) {
    console.error(`check-schema: ${missing} referenced database object(s) do not exist`);
    process.exit(1);
  }
  console.log("check-schema: ok");
}

await main();
