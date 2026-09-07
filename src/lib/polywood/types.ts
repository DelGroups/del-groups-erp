import type { PolywoodPieceStatus, PolywoodPieceType } from "@/lib/polywood/constants";
import type { PolywoodPieceInsert, PolywoodPieceRow } from "@/types/database.types";

export type { PolywoodPieceInsert } from "@/types/database.types";

export type PolywoodPiece = PolywoodPieceRow & {
  piece_type: PolywoodPieceType;
  status: PolywoodPieceStatus;
};

export interface PolywoodCutPieceSummary {
  length_m: number;
  count: number;
}

export interface PolywoodInventorySummary {
  product_id: string;
  warehouse_id: string;
  total_length_m: number;
  full_sheet_count: number;
  full_sheet_length_m: number;
  cut_pieces: PolywoodCutPieceSummary[];
  available_piece_count: number;
}

export interface CutPlanStep {
  pieceId: string;
  usedLength: number;
  action: "consume" | "partial" | "split_full";
  remainingOnPiece?: number;
  scrapLength?: number;
}

export interface PolywoodCutResult {
  steps: CutPlanStep[];
  totalUsedM: number;
  scrapCreated: { length_m: number }[];
}
