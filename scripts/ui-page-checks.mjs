// Page-level layout checks of npm run ui:guard (UI-5, docs/ui-standard.md "Page scroll"). Pure
// functions over measurements taken in the page (measurePage below runs in the browser), so
// tests/uiAudit.test.mjs covers the rules without a browser.

/** Most empty space (px) allowed between the last content and the bottom of a page that scrolls. */
export const MAX_EMPTY_BAND = 48;

/**
 * Problems of one page:
 * - more than one element that really scrolls vertically (the shell's [data-scroll-root] only);
 * - the page scrolls sideways;
 * - the window itself is taller than the screen (a second, window scrollbar next to the content
 *   area's, with an empty band under the shell when it is scrolled; SCROLL-1);
 * - an empty band under the last content (a fixed-height box that is taller than its content);
 * - a DataGrid whose rows have actions but no visible actions column, or whose actions column is
 *   outside the window;
 * - a numeric column whose cells or header are not end-aligned;
 * - an open popover clipped by an ancestor or by the window.
 */
export function findPageIssues(m) {
  const issues = [];
  const scrollers = m.verticalScrollers ?? [];
  const extra = scrollers.filter((s) => !s.isRoot);
  if (extra.length) issues.push({ check: "nested-scroll", where: extra.map((s) => s.where).join(", "), detail: `${scrollers.length} vertical scroll containers (only [data-scroll-root] may scroll)` });
  if (typeof m.pageScrollHeight === "number" && typeof m.viewportHeight === "number" && m.pageScrollHeight - m.viewportHeight > 1) {
    issues.push({ check: "window-scroll", where: "page", detail: `the window is ${m.pageScrollHeight}px tall on a ${m.viewportHeight}px screen (only [data-scroll-root] may scroll)` });
  }
  if (m.pageScrollWidth - m.viewportWidth > 1) issues.push({ check: "page-hscroll", where: "page", detail: `page is ${m.pageScrollWidth}px wide in a ${m.viewportWidth}px window` });
  if (m.root && m.root.scrollHeight > m.root.clientHeight + 1 && m.root.emptyBand > MAX_EMPTY_BAND) {
    issues.push({ check: "empty-band", where: "page", detail: `${Math.round(m.root.emptyBand)}px empty under the last content` });
  }
  for (const g of m.grids ?? []) {
    if (g.hasRowActions && !g.actionsColumn) issues.push({ check: "grid-actions", where: g.where, detail: "rows have actions but the grid has no actions column" });
    if (g.actionsColumn && !g.actionsVisible) issues.push({ check: "grid-actions", where: g.where, detail: "the actions column is outside the window" });
    for (const c of g.misaligned ?? []) issues.push({ check: "grid-align", where: g.where, detail: `numeric column "${c}" is not end-aligned` });
    if (g.headerHidden) issues.push({ check: "grid-header", where: g.where, detail: "the grid header scrolled out of view while its rows are visible" });
  }
  for (const p of m.popovers ?? []) {
    if (p.clippedBy) issues.push({ check: "popover-clipped", where: p.where, detail: `clipped by ${p.clippedBy}` });
  }
  issues.push(...findUnifiedIssues(m));
  return issues;
}

/** Pages without breadcrumbs (NAV-2): Home and the app launcher. */
export const NO_CRUMB_PATHS = new Set(["/", "/apps"]);
/** Smallest pointer target (WCAG 2.2 2.5.8, A11Y-3). */
export const MIN_TARGET = 24;

/**
 * UI rulebook checks of the unified UI (UI-7, docs/ui-standard.md), only while UI_UNIFIED is on:
 * - shell: no app tab bar in the shell header (NAV-1); every page of an app has breadcrumbs with
 *   at least two crumbs (NAV-2);
 * - migrated pages (PageFrame, data-ui-page): exactly one <h1>, inside the PageHeader (PAGE-1); at
 *   most one visible primary button outside dialogs (ACT-2); a list's toolbar starts in the top
 *   half of the window on desktop and within the first screen on a phone (PAGE-3); no button,
 *   tab or menu item smaller than 24 × 24 px (A11Y-3).
 */
