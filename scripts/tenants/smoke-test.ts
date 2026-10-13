/**
 * Smoke test of the live ERP (prompt 11, docs/runbooks/tenant-1-cutover.md). Read-only.
 *
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run tenants:smoke -- --save before.json
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run tenants:smoke -- --compare before.json
 *
 *   --url <site>        default https://erp.del-groups.com (SMOKE_BASE_URL)
 *   --save <file>       write the fingerprint (counts, newest sale, Supabase host; no secrets)
 *   --compare <file>    compare with a saved fingerprint: same project, nothing lost
 *
 * SMOKE_EMAIL / SMOKE_PASSWORD: an ERP user who can see sales and stock (put them in your
 * shell or .env.local, never in a file you commit). Exit code 0 = all checks passed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compareFingerprints, runSmoke, type Check, type Fingerprint } from "./smoke.ts";

function usage(message: string): never {
  console.error(`smoke-test: ${message}`);
  console.error("usage: smoke-test [--url <site>] [--save <file> | --compare <file>]   (SMOKE_EMAIL, SMOKE_PASSWORD)");
  process.exit(2);
}

function args(argv: string[]) {
  const out = { url: (process.env.SMOKE_BASE_URL ?? "").trim() || "https://erp.del-groups.com", save: "", compare: "" };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? usage(`${argv[i - 1]} needs a value`);
    if (argv[i] === "--url") out.url = next();
    else if (argv[i] === "--save") out.save = next();
    else if (argv[i] === "--compare") out.compare = next();
    else usage(`unknown option ${argv[i]}`);
  }
  if (out.save && out.compare) usage("use --save or --compare, not both");
  return out;
}

function print(title: string, checks: Check[]) {
  console.log(`\n${title}`);
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(24)} ${c.detail}`);
}

async function main() {
  const opts = args(process.argv.slice(2));
  const email = (process.env.SMOKE_EMAIL ?? "").trim();
  const password = process.env.SMOKE_PASSWORD ?? "";
  if (!email || !password) usage("set SMOKE_EMAIL and SMOKE_PASSWORD");
  const before = opts.compare ? (JSON.parse(readFileSync(opts.compare, "utf8")) as Fingerprint) : null;

  const result = await runSmoke({ baseUrl: opts.url, email, password, fetch: (input, init) => fetch(input, init) });
  print(`Smoke test of ${opts.url}`, result.checks);
  let ok = result.ok;

  if (opts.save && result.fingerprint) {
    writeFileSync(opts.save, `${JSON.stringify(result.fingerprint, null, 2)}\n`);
    console.log(`\nfingerprint saved to ${opts.save}`);
  }
  if (before && result.fingerprint) {
    const diff = compareFingerprints(before, result.fingerprint);
    print(`Compared with ${opts.compare}`, diff);
    ok = ok && diff.every((c) => c.ok);
  }
  console.log(`\n${ok ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`smoke-test: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
