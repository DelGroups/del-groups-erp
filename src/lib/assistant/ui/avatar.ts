/**
 * The avatar's state machine (AST-2, plan section 6). Pure, so `npm test` checks it without a browser.
 *
 *   idle       slow breathing, a blink every 4–7 s
 *   listening  the user is typing in the composer
 *   thinking   a reply was asked for, nothing streamed yet
 *   speaking   reply text is streaming
 *   attention  a warning waits (AST-5 raises it), amber
 *   alert      an error: a failed reply, or an error-level issue (AST-5), red, one short shake
 *   success    the reply finished well; settles back after a moment
 *   sleeping   the assistant is off or this month's budget is used up
 *
 * The machine also remembers the open issue (AST-5) so that after a reply it goes back to the
 * issue's colour instead of idle.
 */

export const AVATAR_STATES = ["idle", "listening", "thinking", "speaking", "attention", "alert", "success", "sleeping"] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

/** Header button 28, panel header 40, empty state 56. */
export const AVATAR_SIZES = [28, 40, 56] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type IssueSeverity = "warning" | "error";

export interface AvatarMachine {
  state: AvatarState;
  issue: IssueSeverity | null;
}

export type AvatarEvent =
  | { type: "focus" }
  | { type: "blur" }
  | { type: "send" }
  | { type: "delta" }
  | { type: "done" }
  | { type: "fail"; budget?: boolean }
  | { type: "stop" }
  | { type: "issue"; severity: IssueSeverity }
  | { type: "clear_issue" }
  | { type: "settle" }
  | { type: "sleep" }
  | { type: "wake" };

export const INITIAL_AVATAR: AvatarMachine = { state: "idle", issue: null };

function rest(issue: IssueSeverity | null): AvatarState {
  return issue === "error" ? "alert" : issue === "warning" ? "attention" : "idle";
}

const BUSY: readonly AvatarState[] = ["thinking", "speaking"];

export function avatarReducer(m: AvatarMachine, e: AvatarEvent): AvatarMachine {
  // Asleep: only waking up (the budget is back, the flag on) leaves this state.
  if (m.state === "sleeping") return e.type === "wake" ? { ...m, state: rest(m.issue) } : m;
  switch (e.type) {
    case "sleep":
      return { ...m, state: "sleeping" };
    case "wake":
      return m;
    case "focus":
      return m.state === "idle" ? { ...m, state: "listening" } : m;
    case "blur":
      return m.state === "listening" ? { ...m, state: "idle" } : m;
    case "send":
      return { ...m, state: "thinking" };
    case "delta":
      return BUSY.includes(m.state) ? { ...m, state: "speaking" } : m;
    case "done":
      return BUSY.includes(m.state) ? { ...m, state: "success" } : m;
    case "stop":
      return BUSY.includes(m.state) ? { ...m, state: rest(m.issue) } : m;
    case "fail":
      return e.budget ? { ...m, state: "sleeping" } : { ...m, state: "alert" };
    case "issue": {
      const issue = m.issue === "error" ? "error" : e.severity;
      // A reply in flight keeps its state; the issue shows once the reply ends.
      return BUSY.includes(m.state) ? { ...m, issue } : { state: rest(issue), issue };
    }
    case "clear_issue":
      return BUSY.includes(m.state) ? { ...m, issue: null } : { state: m.state === "attention" || m.state === "alert" ? "idle" : m.state, issue: null };
    case "settle":
      return m.state === "success" || (m.state === "alert" && m.issue !== "error") ? { ...m, state: rest(m.issue) } : m;
    default:
      return m;
  }
}

/** How long a passing state shows before the panel sends `settle` (null: it stays). */
export function settleAfterMs(m: AvatarMachine): number | null {
  if (m.state === "success") return 1600;
  if (m.state === "alert" && m.issue !== "error") return 4000;
  return null;
}

/** Next blink in 4–7 s. `random` is injectable for tests. */
export function nextBlinkDelayMs(random: () => number = Math.random): number {
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(4000 + r * 3000);
}

export type AvatarTone = "brand" | "success" | "warning" | "danger" | "muted";

export function avatarTone(state: AvatarState): AvatarTone {
  if (state === "attention") return "warning";
  if (state === "alert") return "danger";
  if (state === "success") return "success";
  if (state === "sleeping") return "muted";
  return "brand";
}

/** The design token behind each tone: the avatar never uses a raw colour (TOK-1). */
export const TONE_TOKEN: Record<AvatarTone, string> = {
  brand: "var(--ds-brand)",
  success: "var(--ds-success)",
  warning: "var(--ds-warning)",
  danger: "var(--ds-danger-strong, var(--ds-danger))",
  muted: "var(--ds-text-subtle)",
};

export interface AvatarMotionPlan {
  /** Body breathing (scale 1 → 1.03). */
  breathe: boolean;
  /** Random blinks. */
  blink: boolean;
  /** Three dots orbit the body. */
  orbit: boolean;
  /** A gentle bounce while text streams. */
  bounce: boolean;
  /** A glow ring that pulses. */
  pulse: boolean;
  /** One 300 ms shake when entering the state. */
  shake: boolean;
  /** One small hop when entering the state. */
  hop: boolean;
  /** Eyes: open dots, happy arcs, or closed lines. */
  eyes: "open" | "arcs" | "closed";
  /** Eyes look towards the composer (down and to the start side). */
  lookDown: boolean;
}

/**
 * What moves in each state. With "reduce motion" nothing loops or moves: only the colour (tone) and
 * the eye shape change (A11Y-5).
 */
export function avatarMotion(state: AvatarState, reducedMotion: boolean): AvatarMotionPlan {
  const eyes = state === "success" ? "arcs" : state === "sleeping" ? "closed" : "open";
  const plan: AvatarMotionPlan = {
    breathe: state === "idle" || state === "listening" || state === "attention" || state === "sleeping",
    blink: state === "idle" || state === "listening" || state === "thinking",
    orbit: state === "thinking",
    bounce: state === "speaking",
    pulse: state === "attention",
    shake: state === "alert",
    hop: state === "success",
    eyes,
    lookDown: state === "listening",
  };
  if (!reducedMotion) return plan;
  // Reduced motion: thinking still needs a sign, so its dots show standing still (orbit=false here;
  // the component draws them static), and listening keeps its gaze (a position, not a movement).
  return { breathe: false, blink: false, orbit: false, bounce: false, pulse: false, shake: false, hop: false, eyes, lookDown: plan.lookDown };
}

/** i18n key of the accessible label, e.g. "Assistant is thinking". */
export function avatarLabelKey(state: AvatarState): string {
  return `assistant.avatar.${state}`;
}
