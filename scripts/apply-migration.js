#!/usr/bin/env node
/**
 * Temporary migration runner when `supabase db push` is unavailable.
 *
 * Resolution order for database access:
 * 1. DIRECT_URL or DATABASE_URL from `.env.local`
 * 2. SUPABASE_DB_PASSWORD + `supabase/.temp/pooler-url` (linked CLI project)
 * 3. `npx supabase db query --linked -f <migration>` fallback
 *
 * Usage:
 *   node scripts/apply-migration.js
 *   node scripts/apply-migration.js supabase/migrations/<file>.sql
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MIGRATION = path.join(
  ROOT,
  "supabase/migrations/20260907120000_sales_list_schema_alignment.sql"
);

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const env = {};
  const raw = fs.readFileSync(envPath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function resolveDatabaseUrl(env) {
  if (env.DIRECT_URL) return env.DIRECT_URL;
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const password =
    env.SUPABASE_DB_PASSWORD || env.POSTGRES_PASSWORD || env.DB_PASSWORD;
  if (!password) return null;

  const poolerPath = path.join(ROOT, "supabase/.temp/pooler-url");
  if (!fs.existsSync(poolerPath)) return null;

  const poolerUrl = fs.readFileSync(poolerPath, "utf8").trim();
  if (!poolerUrl) return null;

  try {
    const parsed = new URL(poolerUrl);
    parsed.password = password;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sslConfig(connectionString) {
  if (
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1")
  ) {
    return false;
  }
  return { rejectUnauthorized: false };
}

async function verifySalesColumns(client) {
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales'
      AND column_name IN (
        'warehouse_sent',
        'warehouse_slip_status',
        'additional_expenses',
        'additional_expenses_total'
      )
    ORDER BY column_name
  `);

  return rows.map((row) => row.column_name);
}

async function applyWithPg(connectionString, sql) {
  const { Client } = require("pg");
  const client = new Client({
    connectionString,
    ssl: sslConfig(connectionString),
  });

  const startedAt = Date.now();

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const columns = await verifySalesColumns(client);
    return {
      method: "pg",
      elapsedMs: Date.now() - startedAt,
      columns,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    await client.end();
  }
}

function applyWithSupabaseCli(migrationPath) {
  const startedAt = Date.now();
  const sql = fs.readFileSync(migrationPath, "utf8");
  const tempPath = path.join(ROOT, "supabase/.temp/apply-cli.sql");
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.writeFileSync(tempPath, sql, "utf8");

  if (process.platform === "win32") {
    execSync(`cmd /c type "${tempPath}" | npx supabase db query --linked`, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
  } else {
    execSync(`npx supabase db query --linked < "${tempPath}"`, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
  }

  return {
    method: "supabase-cli",
    elapsedMs: Date.now() - startedAt,
    columns: null,
  };
}

async function main() {
  const migrationPath = path.resolve(process.argv[2] || DEFAULT_MIGRATION);

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
  }

  const sql = fs.readFileSync(migrationPath, "utf8").trim();
  if (!sql) {
    throw new Error(`Migration file is empty: ${migrationPath}`);
  }

  console.log(`Applying migration: ${path.relative(ROOT, migrationPath)}`);

  const env = { ...process.env, ...loadEnvLocal() };
  const connectionString = resolveDatabaseUrl(env);

  let result;

  if (connectionString) {
    console.log(`Database host: ${new URL(connectionString).host}`);
    result = await applyWithPg(connectionString, sql);
  } else {
    console.log(
      "DIRECT_URL / DATABASE_URL not found in .env.local — using `supabase db query --linked`."
    );
    result = applyWithSupabaseCli(migrationPath);
  }

  console.log(`Migration applied successfully via ${result.method} in ${result.elapsedMs}ms.`);

  if (result.columns?.length) {
    console.log("Verified sales columns:", result.columns.join(", "));
  } else if (result.method === "supabase-cli") {
    console.log("Migration executed on linked Supabase project.");
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
