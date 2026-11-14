// AST-2: Del Assistant's panel and avatar. The avatar's state machine and its reduced-motion branch,
// the panel's open/close, shortcut, width and layout rules, reading the chat stream (SSE) into messages,
// link safety, suggestions, history helpers, the texts in az/en/ru, and that nothing changes with the flag off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AVATAR_SIZES,
  AVATAR_STATES,
  INITIAL_AVATAR,
  TONE_TOKEN,
  avatarLabelKey,
  avatarMotion,
  avatarReducer,
  avatarTone,
  nextBlinkDelayMs,
  settleAfterMs,
} from "../src/lib/assistant/ui/avatar.ts";
import {
  INITIAL_PANEL,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  assistantUiActive,
  clampPanelWidth,
  closesOnEscape,
  composerKeyAction,
  isToggleShortcut,
  panelLayout,
  panelReducer,
  panelWidthKey,
  readPanelWidth,
  resizedWidth,
  writePanelWidth,
} from "../src/lib/assistant/ui/panel.ts";
import {
  applyStreamEvent,
  canRetry,
  contextFromPath,
  errorKey,
  firstName,
  messagesFromHistory,
  readEventStream,
  reasonFromResponse,
  safeLinks,
  stopMessage,
  suggestionKey,
  suggestionsFor,
} from "../src/lib/assistant/ui/thread.ts";
import { cleanTitle, hiddenContext, isHidden, parsePatch, toConversationItems } from "../src/lib/assistant/history.ts";
import { encodeSse } from "../src/lib/assistant/sse.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const run = (events, start = INITIAL_AVATAR) => events.reduce((m, e) => avatarReducer(m, typeof e === "string" ? { type: e } : e), start);

// ─── Avatar ─────────────────────────────────────────────────────────────────

test("a reply moves the avatar idle → thinking → speaking → success → idle", () => {
  let m = INITIAL_AVATAR;
  m = avatarReducer(m, { type: "send" });
  assert.equal(m.state, "thinking");
  m = avatarReducer(m, { type: "delta" });
  assert.equal(m.state, "speaking");
  m = avatarReducer(m, { type: "done" });
  assert.equal(m.state, "success");
  assert.equal(settleAfterMs(m), 1600);
  m = avatarReducer(m, { type: "settle" });
  assert.equal(m.state, "idle");
  assert.equal(settleAfterMs(m), null);
});

test("typing makes it listen; a stopped reply goes back to rest; a failed one alerts and settles", () => {
  assert.equal(run(["focus"]).state, "listening");
  assert.equal(run(["focus", "blur"]).state, "idle");
  assert.equal(run(["send", "focus"]).state, "thinking", "focus never interrupts a reply");
  assert.equal(run(["send", "delta", "stop"]).state, "idle");
  const failed = run(["send", { type: "fail" }]);
  assert.equal(failed.state, "alert");
  assert.equal(settleAfterMs(failed), 4000);
  assert.equal(avatarReducer(failed, { type: "settle" }).state, "idle");
  assert.equal(run(["delta"]).state, "idle", "a stray delta outside a reply changes nothing");
  assert.equal(run(["done"]).state, "idle");
});

test("the budget puts it to sleep, and only wake leaves sleep", () => {
  const asleep = run(["send", { type: "fail", budget: true }]);
  assert.equal(asleep.state, "sleeping");
  for (const e of ["send", "delta", "done", "focus", "settle"]) assert.equal(avatarReducer(asleep, { type: e }).state, "sleeping");
  assert.equal(avatarReducer(asleep, { type: "issue", severity: "error" }).state, "sleeping");
  assert.equal(avatarReducer(asleep, { type: "wake" }).state, "idle");
  assert.equal(run(["sleep"]).state, "sleeping");
});

