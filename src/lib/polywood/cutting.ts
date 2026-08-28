import {
  DEFAULT_FULL_SHEET_LENGTH_M,
  LENGTH_EPSILON,
  isFullSheetLength,
  type PolywoodSaleMode,
} from "@/lib/polywood/constants";
import type { CutPlanStep, PolywoodCutResult, PolywoodPiece } from "@/lib/polywood/types";

function roundLength(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Sort cut pieces before full sheets; smallest fitting length first. */
export function sortPiecesForCutting(pieces: PolywoodPiece[]): PolywoodPiece[] {
  return [...pieces].sort((a, b) => {
    if (a.piece_type !== b.piece_type) {
      return a.piece_type === "cut" ? -1 : 1;
    }
    return a.length_m - b.length_m;
  });
}

export function planLinearMeterCut(
  requestedM: number,
  availablePieces: PolywoodPiece[],
  fullSheetLengthM = DEFAULT_FULL_SHEET_LENGTH_M
): PolywoodCutResult {
  if (requestedM <= LENGTH_EPSILON) {
    throw new Error("Requested length must be greater than zero");
  }

  let remaining = roundLength(requestedM);
  const steps: CutPlanStep[] = [];
  const scrapCreated: { length_m: number }[] = [];
  const usedPieceIds = new Set<string>();
  const sorted = sortPiecesForCutting(availablePieces);

  while (remaining > LENGTH_EPSILON) {
    const candidate = sorted.find(
      (piece) => !usedPieceIds.has(piece.id) && piece.length_m + LENGTH_EPSILON >= remaining
    );

    if (candidate) {
      usedPieceIds.add(candidate.id);
      if (Math.abs(candidate.length_m - remaining) <= LENGTH_EPSILON) {
        steps.push({
          pieceId: candidate.id,
          usedLength: remaining,
          action: "consume",
        });
        remaining = 0;
        break;
      }

      const leftover = roundLength(candidate.length_m - remaining);
      steps.push({
        pieceId: candidate.id,
        usedLength: remaining,
        action: "partial",
        remainingOnPiece: leftover,
      });
      remaining = 0;
      break;
    }

    const fullSheet = sorted.find(
      (piece) =>
        !usedPieceIds.has(piece.id) &&
        piece.piece_type === "full" &&
        piece.length_m + LENGTH_EPSILON >= fullSheetLengthM
    );

    if (!fullSheet) {
      throw new Error(`Insufficient Polywood stock (need ${remaining}m more)`);
    }

    usedPieceIds.add(fullSheet.id);
    const useFromSheet = Math.min(remaining, fullSheetLengthM);
    const scrap = roundLength(fullSheetLengthM - useFromSheet);

    if (scrap > LENGTH_EPSILON) {
      steps.push({
        pieceId: fullSheet.id,
        usedLength: useFromSheet,
        action: "split_full",
        scrapLength: scrap,
      });
      scrapCreated.push({ length_m: scrap });
    } else {
      steps.push({
        pieceId: fullSheet.id,
        usedLength: fullSheetLengthM,
        action: "consume",
      });
    }

    remaining = roundLength(remaining - useFromSheet);
  }

  return {
    steps,
    totalUsedM: roundLength(requestedM),
    scrapCreated,
  };
}

export function planFullSheetCut(
  sheetCount: number,
  availablePieces: PolywoodPiece[],
  fullSheetLengthM = DEFAULT_FULL_SHEET_LENGTH_M
): PolywoodCutResult {
  if (sheetCount <= 0 || !Number.isInteger(sheetCount)) {
    throw new Error("Full sheet quantity must be a positive whole number");
  }

  const fullSheets = availablePieces.filter(
    (piece) =>
      piece.piece_type === "full" && isFullSheetLength(piece.length_m, fullSheetLengthM)
  );

  if (fullSheets.length < sheetCount) {
    throw new Error(`Insufficient full sheets (need ${sheetCount}, have ${fullSheets.length})`);
  }

  const steps: CutPlanStep[] = fullSheets.slice(0, sheetCount).map((piece) => ({
    pieceId: piece.id,
    usedLength: fullSheetLengthM,
    action: "consume" as const,
  }));

  return {
    steps,
    totalUsedM: roundLength(sheetCount * fullSheetLengthM),
    scrapCreated: [],
  };
}

export function planPolywoodSaleCut(
  mode: PolywoodSaleMode,
  quantity: number,
  availablePieces: PolywoodPiece[],
  fullSheetLengthM = DEFAULT_FULL_SHEET_LENGTH_M
): PolywoodCutResult {
  if (mode === "full_sheet") {
    return planFullSheetCut(Math.round(quantity), availablePieces, fullSheetLengthM);
  }
  return planLinearMeterCut(quantity, availablePieces, fullSheetLengthM);
}
