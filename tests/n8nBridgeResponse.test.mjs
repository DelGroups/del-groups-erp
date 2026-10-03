// P0-1: the AI bridge must never forward upstream error pages or follow redirects.
//   npm test
// Node >= 22.18 loads the TypeScript module directly (type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_UNAVAILABLE_MESSAGE,
  interpretUpstreamError,
  interpretUpstreamResponse,
} from "../src/lib/ai/n8nBridgeResponse.ts";

const SOCIAL_AI_404 =
  "<!DOCTYPE html><html><head><title>DEL SOCIAL AI</title></head><body>404: This page could not be found.</body></html>";

test("404 HTML page from another app is not forwarded", () => {
  const result = interpretUpstreamResponse({
    status: 404,
    contentType: "text/html; charset=utf-8",
    body: SOCIAL_AI_404,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.reason, "http_error");
  assert.ok(!JSON.stringify(result).includes("DEL SOCIAL AI"), "upstream body leaked");
});

test("redirect is treated as unavailable, not followed", () => {
  for (const status of [0, 301, 302, 307, 308]) {
    const result = interpretUpstreamResponse({ status, contentType: null, body: "" });
    assert.equal(result.ok, false, `status ${status}`);
    assert.equal(result.reason, "redirect");
  }
});

test("200 with an HTML body is rejected", () => {
  for (const contentType of ["text/html", null]) {
    const result = interpretUpstreamResponse({ status: 200, contentType, body: SOCIAL_AI_404 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "html_response");
  }
});

test("5xx is unavailable", () => {
  const result = interpretUpstreamResponse({
    status: 500,
    contentType: "application/json",
    body: '{"message":"secret stack trace"}',
  });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("secret stack trace"));
});

test("timeout maps to 504, other network errors to 502", () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.deepEqual(interpretUpstreamError(abort), { ok: false, status: 504, reason: "timeout" });
  const refused = interpretUpstreamError(new TypeError("fetch failed: ECONNREFUSED 10.0.0.1"));
  assert.equal(refused.status, 502);
  assert.equal(refused.reason, "network_error");
  assert.ok(!JSON.stringify(refused).includes("ECONNREFUSED"));
});

test("valid JSON answer passes through parsed", () => {
  const result = interpretUpstreamResponse({
    status: 200,
    contentType: "application/json",
    body: '{"reply":"Bu ay satış: 537 AZN"}',
  });
  assert.deepEqual(result, { ok: true, parsed: { reply: "Bu ay satış: 537 AZN" } });
});

test("plain-text answer passes through as text", () => {
  const result = interpretUpstreamResponse({ status: 200, contentType: "text/plain", body: "Salam" });
  assert.deepEqual(result, { ok: true, parsed: "Salam" });
});

test("user-facing message is the Azerbaijani unavailable text", () => {
  assert.equal(AI_UNAVAILABLE_MESSAGE, "AI xidməti hazırda əlçatan deyil");
});
