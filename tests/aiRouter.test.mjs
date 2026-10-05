// Upgrade phase 1: the native assistant sends each question to the cheapest model tier that fits.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIER_MODELS,
  estimateCostUsd,
  resolveTierModels,
  routeRequest,
} from "../src/lib/ai/native/router.ts";

test("greetings and empty input go to the fast tier", () => {
  for (const text of ["Salam", "hello!", "Спасибо", "سلام", "   "]) {
    assert.equal(routeRequest(text).tier, "fast", text);
  }
});

test("short lookups go to the fast tier", () => {
  for (const text of [
    "MATT məhsulunun qalığı neçədir?",
    "How many chairs are in stock?",
    "Сколько остаток по фанере?",
    "موجودی صندلی چقدر است؟",
  ]) {
    assert.equal(routeRequest(text).tier, "fast", text);
  }
});

test("analysis questions go to the deep tier", () => {
  for (const text of [
    "Bu ayın satışlarını keçən ayla müqayisə et",
    "Why did profit drop in September?",
    "Сделай прогноз продаж на следующий месяц",
    "فروش این ماه را تحلیل کن",
  ]) {
    assert.equal(routeRequest(text).tier, "deep", text);
  }
});

test("analysis wins over lookup words", () => {
  assert.equal(routeRequest("How many sales did we lose and why?").tier, "deep");
});

test("long prompts go to the deep tier", () => {
  assert.equal(routeRequest("a".repeat(700)).tier, "deep");
});

test("everything else goes to the standard tier", () => {
  assert.equal(routeRequest("Prepare a summary of open production orders for Polywood clients").tier, "standard");
});

test("forced tier overrides the heuristics", () => {
  assert.deepEqual(routeRequest("Salam", { forceTier: "deep" }), { tier: "deep", reason: "forced" });
});

test("tier models can be overridden from env", () => {
  assert.deepEqual(resolveTierModels({}), DEFAULT_TIER_MODELS);
  assert.equal(resolveTierModels({ AI_MODEL_FAST: " 'claude-sonnet-5-5' " }).fast, "claude-sonnet-5-5");
});

test("cost estimate uses per-model prices and cache multipliers", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 1_000_000, cache_write_tokens: 0 };
  // Haiku: 1.00 input + 0.10 cache read + 0.50 output
  assert.equal(estimateCostUsd("claude-haiku-4-5", usage), 1.6);
  // Opus 5.5: 4.00 + 0.40 + 2.00
  assert.equal(estimateCostUsd("claude-opus-5-5", usage), 6.4);
  assert.equal(estimateCostUsd("unknown-model", usage), null);
});
