/**
 * The stages of an import shipment (IMP-5) for the stage bar, the list's stage chip and the board.
 * Pure.
 *
 *   Sifariş (draft) → Yolda (confirmed) → Gömrükdə (arrived at customs) → Gömrükdən buraxıldı
 *   (cleared) → Anbara qəbul (partially_received / received) → Bağlandı (closed)
 * "Gömrükdə" is a milestone, not a status: a confirmed shipment with an arrival date.
 * Cancelled is shown apart.
 */
import type { ShipmentStatus } from "./shipment";

export const STAGES = ["order", "transit", "customs", "cleared", "receipt", "closed"] as const;
export type Stage = (typeof STAGES)[number];

export interface StageFacts {
  status: ShipmentStatus;
  createdAt?: string | null;
  confirmDate?: string | null;
  departedOn?: string | null;
  arrivedOn?: string | null;
  clearedOn?: string | null;
  /** Date of the first receipt. */
  firstReceiptDate?: string | null;
  closedAt?: string | null;
  eta?: string | null;
}

/** The current stage; null for a cancelled shipment. */
export function stageOf(f: Pick<StageFacts, "status" | "arrivedOn">): Stage | null {
  switch (f.status) {
    case "draft":
      return "order";
    case "confirmed":
      return f.arrivedOn ? "customs" : "transit";
    case "cleared":
      return "cleared";
    case "partially_received":
    case "received":
      return "receipt";
    case "closed":
      return "closed";
    default:
      return null;
  }
}

export const stageIndex = (s: Stage | null) => (s ? STAGES.indexOf(s) : -1);

export type StageState = "done" | "current" | "next";

export interface StageView {
  stage: Stage;
  state: StageState;
  /** The day the stage was reached (done or current), yyyy-mm-dd. */
  date: string | null;
}

const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

/** Each stage with its state and the date it was reached. */
export function stageViews(f: StageFacts): StageView[] {
  const current = stageIndex(stageOf(f));
  const dates: Record<Stage, string | null> = {
    order: day(f.createdAt),
    transit: day(f.departedOn) ?? day(f.confirmDate),
    customs: day(f.arrivedOn),
    cleared: day(f.clearedOn),
    receipt: day(f.firstReceiptDate),
    closed: day(f.closedAt),
  };
  return STAGES.map((stage, i) => ({
    stage,
    state: current < 0 ? "next" : i < current || (stage === "closed" && i === current) ? "done" : i === current ? "current" : "next",
    date: current >= 0 && i <= current ? dates[stage] : null,
  }));
}

export type NextAction = "confirm" | "arrived" | "clear" | "receive" | "close";

/** The primary button of the stage bar for the current stage (the caller checks permissions). */
export function nextAction(f: Pick<StageFacts, "status" | "arrivedOn">): NextAction | null {
  switch (stageOf(f)) {
    case "order":
      return "confirm";
    case "transit":
      return "arrived";
    case "customs":
      return "clear";
    case "cleared":
      return "receive";
    case "receipt":
      return f.status === "received" ? "close" : "receive";
    default:
      return null;
  }
}

const toTime = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Whole days from departure (or confirmation) to arrival (or today); null before departure. */
export function daysInTransit(f: Pick<StageFacts, "departedOn" | "confirmDate" | "arrivedOn" | "status">, today: string): number | null {
  const from = day(f.departedOn) ?? (f.status !== "draft" ? day(f.confirmDate) : null);
  if (!from) return null;
  const to = day(f.arrivedOn) ?? today;
  return Math.max(0, Math.round((toTime(to) - toTime(from)) / 86_400_000));
}

/** The ETA has passed and the goods have not reached the warehouse yet. */
export function etaOverdue(f: Pick<StageFacts, "eta" | "status" | "arrivedOn">, today: string): boolean {
  const eta = day(f.eta);
  if (!eta) return false;
  const s = stageOf(f);
  return eta < today && (s === "transit" || s === "customs" || s === "cleared");
}

/** Receiving before customs clearance is allowed, with a warning. */
export function receiveWarning(status: ShipmentStatus): "not_cleared" | null {
  return status === "confirmed" ? "not_cleared" : null;
}

/** How the goods travel (import_shipments.transport_mode). */
export const TRANSPORT_MODES = ["road", "sea", "rail", "air", "multimodal"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];
