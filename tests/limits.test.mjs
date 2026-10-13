// Plan limits in the ERP (prompt 12): states, parsing, the seat rule and the texts.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatBytesShort,
  isSeatLimitDbError,
  limitState,
  parseLimitStatus,
  percentUsed,
  seatsAvailable,
  UNLIMITED,
  worstLimit,
} from "../src/lib/limits/limits.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

test("a 5-seat plan: the 5th user fits, a 6th does not; no limit allows everything", () => {
  assert.equal(seatsAvailable({ used: 4, limit: 5 }), true);
  assert.equal(seatsAvailable({ used: 5, limit: 5 }), false);
  assert.equal(seatsAvailable({ used: 3, limit: 5 }, 3), false);
  assert.equal(seatsAvailable({ used: 500, limit: null }), true);
  assert.equal(seatsAvailable({ used: 5, limit: 5 }, 0), true, "re-checking without adding");
});

test("limit states: 80 % warns, 100 % blocks, null is unlimited", () => {
  assert.equal(limitState({ used: 0, limit: null }), "unlimited");
  assert.equal(limitState({ used: 79, limit: 100 }), "ok");
  assert.equal(limitState({ used: 80, limit: 100 }), "warning");
  assert.equal(limitState({ used: 100, limit: 100 }), "blocked");
  assert.equal(limitState({ used: 0, limit: 0 }), "blocked");
});

test("tenant_limit_status() output is parsed; anything odd means unlimited", () => {
  const status = parseLimitStatus({
    users: { used: 5, limit: 5 },
    storage: { used: "1073741824", limit: 2147483648 },
    ai: { used: 7.75, limit: "10.00" },
  });
  assert.deepEqual(status, {
    users: { used: 5, limit: 5 },
    storage: { used: 1073741824, limit: 2147483648 },
    ai: { used: 7.75, limit: 10 },
  });
  assert.deepEqual(parseLimitStatus(null), UNLIMITED);
  assert.deepEqual(parseLimitStatus("nope"), UNLIMITED);
  // Before any limit: used may be null (not measured).
  assert.deepEqual(parseLimitStatus({ users: { used: 3, limit: null }, storage: { used: null, limit: null }, ai: {} }), {
    users: { used: 3, limit: null },
    storage: { used: 0, limit: null },
    ai: { used: 0, limit: null },
  });
});

test("the banner shows the worst limit, blocked before warning", () => {
  assert.equal(worstLimit(UNLIMITED), null);
  assert.deepEqual(worstLimit({ ...UNLIMITED, ai: { used: 9, limit: 10 } }), { kind: "ai", state: "warning" });
  assert.deepEqual(
    worstLimit({ users: { used: 4, limit: 5 }, storage: { used: 10, limit: 10 }, ai: { used: 9, limit: 10 } }),
    { kind: "storage", state: "blocked" }
  );
});

test("helpers: seat trigger errors, percentages, sizes", () => {
  assert.equal(isSeatLimitDbError({ message: "seat_limit_reached" }), true);
  assert.equal(isSeatLimitDbError({ message: "duplicate key" }), false);
  assert.equal(isSeatLimitDbError(null), false);
  assert.equal(percentUsed({ used: 9, limit: 10 }), 90);
  assert.equal(percentUsed({ used: 12, limit: 10 }), 100);
  assert.equal(percentUsed({ used: 1, limit: null }), 0);
  assert.equal(formatBytesShort(512), "512 B");
  assert.equal(formatBytesShort(1536), "1.5 KB");
  assert.equal(formatBytesShort(20 * 1024 ** 3), "20 GB");
});

test("limit texts exist in az, en and ru with the same placeholders", () => {
  const keys = Object.keys(enMessages.limits).sort();
  for (const [locale, messages] of [["az", azMessages], ["ru", ruMessages]]) {
    assert.deepEqual(Object.keys(messages.limits).sort(), keys, locale);
    for (const key of keys) {
      const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(params(messages.limits[key]), params(enMessages.limits[key]), `${locale}.limits.${key}`);
    }
  }
  // Every limits.* key used in the code exists.
  const used = new Set();
  for (const file of [
    "src/lib/limits/messages.ts", "src/lib/limits/client.ts", "src/components/limits/SeatLimitNudge.tsx",
    "src/components/limits/LimitBanner.tsx", "src/app/users/page.client.tsx", "src/components/ai/AiAssistantWidget.tsx",
    "src/lib/actions/companyProfile.ts",
  ]) {
    for (const [, key] of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").matchAll(/"limits\.(\w+)"/g)) used.add(key);
  }
  assert.ok(used.size >= 10);
  for (const key of used) assert.ok(keys.includes(key), `limits.${key} missing`);
});
