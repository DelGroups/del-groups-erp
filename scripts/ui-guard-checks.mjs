// Pure checks of scripts/ui-guard.mjs (UI-1, docs/ui-standard.md). The browser only measures;
// these functions decide, so tests/uiStandard.test.mjs covers them without a browser.

/** Line boxes of a text from the tops of its client rects (rects closer than `tolerance` px share a line). */
export function countLines(tops, tolerance = 3) {
  const sorted = [...tops].sort((a, b) => a - b);
  let lines = 0;
  let last = -Infinity;
  for (const top of sorted) {
    if (top - last > tolerance) {
      lines += 1;
      last = top;
    }
  }
  return lines;
}

/** An element marked data-ui-check="single-line" must stay on one line. */
export function checkSingleLine(m) {
  const lines = countLines(m.lineTops ?? []);
  return lines > 1 ? { rule: "single-line", where: m.where, detail: `${lines} lines: "${m.text}"` } : null;
}

/**
 * A chip, button or cell whose content is wider than its box must be a marked truncation
 * (data-ui-truncate, which shows the full text in a tooltip) or carry a title.
 */
export function checkOverflow(m) {
  const overflow = m.scrollWidth - m.clientWidth > 1;
  if (!overflow || m.truncating || m.hasTitle) return null;
  return { rule: "overflow", where: m.where, detail: `content ${m.scrollWidth}px in ${m.clientWidth}px: "${m.text}"` };
}

/** A card's child (not inside a scroll or clip container) must stay inside the card's box. */
export function checkContainment(m) {
  const { box, child } = m;
  const out = child.left < box.left - 1 || child.right > box.right + 1 || child.bottom > box.bottom + 1;
  return out ? { rule: "containment", where: m.where, detail: `child ${Math.round(child.left)}–${Math.round(child.right)} outside card ${Math.round(box.left)}–${Math.round(box.right)}` } : null;
}

/** A frame (one width of the lab) must not scroll sideways. */
export function checkFrame(m) {
  return m.scrollWidth - m.clientWidth > 1 ? { rule: "frame-overflow", where: m.where, detail: `${m.scrollWidth}px content in a ${m.clientWidth}px frame` } : null;
}

const CHECKS = { "single-line": checkSingleLine, overflow: checkOverflow, containment: checkContainment, frame: checkFrame };

/** Every issue of a list of measurements ({ kind, ... }). */
export function findIssues(measurements) {
  return measurements.map((m) => CHECKS[m.kind]?.(m) ?? null).filter(Boolean);
}
