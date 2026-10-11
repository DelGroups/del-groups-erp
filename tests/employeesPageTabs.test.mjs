// Payroll's tabs on the HR employees screen (src/modules/payroll/components/employeesPageTabs.tsx).
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

// The file is TSX (icons, components), which plain Node cannot load, so read its tab entries as text.
const source = readFileSync(new URL("../src/modules/payroll/components/employeesPageTabs.tsx", import.meta.url), "utf8");
const field = (name) => [...source.matchAll(new RegExp(`${name}: "([^"]+)"`, "g"))].map((m) => m[1]);

const lookup = (messages, key) => key.split(".").reduce((node, part) => node?.[part], messages);

test("payroll adds the Payroll and Advances tabs, without clashing with HR's own tabs", () => {
  const ids = field("id");
  assert.deepEqual(ids, ["payroll", "advances"]);
  for (const id of ids) assert.ok(!["directory", "leaves"].includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every payroll tab label and button has a text in az, en and ru", () => {
  const keys = [...field("labelKey"), ...field("createLabelKey")];
  assert.deepEqual(keys, ["employees.tabs.payroll", "employees.tabs.advances", "employees.advance.newTitle"]);
  for (const [lang, messages] of Object.entries({ az: azMessages, en: enMessages, ru: ruMessages })) {
    for (const key of keys) assert.equal(typeof lookup(messages, key), "string", `${lang}: ${key}`);
  }
});

test("the employees route adds the payroll tabs only when payroll is enabled", () => {
  const route = readFileSync(new URL("../src/app/employees/page.client.tsx", import.meta.url), "utf8");
  assert.match(route, /isEnabled\("payroll"\) \? PAYROLL_EMPLOYEE_TABS : \[\]/);
});
