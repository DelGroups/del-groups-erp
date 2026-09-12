import { DEFAULT_FULL_SHEET_LENGTH_M, LENGTH_EPSILON } from "@/lib/polywood/constants";
import { planLinearMeterCut, sortPiecesForCutting } from "@/lib/polywood/cutting";
import type { PolywoodCutPieceSummary, PolywoodPiece } from "@/lib/polywood/types";

export type SmartCutEvaluation =
  | { kind: "exact" }
  | { kind: "cut"; sourceLengthM: number; requestedM: number; remainderM: number }
  | { kind: "insufficient"; error: string };

function roundLength(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function evaluateSmartCut(
  requestedM: number,
  pieces: PolywoodPiece[],
  fullSheetLengthM = DEFAULT_FULL_SHEET_LENGTH_M
): SmartCutEvaluation {
  if (requestedM <= LENGTH_EPSILON) {
    return { kind: "insufficient", error: "Requested length must be greater than zero" };
  }

  const sorted = sortPiecesForCutting(pieces);
  const exact = sorted.find((piece) => Math.abs(piece.length_m - requestedM) <= LENGTH_EPSILON);
  if (exact) {
    return { kind: "exact" };
  }

  try {
    const plan = planLinearMeterCut(requestedM, pieces, fullSheetLengthM);
    const splitStep = plan.steps.find((step) => step.action === "split_full");
    if (!splitStep) {
      return { kind: "exact" };
    }

    const remainderM = roundLength(splitStep.scrapLength ?? fullSheetLengthM - requestedM);
    return {
      kind: "cut",
      sourceLengthM: fullSheetLengthM,
      requestedM: roundLength(requestedM),
      remainderM,
    };
  } catch (error) {
    return {
      kind: "insufficient",
      error: error instanceof Error ? error.message : "Insufficient Polywood stock",
    };
  }
}

export function formatPieceBreakdown(
  fullSheets: number,
  fullSheetLengthM: number,
  cutPieces: PolywoodCutPieceSummary[]
): string {
  const parts: string[] = [];
  if (fullSheets > 0) {
    parts.push(`${fullSheets}× ${fullSheetLengthM}m`);
  }
  for (const piece of cutPieces) {
    parts.push(`${piece.count}× ${piece.length_m}m`);
  }
  return parts.length > 0 ? parts.join(", ") : "—";
}