test("issues (AST-5) colour the avatar, wait for a reply in flight, and return after it", () => {
  assert.equal(run([{ type: "issue", severity: "warning" }]).state, "attention");
  assert.equal(run([{ type: "issue", severity: "error" }]).state, "alert");
  // An error is not downgraded by a later warning.
  assert.equal(run([{ type: "issue", severity: "error" }, { type: "issue", severity: "warning" }]).issue, "error");
  // During a reply the state stays; after it, the issue's colour is back instead of idle.
  const busy = run(["send", { type: "issue", severity: "warning" }]);
  assert.equal(busy.state, "thinking");
  const after = run(["delta", "done", "settle"], busy);
  assert.equal(after.state, "attention");
  // An error-level issue's alert stays until the issue is cleared.
  const issueAlert = run([{ type: "issue", severity: "error" }]);
  assert.equal(settleAfterMs(issueAlert), null);
  assert.equal(avatarReducer(issueAlert, { type: "settle" }).state, "alert");
  assert.equal(avatarReducer(issueAlert, { type: "clear_issue" }).state, "idle");
  assert.deepEqual(run(["send", { type: "issue", severity: "warning" }, "clear_issue"]), { state: "thinking", issue: null });
});

test("every state has its own motion; reduced motion has no loop and no movement, only colour and eyes", () => {
  assert.deepEqual([...AVATAR_STATES], ["idle", "listening", "thinking", "speaking", "attention", "alert", "success", "sleeping"]);
  assert.deepEqual([...AVATAR_SIZES], [28, 40, 56]);
  assert.ok(avatarMotion("idle", false).breathe && avatarMotion("idle", false).blink);
  assert.ok(avatarMotion("thinking", false).orbit);
  assert.ok(avatarMotion("speaking", false).bounce);
  assert.ok(avatarMotion("attention", false).pulse);
  assert.ok(avatarMotion("alert", false).shake);
  assert.ok(avatarMotion("success", false).hop);
  assert.equal(avatarMotion("success", false).eyes, "arcs");
  assert.equal(avatarMotion("sleeping", false).eyes, "closed");
  assert.ok(avatarMotion("listening", false).lookDown);
  for (const s of AVATAR_STATES) {
    const r = avatarMotion(s, true);
    for (const k of ["breathe", "blink", "orbit", "bounce", "pulse", "shake", "hop"]) assert.equal(r[k], false, `${s}.${k} with reduced motion`);
    assert.equal(r.eyes, avatarMotion(s, false).eyes, "the eyes still tell the state");
  }
  // Colour by meaning, always from tokens.
  assert.equal(avatarTone("attention"), "warning");
  assert.equal(avatarTone("alert"), "danger");
  assert.equal(avatarTone("success"), "success");
  assert.equal(avatarTone("sleeping"), "muted");
  assert.equal(avatarTone("thinking"), "brand");
  for (const v of Object.values(TONE_TOKEN)) assert.match(v, /^var\(--ds-/);
});

test("blinks come every 4 to 7 seconds", () => {
  assert.equal(nextBlinkDelayMs(() => 0), 4000);
  assert.equal(nextBlinkDelayMs(() => 1), 7000);
  assert.equal(nextBlinkDelayMs(() => 0.5), 5500);
  assert.equal(nextBlinkDelayMs(() => 9), 7000);
  for (let i = 0; i < 50; i++) {
    const d = nextBlinkDelayMs();
    assert.ok(d >= 4000 && d <= 7000);
  }
});

test("the avatar component draws with tokens only, respects reduced motion and names its state", () => {
  const src = read("src/components/assistant/AssistantAvatar.tsx");
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(src.replace(/url\(#\$\{glowId\}\)/g, "")), "no raw hex colours");
  assert.ok(!/rgb\(|hsl\(/.test(src), "no raw colour functions");
  assert.match(src, /useReducedMotion/);
  assert.match(src, /avatarMotion\(state, reduced\)/);
  assert.match(src, /role: "img", "aria-label": label/);
  assert.match(src, /"aria-hidden": true/);
  const css = read("src/design-system/assistant.css");
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), "the panel's CSS uses tokens only");
  assert.ok(!/rgba?\(/.test(css));
  assert.match(css, /prefers-reduced-motion: reduce/);
});

// ─── Panel ──────────────────────────────────────────────────────────────────

test("open, close, toggle and the history view", () => {
  let s = INITIAL_PANEL;
  assert.deepEqual(s, { open: false, view: "chat" });
  s = panelReducer(s, { type: "toggle" });
  assert.equal(s.open, true);
  assert.equal(panelReducer(s, { type: "open" }), s, "opening an open panel changes nothing");
  s = panelReducer(s, { type: "history" });
  assert.deepEqual(s, { open: true, view: "history" });
  assert.deepEqual(panelReducer(s, { type: "chat" }), { open: true, view: "chat" });
  assert.deepEqual(panelReducer(s, { type: "toggle" }), { open: false, view: "chat" }, "closing resets the view");
  assert.deepEqual(panelReducer(s, { type: "close" }), { open: false, view: "chat" });
  assert.equal(panelReducer(INITIAL_PANEL, { type: "close" }), INITIAL_PANEL);
});

test("Ctrl+J and Cmd+J toggle; Escape closes unless handled inside", () => {
  assert.equal(isToggleShortcut({ key: "j", ctrlKey: true }), true);
  assert.equal(isToggleShortcut({ key: "J", metaKey: true }), true);
  assert.equal(isToggleShortcut({ key: "j" }), false);
  assert.equal(isToggleShortcut({ key: "j", ctrlKey: true, shiftKey: true }), false);
  assert.equal(isToggleShortcut({ key: "j", ctrlKey: true, altKey: true }), false);
  assert.equal(isToggleShortcut({ key: "k", ctrlKey: true }), false);
  assert.equal(closesOnEscape({ key: "Escape" }), true);
  assert.equal(closesOnEscape({ key: "Escape", defaultPrevented: true }), false);
  assert.equal(closesOnEscape({ key: "Enter" }), false);
  const provider = read("src/components/assistant/AssistantProvider.tsx");
  assert.match(provider, /isToggleShortcut\(e\)/);
  assert.match(provider, /restoreFocus/, "closing returns the focus to the opener");
});

test("Enter sends, Shift+Enter is a new line, an IME composition never sends", () => {
  assert.equal(composerKeyAction({ key: "Enter" }), "send");
  assert.equal(composerKeyAction({ key: "Enter", shiftKey: true }), "newline");
  assert.equal(composerKeyAction({ key: "Enter", isComposing: true }), null);
  assert.equal(composerKeyAction({ key: "a" }), null);
});

test("the width stays within 360–560 px and is remembered per user, even when storage fails", () => {
  assert.equal(clampPanelWidth(100), PANEL_MIN_WIDTH);
  assert.equal(clampPanelWidth(9999), PANEL_MAX_WIDTH);
  assert.equal(clampPanelWidth(Number.NaN), PANEL_DEFAULT_WIDTH);
  assert.equal(resizedWidth(400, 1000, 950), 450, "dragging left widens");
  assert.equal(resizedWidth(400, 1000, 1100), PANEL_MIN_WIDTH);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readPanelWidth(storage, "u1"), PANEL_DEFAULT_WIDTH);
  writePanelWidth(storage, "u1", 480);
  assert.equal(store.get(panelWidthKey("u1")), "480");
  assert.equal(readPanelWidth(storage, "u1"), 480);
  assert.equal(readPanelWidth(storage, "u2"), PANEL_DEFAULT_WIDTH, "each user has their own width");
  store.set(panelWidthKey("u3"), "abc");
  assert.equal(readPanelWidth(storage, "u3"), PANEL_DEFAULT_WIDTH);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readPanelWidth(broken, "u1"), PANEL_DEFAULT_WIDTH);
  assert.doesNotThrow(() => writePanelWidth(broken, "u1", 500));
  assert.equal(readPanelWidth(null, "u1"), PANEL_DEFAULT_WIDTH);
});

test("phones get a sheet, normal screens a panel over the page, wide screens push the page", () => {
  assert.equal(panelLayout(390), "sheet");
  assert.equal(panelLayout(767), "sheet");
  assert.equal(panelLayout(768), "overlay");
  assert.equal(panelLayout(1366), "overlay");
  assert.equal(panelLayout(1440), "push");
  assert.equal(panelLayout(1920), "push");
  assert.match(read("src/design-system/assistant.css"), /html\[data-assistant-dock\] body \{\s*padding-inline-end: var\(--ds-assistant-w/);
});

test("the panel is for the flag's audience only", () => {
  const base = { enabled: true, audience: "admins", aiModule: true, signedIn: true, isAdmin: true, authReady: true };
  assert.equal(assistantUiActive(base), true);
  assert.equal(assistantUiActive({ ...base, enabled: false }), false);
  assert.equal(assistantUiActive({ ...base, aiModule: false }), false);
  assert.equal(assistantUiActive({ ...base, signedIn: false }), false);
  assert.equal(assistantUiActive({ ...base, isAdmin: false }), false);
  assert.equal(assistantUiActive({ ...base, authReady: false }), false, "no flash before sign-in is known");
  assert.equal(assistantUiActive({ ...base, isAdmin: false, audience: "all" }), true);
});

test("with the flag off the old widget and the old header button stay exactly as they were", () => {
  const layout = read("src/components/layout/PageLayout.tsx");
  assert.match(layout, /aiEnabled \? assistantV2 \? <AssistantPanel floatingFromMd=\{!newShell\} \/> : <AiAssistantWidget \/> : null/);
  const shell = read("src/components/shell/NewShell.tsx");
  assert.match(shell, /assistantV2 \? \(\s*<AssistantHeaderButton \/>\s*\) : \(\s*<button type="button" className="ds-icon-btn" aria-label=\{t\("newShell.assistant"\)\} onClick=\{openAi\}>/);
  const root = read("src/app/layout.tsx");
  assert.match(root, /<AssistantProvider value=\{\{ enabled: isAssistantV2On\(\), audience: assistantAudience\(\) \}\}>/);
  const provider = read("src/components/assistant/AssistantProvider.tsx");
  assert.match(provider, /active \? \{ active, panel, avatar/);
  assert.match(provider, /: OFF/);
  // The old widget file is untouched by this work.
  assert.match(read("src/components/ai/AiAssistantWidget.tsx"), /AI_OPEN_EVENT/);
});

test("the review page is admins-only and needs the flag (or the dev-only lab switch)", () => {
  const page = read("src/app/settings/dev/avatar/page.tsx");
  assert.match(page, /if \(!isUiLabOpen\(\)\) \{\s*if \(!isAssistantV2On\(\)\) notFound\(\);/);
  assert.match(page, /!isAdminRole\(profile\?\.role\)\) notFound\(\)/);
  assert.match(read("src/proxy.ts"), /pathname === "\/settings\/dev\/avatar" && isUiLabOpen\(\)/);
});

// ─── Stream and thread ──────────────────────────────────────────────────────

function streamOf(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

test("the SSE stream is read in order even when events are split across chunks", async () => {
  const wire =
    encodeSse({ type: "start", conversationId: "c1" }) +
    encodeSse({ type: "tool_start", tool: "list_debtors", summary: "Debtors" }) +
    encodeSse({ type: "tool_end", tool: "list_debtors", ok: true, links: [{ label: "SS-1", href: "/sales/abc" }] }) +
    encodeSse({ type: "text_delta", text: "Konik " }) +
    encodeSse({ type: "text_delta", text: "owes 6 120 ₼" }) +
    encodeSse({ type: "done", reply: "Konik owes 6 120 ₼.", status: "ok", links: [{ label: "Evil", href: "https://evil.example" }], conversationId: "c1", skills: ["customers"], tier: "fast" });
  // Split at awkward places: inside JSON, inside the "\n\n", and inside a multi-byte character.
  const bytes = new TextEncoder().encode(wire);
  const cuts = [5, 40, 41, 97, bytes.indexOf(0xe2) + 1, bytes.length - 3];
  const parts = [];
  let last = 0;
  for (const c of cuts) {
    parts.push(bytes.slice(last, c));
    last = c;
  }
  parts.push(bytes.slice(last));
  const body = new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
  const seen = [];
  await readEventStream(body, (e) => seen.push(e));
  assert.deepEqual(seen.map((e) => e.type), ["start", "tool_start", "tool_end", "text_delta", "text_delta", "done"]);

  let messages = [{ id: "a", role: "assistant", content: "", status: "streaming", steps: [], links: [] }];
  for (const e of seen) messages = applyStreamEvent(messages, "a", e);
  const [m] = messages;
  assert.equal(m.content, "Konik owes 6 120 ₼.", "the final reply wins over the deltas");
  assert.equal(m.status, "done");
  assert.deepEqual(m.steps, [{ tool: "list_debtors", summary: "Debtors", ok: true }]);
  assert.deepEqual(m.links, [{ label: "SS-1", href: "/sales/abc" }], "an outside link never reaches the panel");
});

test("a broken line is skipped and a last event without a blank line still arrives", async () => {
  const seen = [];
  await readEventStream(streamOf(["data: {broken\n\n", 'data: {"type":"text_delta","text":"hi"}']), (e) => seen.push(e));
  assert.deepEqual(seen, [{ type: "text_delta", text: "hi" }]);
});

test("deltas build the reply; steps close; errors carry a reason; Stop keeps what arrived", () => {
  let ms = [{ id: "a", role: "assistant", content: "", status: "streaming", steps: [], links: [], question: "q" }];
  ms = applyStreamEvent(ms, "a", { type: "text_delta", text: "Hel" });
  ms = applyStreamEvent(ms, "a", { type: "text_delta", text: "lo" });
  ms = applyStreamEvent(ms, "a", { type: "tool_start", tool: "t1", summary: "" });
  assert.equal(ms[0].content, "Hello");
  assert.deepEqual(ms[0].steps, [{ tool: "t1", summary: "t1", ok: null }]);
  const stopped = stopMessage(ms, "a");
  assert.equal(stopped[0].status, "stopped");
  assert.equal(stopped[0].content, "Hello");
  assert.equal(stopped[0].steps[0].ok, false);
  const failed = applyStreamEvent(ms, "a", { type: "error", reason: "budget", message: "x" });
  assert.equal(failed[0].status, "error");
  assert.equal(failed[0].error, "budget");
  // A refusal after some text keeps the text as the answer.
  const refused = applyStreamEvent(ms, "a", { type: "error", reason: "refused", message: "" });
  assert.equal(refused[0].status, "done");
  // Other messages are never touched.
  const two = [...ms, { id: "b", role: "user", content: "x", status: "done", steps: [], links: [] }];
  assert.equal(applyStreamEvent(two, "a", { type: "text_delta", text: "!" })[1], two[1]);
});

test("errors are explained by their reason, and Retry only where trying again can help", () => {
  assert.equal(reasonFromResponse(401), "permission");
  assert.equal(reasonFromResponse(403, {}), "permission");
  assert.equal(reasonFromResponse(403, { code: "limit_ai" }), "limit");
  assert.equal(reasonFromResponse(404), "disabled");
  assert.equal(reasonFromResponse(429), "rate_limit");
  assert.equal(reasonFromResponse(500), "unavailable");
  assert.equal(canRetry("network"), true);
  assert.equal(canRetry("unavailable"), true);
  assert.equal(canRetry("rate_limit"), true);
  assert.equal(canRetry("budget"), false);
  assert.equal(canRetry("permission"), false);
  assert.equal(canRetry("disabled"), false);
  assert.equal(errorKey("network"), "assistant.errors.network");
});

test("only internal links are shown", () => {
  const links = safeLinks([
    { label: "Sale", href: "/sales/abc-1" },
    { label: "Dup", href: "/sales/abc-1" },
    { label: "Ext", href: "https://evil.example/x" },
    { label: "Proto", href: "//evil.example" },
    { label: "Js", href: "javascript:alert(1)" },
    { label: "Query", href: "/sales?x=1" },
    { label: "", href: "/customers" },
    { href: 5 },
    null,
  ]);
  assert.deepEqual(links, [
    { label: "Sale", href: "/sales/abc-1" },
    { label: "/customers", href: "/customers" },
  ]);
  assert.equal(safeLinks(Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, href: `/sales/${i}` }))).length, 8);
  const thread = read("src/components/assistant/AssistantThread.tsx");
  assert.match(thread, /AiAssistantMarkdown/, "reply markdown goes through the shared renderer, which links only isSafeInternalHref");
});

test("saved conversations come back as messages, with Retry knowing the question", () => {
  const ms = messagesFromHistory([
    { id: "1", role: "user", content: "Who owes?" },
    { id: "2", role: "assistant", content: "Konik.", steps: [{ tool: "list_debtors", ok: true, summary: "Debtors" }, { tool: "", ok: true }] },
    { id: "3", role: "system", content: "x" },
    { id: "4", role: "assistant", content: "" },
  ]);
  assert.equal(ms.length, 2);
  assert.equal(ms[1].question, "Who owes?");
  assert.deepEqual(ms[1].steps, [{ tool: "list_debtors", summary: "Debtors", ok: true }]);
  assert.equal(ms[0].steps.length, 0);
});

// ─── Context and suggestions ────────────────────────────────────────────────

test("the context is the page, and a sale page carries the sale's id", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(contextFromPath(`/sales/${id}`), { page: `/sales/${id}`, recordType: "sale", recordId: id });
  assert.deepEqual(contextFromPath("/sales/new"), { page: "/sales/new", recordType: null, recordId: null });
  assert.deepEqual(contextFromPath("/sales"), { page: "/sales", recordType: null, recordId: null });
  assert.deepEqual(contextFromPath(null), { page: "/", recordType: null, recordId: null });
  assert.equal(firstName("Aysel Məmmədova"), "Aysel");
  assert.equal(firstName("a@b.az"), "");
  assert.equal(firstName("  "), "");
});

test("suggestions follow the page and role, and never offer what the user may not see", () => {
  const all = () => true;
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(suggestionsFor({ context: contextFromPath(`/sales/${id}`), can: all }), ["saleSummary", "saleCustomerUnpaid", "salesToday", "salesTopCustomers"]);
  assert.deepEqual(suggestionsFor({ context: contextFromPath("/products"), can: all }).slice(0, 1), ["lowStock"]);
  assert.deepEqual(suggestionsFor({ context: contextFromPath("/production/orders"), can: all }).slice(0, 2), ["productionStatus", "lowStock"]);
  const stockOnly = (p) => p === "can_view_products";
  assert.deepEqual(suggestionsFor({ context: contextFromPath(`/sales/${id}`), can: stockOnly }), ["lowStock"]);
  assert.deepEqual(suggestionsFor({ context: contextFromPath("/"), can: () => false }), []);
  assert.ok(suggestionsFor({ context: contextFromPath("/"), can: all }).length <= 4);
  assert.equal(suggestionsFor({ context: contextFromPath("/"), can: all, max: 2 }).length, 2);
});

// ─── History ────────────────────────────────────────────────────────────────

test("history: soft-deleted chats leave the list; titles are cleaned; patches are validated", () => {
  const items = toConversationItems([
    { id: "a", title: " Old ", updated_at: "2026-11-01T10:00:00Z", context: null },
    { id: "b", title: "Hidden", updated_at: "2026-11-03T10:00:00Z", context: { hidden: true } },
    { id: "c", title: null, updated_at: "2026-11-02T10:00:00Z", context: { page: "/sales" } },
    { title: "no id" },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["c", "a"]);
  assert.equal(items[1].title, "Old");
  assert.equal(items[0].title, "");
  assert.equal(isHidden({ hidden: true }), true);
  assert.equal(isHidden({ hidden: "yes" }), false);
  const h = hiddenContext({ page: "/sales" });
  assert.equal(h.hidden, true);
  assert.equal(h.page, "/sales", "the saved context is kept");
  assert.equal(hiddenContext(null).hidden, true);
  assert.equal(cleanTitle("  a\n\tb  "), "a b");
  assert.equal(cleanTitle("x".repeat(200)).length, 80);
  assert.equal(cleanTitle("   "), null);
  assert.equal(cleanTitle(5), null);
  assert.deepEqual(parsePatch({ hidden: true }), { kind: "hide" });
  assert.deepEqual(parsePatch({ title: " New name " }), { kind: "rename", title: "New name" });
  assert.deepEqual(parsePatch({ title: "" }), { kind: "invalid" });
  assert.deepEqual(parsePatch(null), { kind: "invalid" });
});

test("history routes use the user's own session and the flag, never the service role", () => {
  const gate = read("src/app/api/assistant/conversations/gate.ts");
  assert.match(gate, /requireAuthenticatedApi\(\)/);
  assert.match(gate, /requireModuleApi\("ai"\)/);
  assert.match(gate, /isAssistantV2On\(\)/);
  assert.match(gate, /assistantAudience\(\) === "admins" && !isAdminRole/);
  for (const f of ["src/app/api/assistant/conversations/route.ts", "src/app/api/assistant/conversations/[id]/route.ts", "src/app/api/assistant/conversations/gate.ts"]) {
    const src = read(f);
    assert.ok(!/supabaseAdmin|createSupabaseAdminClient|service_role/.test(src), `${f} must not use the service role`);
  }
  const one = read("src/app/api/assistant/conversations/[id]/route.ts");
  assert.match(one, /\.eq\("user_id", gate\.userId\)/);
  assert.ok(!/\.delete\(/.test(one), "delete is soft");
  assert.match(one, /params: Promise<\{ id: string \}>/, "Next 16: params is a promise");
});

// ─── Texts ──────────────────────────────────────────────────────────────────

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

test("every assistant text exists in az, en and ru, and the languages are really translated", () => {
  const az = flatten(azMessages.assistant);
  const en = flatten(enMessages.assistant);
  const ru = flatten(ruMessages.assistant);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(az).sort());
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(az).sort());
  for (const [k, v] of Object.entries(az)) {
    assert.ok(typeof v === "string" && v.trim(), `az ${k}`);
    assert.ok(en[k].trim() && ru[k].trim(), `en/ru ${k}`);
    assert.ok(!/[А-Яа-яЁё]/.test(v), `no Cyrillic in az: ${k}`);
    if (k !== "shortcut") assert.ok(/[А-Яа-яЁё]/.test(ru[k]), `ru is Russian: ${k}`);
  }
  // Placeholders match across languages.
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(az)) {
    assert.equal(ph(en[k]), ph(az[k]), `en placeholders ${k}`);
    assert.equal(ph(ru[k]), ph(az[k]), `ru placeholders ${k}`);
  }
  // Every key the code builds exists: avatar labels, error reasons, suggestions.
  for (const s of AVATAR_STATES) assert.ok(flatten(azMessages)[avatarLabelKey(s)], avatarLabelKey(s));
  for (const r of ["budget", "permission", "limit", "rate_limit", "disabled", "network", "unavailable", "refused"]) assert.ok(flatten(azMessages)[errorKey(r)], r);
  for (const id of ["saleSummary", "saleCustomerUnpaid", "salesToday", "salesTopCustomers", "debtors", "lowStock", "financeSummary", "productionStatus"]) {
    assert.ok(flatten(azMessages)[suggestionKey(id)], id);
  }
});

test("every t() key used by the panel exists", () => {
  const files = [
    "src/components/assistant/AssistantPanel.tsx",
    "src/components/assistant/AssistantPanelParts.tsx",
    "src/components/assistant/AssistantThread.tsx",
    "src/components/assistant/AssistantComposer.tsx",
    "src/components/assistant/AssistantHistory.tsx",
    "src/components/assistant/AssistantLauncher.tsx",
    "src/app/settings/dev/avatar/AvatarReview.tsx",
  ];
  const all = { ...flatten(azMessages), ...flatten(enMessages) };
  for (const f of files) {
    for (const [, key] of read(f).matchAll(/\bt\("([a-zA-Z0-9_.]+)"/g)) {
      assert.ok(flatten(azMessages)[key] && flatten(enMessages)[key] && flatten(ruMessages)[key], `${f}: ${key}`);
      assert.ok(all[key]);
    }
  }
});

test("ui-standard basics in the new UI: no native select, no raw palette, no tiny text, one primary", () => {
  const dir = ["AssistantPanel", "AssistantPanelParts", "AssistantThread", "AssistantComposer", "AssistantHistory", "AssistantLauncher", "AssistantAvatar"];
  for (const name of dir) {
    const src = read(`src/components/assistant/${name}.tsx`);
    assert.ok(!/<select\b/.test(src), `${name}: no native select`);
    assert.ok(!/(text|bg|border)-(slate|gray|blue|red|amber|emerald|sky|indigo)-\d{2,3}/.test(src), `${name}: no palette classes`);
    assert.ok(!/text-\[(9|10|11)px\]/.test(src), `${name}: nothing below 12 px`);
    assert.ok(!/fixed inset-0/.test(src), `${name}: no hand-made overlay`);
    assert.ok(!/window\.(confirm|alert|prompt)/.test(src), `${name}: no window dialogs`);
  }
  const composer = read("src/components/assistant/AssistantComposer.tsx");
  assert.equal((composer.match(/variant="primary"/g) ?? []).length, 1, "Send is the one primary action");
  const panel = read("src/components/assistant/AssistantPanel.tsx");
  assert.match(panel, /@radix-ui\/react-dialog/, "built on the Radix dialog primitive");
  assert.match(panel, /modal=\{layout === "sheet"\}/);
});
