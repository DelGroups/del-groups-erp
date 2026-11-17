// AST-7: the morning briefing on the home page and its on/off switch. The setting is off unless it says
// enabled: true; the nightly job reads it first and, when off, reads nothing else and never calls Claude;
// only admins may flip it, every flip is audited (or undone); the widget is registered behind the
// assistant and shows the switch only to admins; the Switch is an accessible role="switch"; texts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRIEFING_OFF, BRIEFING_SETTING_KEY, briefingSettingValue, parseBriefingSetting, readBriefingSetting } from "../src/lib/assistant/insights/briefingSetting.ts";
import { nightlyBriefings } from "../src/lib/assistant/insights/briefingServer.ts";
import { visibleTo, widgetDef } from "../src/lib/home/registry.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the setting is off unless it says enabled: true", () => {
  assert.equal(BRIEFING_SETTING_KEY, "assistant_briefing");
  for (const v of [null, undefined, "on", 1, [], {}, { enabled: "true" }, { enabled: 1 }]) assert.deepEqual(parseBriefingSetting(v), BRIEFING_OFF);
  assert.deepEqual(parseBriefingSetting({ enabled: true, updated_by: "u1", updated_at: "2026-11-17T10:00:00.000Z" }), { enabled: true, updated_by: "u1", updated_at: "2026-11-17T10:00:00.000Z" });
  assert.deepEqual(briefingSettingValue(false, "u1", new Date("2026-11-17T10:00:00Z")), { enabled: false, updated_by: "u1", updated_at: "2026-11-17T10:00:00.000Z" });
});

function settingsDb(row, log = []) {
  return {
    from: (table) => {
      log.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        lte: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        range: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve(table === "system_settings" ? { data: row, error: null } : { data: null, error: null }),
        insert: () => Promise.resolve({ error: null }),
        upsert: () => Promise.resolve({ error: null }),
        then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad),
      };
      return q;
    },
    rpc: async () => ({ data: 0, error: null }),
  };
}

test("reading the switch: a missing row or an error is off", async () => {
  assert.equal((await readBriefingSetting(settingsDb(null))).enabled, false);
  assert.equal((await readBriefingSetting(settingsDb({ value: { enabled: true } }))).enabled, true);
  assert.equal((await readBriefingSetting({ from: () => { throw new Error("down"); } })).enabled, false);
});

test("switched off: the nightly job reads nothing else and never calls Claude", async () => {
  const log = [];
  const client = { messages: { create: async () => assert.fail("no Claude call while off") } };
  const profiles = [{ id: "a", is_active: true, full_name: "A", role: { name: "Admin", permissions: {} } }];
  const r = await nightlyBriefings({ apiKey: "k", db: settingsDb(null, log), today: "2026-11-17", client, profiles, env: {} });
  assert.deepEqual(r, { recipients: 0, written: 0, existing: 0, errors: 0, budget: false, switchedOff: true });
  assert.deepEqual(log, ["system_settings"]);
});

test("switched on: the job runs as before", async () => {
  let calls = 0;
  const client = { messages: { create: async () => (calls++, { content: [{ type: "text", text: "Sabahınız xeyir." }], usage: { input_tokens: 10, output_tokens: 5 } }) } };
  const profiles = [{ id: "a", is_active: true, full_name: "A", role: { name: "Admin", permissions: {} } }];
  const r = await nightlyBriefings({ apiKey: "k", db: settingsDb({ value: { enabled: true } }), today: "2026-11-17", client, profiles, env: { ASSISTANT_MONTHLY_BUDGET_USD: "10" } });
  assert.equal(r.switchedOff, false);
  assert.equal(r.written, 1);
  assert.equal(calls, 1);
});

test("only admins flip it; every flip is audited, or undone", () => {
  const action = read("src/lib/actions/assistantBriefing.ts");
  assert.match(action, /if \(!g \|\| !g\.isAdmin\) return \{ success: false, error: "assistant\.briefingWidget\.notAllowed" \};/);
  assert.match(action, /from\("audit_logs"\)\.insert\(\{[\s\S]*user_id: g\.userId,[\s\S]*module: "SECURITY",[\s\S]*old_values_json: \{ key: BRIEFING_SETTING_KEY, enabled: before\.enabled \},[\s\S]*new_values_json: \{ key: BRIEFING_SETTING_KEY, enabled \}/);
  assert.match(action, /if \(audit\.error\) \{[\s\S]*value: before[\s\S]*return \{ success: false/);
  assert.match(action, /if \(!isAssistantV2On\(\)\) return null;/);
  // Managers (financial reports) may read the state, but canChange is admins only.
  assert.match(action, /canChange: g\.isAdmin/);
});

test("the widget: behind the assistant, admins and managers; the switch only for admins", () => {
  const def = widgetDef("morning_briefing");
  assert.equal(def.requires, "assistantBriefing");
  assert.equal(def.remote, false);
  const ctx = (assistantBriefing) => ({ isEnabled: () => true, can: () => true, financials: true, flags: { newCrm: false, assistantBriefing } });
  assert.equal(visibleTo(def, ctx(true)), true);
  assert.equal(visibleTo(def, ctx(false)), false);
  assert.equal(visibleTo(def, ctx(undefined)), false);
  const home = read("src/components/home/useHomeLayout.ts");
  assert.match(home, /const assistantBriefing = assistantOn && userHasLegacyPermission\(profile, "can_view_financial_reports"\);/);
  const widget = read("src/components/home/widgets/BriefingWidget.tsx");
  assert.match(widget, /\{canChange \? \(\s*<div className="ds-briefing-switch">/);
  assert.match(widget, /canChange=\{sw\.data\?\.canChange === true\}/);
  assert.match(widget, /enabled: !props\.preview && on,/, "no briefing request while switched off");
  assert.match(widget, /assistant\.briefingWidget\.offTitle/);
  assert.match(read("src/components/home/widgets/index.ts"), /morning_briefing: BriefingWidget,/);
});

test("the Switch is a real switch for keyboards and screen readers", () => {
  const sw = read("src/design-system/components/Switch.tsx");
  assert.match(sw, /role="switch"/);
  assert.match(sw, /aria-checked=\{checked\}/);
  assert.match(sw, /<label htmlFor=\{id\}/);
  assert.match(sw, /type="button"/);
  assert.match(read("src/design-system/components/index.ts"), /export \{ Switch, type SwitchProps \} from "\.\/Switch";/);
  assert.match(read("src/design-system/components.css"), /prefers-reduced-motion: reduce\)[\s\S]*\.ds-switch-thumb/);
});

test("widget texts exist in az / en / ru", () => {
  const keys = ["open", "emptyTitle", "emptyHint", "offTitle", "offHint", "offHintAdmin", "switchLabel", "switchOn", "switchOff", "saveFailed", "notAllowed", "preview"];
  for (const k of keys) {
    assert.ok(azMessages.assistant.briefingWidget[k] && enMessages.assistant.briefingWidget[k], k);
    assert.match(ruMessages.assistant.briefingWidget[k], /[А-Яа-яЁё]/, k);
  }
  assert.equal(azMessages.assistant.briefingWidget.offTitle, "Gündəlik icmal söndürülüb");
  for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.home.widgets.morning_briefing.title && m.home.widgets.morning_briefing.description);
});
