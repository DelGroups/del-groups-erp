// LOT-1: lot tracking database core (flag, permissions, migration text). The SQL behaviour is
// tested in supabase/tests/lot_core.sql (CI: db-baseline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLotTrackingEnabled, lotTrackingActive, lotTrackingAudience } from "../src/lib/features/lotTracking.ts";
import { DATE_CHANGE_CODES, issueItems } from "../src/lib/documents/dateChange.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261115100000_lot_core.sql";
/** The migration without comment lines. */
const sql = () =>
  read(MIGRATION)
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
/** The body of one function. */
const fnBody = (name) => {
  const m = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`).exec(sql());
  assert.ok(m, name);
  return m[0];
};

test("LOT_TRACKING is off unless \"true\"; the audience is admins unless \"all\"", () => {
  assert.equal(isLotTrackingEnabled({}), false);
  assert.equal(isLotTrackingEnabled({ LOT_TRACKING: "1" }), false);
  assert.equal(isLotTrackingEnabled({ LOT_TRACKING: " TRUE " }), true);
  assert.equal(lotTrackingAudience({}), "admins");
  assert.equal(lotTrackingAudience({ LOT_TRACKING_AUDIENCE: "admins" }), "admins");
  assert.equal(lotTrackingAudience({ LOT_TRACKING_AUDIENCE: "All" }), "all");
  assert.equal(lotTrackingActive({ enabled: false, audience: "all", isAdmin: true }), false);
  assert.equal(lotTrackingActive({ enabled: true, audience: "admins", isAdmin: false }), false);
  assert.equal(lotTrackingActive({ enabled: true, audience: "admins", isAdmin: true }), true);
  assert.equal(lotTrackingActive({ enabled: true, audience: "all", isAdmin: false }), true);
});

test("permissions lots.view and lots.manage in the inventory matrix, with texts in az, en and ru", async () => {
  const manifest = read("src/modules/inventory/manifest.ts");
  assert.match(manifest, /\{ group: "inventory", key: "view_lots",[^}]*legacyKey: "can_view_lots"/);
  assert.match(manifest, /\{ group: "inventory", key: "manage_lots",[^}]*legacyKey: "can_manage_lots"/);
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.lots.permissions.view.trim());
    assert.ok(m.lots.permissions.manage.trim());
    assert.ok(m.dateChange.issues.lot_negative.trim());
  }
  // lots_can: admin, the role permission, the overrides or the matrix (inventory.view_lots / manage_lots).
  const can = fnBody("lots_can");
  assert.match(can, /public\.user_is_admin\(\)/);
  assert.match(can, /'can_' \|\| p_action \|\| '_lots'/);
  assert.match(can, /-> '_matrix' -> 'inventory' ->> \(p_action \|\| '_lots'\)/);
});

test("tables: RLS on, read with lots.view, no write policies; the ledger is append-only", () => {
  const s = sql();
  for (const table of ["stock_lots", "stock_lot_balances", "stock_lot_movements", "stock_lot_events"]) {
    assert.match(s, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), table);
    assert.match(s, new RegExp(`CREATE POLICY ${table}_select ON public\\.${table} FOR SELECT TO authenticated USING \\(\\(SELECT public\\.lots_can\\('view'\\)\\)\\);`), table);
  }
  assert.doesNotMatch(s, /CREATE POLICY [\s\S]{0,120}FOR (INSERT|UPDATE|DELETE|ALL)/, "no write policy");
  assert.match(s, /CREATE TRIGGER trg_lot_ledger_guard\s+BEFORE UPDATE OR DELETE ON public\.stock_lot_movements/);
  assert.match(s, /CREATE TRIGGER trg_lot_events_guard\s+BEFORE UPDATE OR DELETE ON public\.stock_lot_events/);
  assert.match(s, /CREATE UNIQUE INDEX IF NOT EXISTS stock_lots_unassigned_uq ON public\.stock_lots \(product_id\) WHERE origin_type = 'unassigned'/);
  assert.match(s, /stock_lots_pick_idx ON public\.stock_lots \(product_id, status, exp_date NULLS LAST, received_date, lot_no\)/);
});

test("every stock change goes through the lot triggers, which never raise", () => {
  const s = sql();
  assert.match(s, /CREATE TRIGGER trg_lot_warehouse_stocks\s+AFTER INSERT OR DELETE OR UPDATE OF current_stock, warehouse_id ON public\.warehouse_stocks/);
  assert.match(s, /CREATE TRIGGER trg_lot_pieces_before\s+BEFORE INSERT ON public\.polywood_pieces/);
  assert.match(s, /CREATE TRIGGER trg_lot_pieces_after\s+AFTER INSERT OR DELETE OR UPDATE OF status, length_m, warehouse_id, lot_id ON public\.polywood_pieces/);
  for (const name of ["_lot_trg_warehouse_stocks", "_lot_trg_pieces_before", "_lot_trg_pieces_after"]) {
    const body = fnBody(name);
    // The whole body sits in a block whose handler writes an alert instead of raising.
    assert.match(body, /EXCEPTION WHEN OTHERS THEN\s+PERFORM public\._lot_alert\('lot_error'/, name);
    assert.doesNotMatch(body, /RAISE EXCEPTION/, name);
  }
  assert.doesNotMatch(fnBody("_lot_alert"), /RAISE EXCEPTION/);
  // Services, kits and Polywood are skipped on warehouse_stocks (Polywood follows its pieces).
  assert.match(fnBody("_lot_trg_warehouse_stocks"), /is_service[\s\S]*is_composite[\s\S]*'polywood'/);
});

test("no existing function is changed except the date-change blocker hook; FIFO cost layers only get a link", () => {
  const s = sql();
  const defined = [...s.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  const foreign = defined.filter((n) => !/^(_?lot_|lots_can$|next_lot_no$|_lot)/.test(n));
  assert.deepEqual(foreign, ["_date_change_extra_blockers"]);
  assert.match(fnBody("_date_change_extra_blockers"), /'lot_negative'/);
  assert.doesNotMatch(s, /UPDATE public\.inventory_batches SET (?!lot_id)/, "inventory_batches: only lot_id");
  assert.doesNotMatch(s, /inventory_batch_consumptions\s+SET|INSERT INTO public\.(journal_entries|inventory_batch_consumptions)/);
  assert.match(s, /CREATE TRIGGER trg_lot_date_change\s+BEFORE INSERT ON public\.document_date_changes/);
});

test("the backfill runs once and proves lots = stock", () => {
  const s = sql();
  assert.match(s, /value \? 'backfilled_at'/);
  assert.match(s, /RAISE EXCEPTION 'LOT-1 backfill: lots do not match the stock/);
  // The backfill block runs before the triggers are created.
  assert.ok(s.indexOf("v_result := public._lot_backfill();") < s.indexOf("CREATE TRIGGER trg_lot_warehouse_stocks"));
});

test("grants: only self-checking functions are open to signed-in users", () => {
  const s = sql();
  for (const fn of ["lots_can(TEXT)", "lot_integrity_report(INTEGER)", "lot_integrity_fix(UUID, UUID, TEXT)", "lot_update(UUID, JSONB, TEXT)", "lot_set_status(UUID, TEXT, TEXT)"]) {
    assert.ok(s.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`), fn);
  }
  for (const fn of ["lot_ctx_begin(JSONB)", "next_lot_no(DATE)", "_lot_apply(UUID, UUID, NUMERIC, UUID, TEXT, TEXT)", "_lot_backfill()", "_lot_trg_warehouse_stocks()"]) {
    assert.ok(s.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`), fn);
    assert.ok(!s.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`), fn);
  }
  for (const name of ["lot_integrity_report", "lot_update", "lot_set_status"]) assert.match(fnBody(name), /public\.lots_can\('(view|manage)'\)/, name);
  assert.match(fnBody("lot_integrity_fix"), /IF NOT public\.user_is_admin\(\) THEN/);
});

test("date changes: the lot issue is translated and shows the lot number", () => {
  assert.ok(DATE_CHANGE_CODES.includes("lot_negative"));
  assert.deepEqual(issueItems({ code: "lot_negative", message: "", details: { items: [{ lot_no: "LOT-2026-00001", warehouse: "Main", date: "2026-11-01", shortfall: 2 }] } }), [
    "LOT-2026-00001 · Main · 01.11.2026 · −2",
  ]);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/lot_core\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261115100000_lot_core/);
});
