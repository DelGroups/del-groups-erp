// Journal entry numbers come from a sequence (20261111200000): the latest migration that
// defines create_journal_entry must keep it, never the 4 random digits that collided.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "supabase/migrations");

test("the latest create_journal_entry numbers entries from journal_entry_no_seq", () => {
  const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort().reverse();
  const file = files.find((f) => /CREATE OR REPLACE FUNCTION public\.create_journal_entry\(/i.test(readFileSync(join(dir, f), "utf8")));
  assert.ok(file, "a migration defines create_journal_entry");
  const sql = readFileSync(join(dir, file), "utf8");
  assert.match(sql, /nextval\('public\.journal_entry_no_seq'\)/, `${file} must number entries from the sequence`);
  assert.doesNotMatch(sql, /floor\(1000 \+ random\(\) \* 9000\)/, `${file} brings back the colliding random number`);
});