export function findUnifiedIssues(m) {
  const u = m.unified;
  if (!u) return [];
  const out = [];
  if (u.shellTabbar) out.push({ check: "shell-tabbar", where: "shell", detail: "the shell shows app tabs; the app side menu replaces them (NAV-1)" });
  if (u.inApp && !NO_CRUMB_PATHS.has(u.path) && u.crumbCount < 2) out.push({ check: "breadcrumbs", where: u.path, detail: `${u.crumbCount} crumb(s); every page of an app has App › Page (NAV-2)` });
  if (!u.uiPage) return out;
  if (u.h1Count !== 1) out.push({ check: "h1-count", where: u.path, detail: `${u.h1Count} <h1> on the page (exactly one, in PageHeader: PAGE-1)` });
  else if (!u.h1InHeader) out.push({ check: "h1-header", where: u.path, detail: "the <h1> is not inside .ds-page-header (PAGE-1)" });
  if (u.primaryCount > 1) out.push({ check: "primary-count", where: u.path, detail: `${u.primaryCount} primary buttons visible (one per screen: ACT-2)` });
  if (typeof u.toolbarTop === "number" && typeof m.viewportHeight === "number") {
    const limit = m.viewportWidth >= 1024 ? 0.5 : 1;
    if (u.toolbarTop > m.viewportHeight * limit) out.push({ check: "toolbar-low", where: u.path, detail: `toolbar starts at ${Math.round(u.toolbarTop)}px (limit ${Math.round(m.viewportHeight * limit)}px: PAGE-3)` });
  }
  for (const t of u.smallTargets ?? []) out.push({ check: "small-target", where: u.path, detail: `${t.what} is ${t.width}×${t.height}px (at least ${MIN_TARGET}×${MIN_TARGET}: A11Y-3)` });
  return out;
}

