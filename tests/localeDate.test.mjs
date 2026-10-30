import test from "node:test";
import assert from "node:assert/strict";
import { dateFormat } from "../src/lib/dates/localeDate.ts";

const d = new Date("2026-10-30T08:00:00Z");
test("az month and weekday names come from our tables", () => {
  assert.equal(dateFormat("az", { timeZone: "Asia/Baku", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d), "30 oktyabr 2026, cümə");
  assert.equal(dateFormat("az-AZ", { timeZone: "Asia/Baku", day: "numeric", month: "short" }).format(d), "30 okt");
  assert.equal(dateFormat("az", { timeZone: "Asia/Baku", weekday: "short", day: "numeric", month: "short" }).format(d), "30 okt, C.");
  assert.equal(dateFormat("az", { timeZone: "Asia/Baku", month: "long", year: "numeric" }).format(d), "oktyabr 2026");
});
test("az without names, en and ru stay on Intl", () => {
  assert.equal(dateFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(d), "October 30");
  assert.equal(dateFormat("az", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(d), new Intl.DateTimeFormat("az", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(d));
});
test("az time is HH:mm", () => {
  assert.equal(dateFormat("az", { timeZone: "Asia/Baku", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d), "30 okt 12:00");
});
