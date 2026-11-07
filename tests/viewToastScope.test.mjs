// FIX-1: a view-engine screen must not call the design-system useToast() outside a toast scope.
//   npm test
//
// useToast() from @/design-system/components throws without a <ToastProvider> above it. On a
// view-engine screen the provider lives inside <EngineScreen> (its ViewScope), so a component
// that calls useToast() and renders <EngineScreen> itself, or that is rendered next to
// <EngineScreen> instead of inside it, crashed the whole page ("This page couldn't load":
// Cash & bank, Expenses, Employees, 2026-11-07). Such components must sit inside
// <ViewToastScope> (src/views/components/ViewScope.tsx).
//
// The check is static: for every file under src/modules that renders <EngineScreen and imports
// useToast from the design system, it finds the top-level components that need a toast and
// checks where each one is rendered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Top-level `function Name(` / `const Name = (` components, with their source text. */
export function components(source) {
  const starts = [...source.matchAll(/^(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|\w+)\s*=>)/gm)];
  return starts.map((m, i) => ({
    name: m[1] ?? m[2],
    body: source.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

/**
 * [start, end) of every <Tag ...> element in `text` (to its closing tag, or the end of a
 * self-closing tag). Braces are tracked so "/>" inside a prop like render={() => <X />} does
 * not end the tag early.
 */
export function elementSpans(text, tag) {
  const spans = [];
  const open = new RegExp(`<${tag}(?![\\w.])`, "g");
  for (const m of text.matchAll(open)) {
    let depth = 0;
    let i = m.index + m[0].length;
    let end = -1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && c === "/" && text[i + 1] === ">") {
        end = i + 2;
        break;
      } else if (depth === 0 && c === ">") {
        const close = text.indexOf(`</${tag}>`, i);
        end = close === -1 ? text.length : close + tag.length + 3;
        break;
      }
    }
    spans.push([m.index, end === -1 ? text.length : end]);
  }
  return spans;
}

const inside = (index, spans) => spans.some(([s, e]) => index > s && index < e);

/** Problems in one file: components whose useToast() call has no provider above it. */
export function toastScopeProblems(source) {
  if (!source.includes("<EngineScreen")) return [];
  if (!/import\s*\{[^}]*\buseToast\b[^}]*\}\s*from\s*"@\/design-system\/components"/.test(source)) return [];
  const comps = components(source);
  const byName = new Map(comps.map((c) => [c.name, c]));

  // Components that need a toast: they call useToast(), or (not being screens themselves)
  // render one that does.
  const needs = new Set(comps.filter((c) => /\buseToast\s*\(/.test(c.body)).map((c) => c.name));
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of comps) {
      if (needs.has(c.name) || c.body.includes("<EngineScreen")) continue;
      if ([...needs].some((n) => new RegExp(`<${n}(?![\\w.])`).test(c.body))) {
        needs.add(c.name);
        changed = true;
      }
    }
  }

  // Where a component is rendered inside <ViewToastScope> anywhere in the file, it is covered.
  const scoped = (name) =>
    comps.some((c) => {
      const spans = elementSpans(c.body, "ViewToastScope");
      return [...c.body.matchAll(new RegExp(`<${name}(?![\\w.])`, "g"))].some((m) => inside(m.index, spans));
    });

  const problems = [];
  for (const screen of comps.filter((c) => c.body.includes("<EngineScreen"))) {
    const engine = elementSpans(screen.body, "EngineScreen");
    const toastScopes = elementSpans(screen.body, "ViewToastScope");
    // 1. The screen itself calls useToast() above its own <EngineScreen>.
    if (/\buseToast\s*\(/.test(screen.body) && !scoped(screen.name)) {
      problems.push(`${screen.name} calls useToast() above its <EngineScreen>`);
    }
    // 2. A toast-needing component rendered next to <EngineScreen> instead of inside it.
    for (const name of needs) {
      if (name === screen.name || !byName.has(name)) continue;
      for (const m of screen.body.matchAll(new RegExp(`<${name}(?![\\w.])`, "g"))) {
        if (!inside(m.index, engine) && !inside(m.index, toastScopes) && !scoped(screen.name)) {
          problems.push(`${screen.name} renders <${name}> (needs a toast) outside <EngineScreen>`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

test("the check itself: catches a toast above or next to <EngineScreen>, accepts one inside", () => {
  const head = 'import { useToast } from "@/design-system/components";\n';
  const above = head + "export function A() {\n  const { toast } = useToast();\n  return <EngineScreen title=\"a\" />;\n}\n";
  const sibling = head +
    "export function B() {\n  return (<>\n    <EngineScreen title=\"b\" renderRecord={(r) => <View r={r} />} />\n    <Panel />\n  </>);\n}\n" +
    "function Panel() {\n  const { toast } = useToast();\n  return null;\n}\nfunction View() {\n  const { toast } = useToast();\n  return null;\n}\n";
  const wrapped = head +
    "export function C() {\n  return <ViewToastScope><CBody /></ViewToastScope>;\n}\n" +
    "function CBody() {\n  const { toast } = useToast();\n  return (<>\n    <EngineScreen title=\"c\" />\n    <Panel />\n  </>);\n}\n" +
    "function Panel() {\n  const { toast } = useToast();\n  return null;\n}\n";
  assert.deepEqual(toastScopeProblems(above), ["A calls useToast() above its <EngineScreen>"]);
  assert.deepEqual(toastScopeProblems(sibling), ["B renders <Panel> (needs a toast) outside <EngineScreen>"]);
  assert.deepEqual(toastScopeProblems(wrapped), []);
});

test("no view-engine screen calls useToast() outside a toast scope", () => {
  const problems = files(join(root, "src", "modules")).flatMap((file) =>
    toastScopeProblems(readFileSync(file, "utf8")).map((p) => `${relative(root, file).replace(/\\/g, "/")}: ${p}`)
  );
  assert.deepEqual(problems, [], `wrap these in <ViewToastScope> (src/views/components/ViewScope.tsx):\n${problems.join("\n")}`);
});