/** Runs in the page (page.evaluate): the measurements findPageIssues needs. */
export function measurePage() {
  const name = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };
  const verticalScrollers = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY)) continue;
    if (el.scrollHeight - el.clientHeight <= 1 || el.clientHeight === 0) continue;
    // Popovers, menus, dialogs and drawers may scroll inside: they are not the page.
    if (el.closest("[data-radix-popper-content-wrapper], [role='dialog'], [role='menu'], [role='listbox'], .ds-menu, [data-ds-portal]")) continue;
    // A side menu (the classic sidebar's <aside>) scrolls its own links: it is not the page.
    if (el.closest("aside")) continue;
    if (s.position === "fixed" || el.closest("[style*='position: fixed']")) continue;
    verticalScrollers.push({ where: name(el), isRoot: el.hasAttribute("data-scroll-root") });
  }
  const rootEl = document.querySelector("[data-scroll-root]");
  let root = null;
  if (rootEl) {
    const children = [...rootEl.children].filter((c) => c.getBoundingClientRect().height > 0);
    const last = children.length ? Math.max(...children.map((c) => c.offsetTop + c.offsetHeight)) : 0;
    const pad = parseFloat(getComputedStyle(rootEl).paddingBottom) || 0;
    root = { scrollHeight: rootEl.scrollHeight, clientHeight: rootEl.clientHeight, emptyBand: rootEl.scrollHeight - last - pad };
  }
  const grids = [...document.querySelectorAll(".ds-grid-root:not(.ds-line-grid)")].map((g, i) => {
    const frame = g.querySelector(".ds-grid-frame");
    const head = g.querySelector(".ds-grid-head-wrap");
    const actionsCell = g.querySelector(".ds-grid-scroll td.ds-grid-actions");
    const r = actionsCell?.getBoundingClientRect();
    const misaligned = [];
    for (const th of g.querySelectorAll(".ds-grid-head-table th.is-num")) {
      if (getComputedStyle(th).textAlign !== "end" && getComputedStyle(th).textAlign !== "right") misaligned.push(th.textContent.trim());
    }
    const firstNumCell = g.querySelector(".ds-grid-scroll td.is-num");
    if (firstNumCell && !["end", "right"].includes(getComputedStyle(firstNumCell).textAlign)) misaligned.push(firstNumCell.getAttribute("data-col") ?? "?");
    let headerHidden = false;
    if (head && frame) {
      const fr = frame.getBoundingClientRect();
      const hr = head.getBoundingClientRect();
      const rowsVisible = fr.bottom > hr.bottom + 8 && fr.top < window.innerHeight;
      headerHidden = rowsVisible && (hr.bottom < 0 || hr.top > window.innerHeight);
    }
    return {
      where: g.closest("[data-ui-frame]")?.getAttribute("data-ui-frame") ?? `grid ${i + 1}`,
      hasRowActions: !!g.querySelector("[data-grid-stop] button, .ds-row-menu-trigger"),
      actionsColumn: !!actionsCell,
      actionsVisible: !!r && r.right <= window.innerWidth + 1 && r.left >= -1 && r.width > 0,
      misaligned,
      headerHidden,
    };
  });
  const popovers = [...document.querySelectorAll("[data-radix-popper-content-wrapper]")].map((w) => {
    const r = w.getBoundingClientRect();
    let clippedBy = null;
    if (r.top < -1 || r.left < -1 || r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1) clippedBy = "the window";
    for (let el = w.parentElement; el && el !== document.body && !clippedBy; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (/(hidden|clip|auto|scroll)/.test(`${s.overflowX} ${s.overflowY}`)) {
        const b = el.getBoundingClientRect();
        if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1) clippedBy = name(el);
      }
    }
    return { where: w.textContent.trim().slice(0, 40), clippedBy };
  });
  // UI-7: the rulebook checks (findUnifiedIssues), only while the unified UI is on.
  let unified = null;
  if (document.documentElement.hasAttribute("data-ui-unified")) {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
    };
    const crumbNav = [...document.querySelectorAll("nav[data-ds-breadcrumbs]")].find(shown);
    const uiPage = document.querySelector("[data-ui-page]");
    const h1s = [...document.querySelectorAll("h1")].filter(shown);
    const toolbar = uiPage ? [...uiPage.querySelectorAll(".ds-toolbar")].find(shown) : null;
    const scrollRoot = document.querySelector("[data-scroll-root]");
    const smallTargets = [];
    if (uiPage) {
      for (const el of uiPage.querySelectorAll("button, [role='tab'], [role='menuitem'], [role='radio'], a.ds-btn")) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) smallTargets.push({ what: name(el), width: Math.round(r.width), height: Math.round(r.height) });
      }
    }
    unified = {
      path: location.pathname.replace(/\/+$/, "") || "/",
      inApp: !!document.querySelector("[data-shell-app]"),
      shellTabbar: !!document.querySelector(".ds-shell-header .ds-tabbar"),
      crumbCount: crumbNav ? crumbNav.querySelectorAll("li").length : 0,
      uiPage: !!uiPage,
      h1Count: h1s.length,
      h1InHeader: h1s.length === 1 && !!h1s[0].closest(".ds-page-header"),
      primaryCount: [...document.querySelectorAll(".ds-btn-primary")].filter((b) => shown(b) && !b.closest("[role='dialog']")).length,
      toolbarTop: toolbar ? toolbar.getBoundingClientRect().top + (scrollRoot?.scrollTop ?? 0) : null,
      smallTargets: smallTargets.slice(0, 10),
    };
  }
  return {
    unified,
    viewportWidth: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    // Measured even while the shell locks the window (globals.css): anything that escapes the
    // content area still makes the document taller than the screen.
    viewportHeight: window.innerHeight,
    pageScrollHeight: document.documentElement.scrollHeight,
    verticalScrollers,
    root,
    grids,
    popovers,
  };
}
