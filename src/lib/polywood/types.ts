import type { PolywoodPieceStatus, PolywoodPieceType, PolywoodSaleMode } from "@/lib/polywood/constants";

export interface PolywoodPiece {
  id: string;
  product_id: string;
  warehouse_id: string;
  length_m: number;
  piece_type: PolywoodPieceType;
  status: PolywoodPieceStatus;
  sale_item_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type PolywoodPieceInsert = Omit<PolywoodPiece, "id" | "created_at" | "updated_at"> & {
  id?: string;
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
  /** Remaining length on the same piece after partial use */
  remainingOnPiece?: number;
  /** Scrap length returned to inventory after cutting a full sheet */
  scrapLength?: number;
}

export interface PolywoodCutResult {
  steps: CutPlanStep[];
  totalUsedM: number;
  scrapCreated: { length_m: number }[];
}

export interface PolywoodSaleLineMeta {
  polywood_sale_mode: PolywoodSaleMode;
  polywood_length_m: number;
}
