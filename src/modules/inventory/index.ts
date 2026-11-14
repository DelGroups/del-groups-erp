/**
 * Public API of the inventory module. Other code imports inventory only from here
 * (`@/modules/inventory`), never from its components/, lib/, actions/ or hooks/.
 *
 * The stock engine that sales, purchases, production and products use (src/lib/inventory:
 * stock movements and adjustments, warehouse stock, polywood stock, safety stock; warehouse
 * slips and "send to warehouse") stays in core. This module owns the inventory screens.
 * The stock transfer API route (src/app/api/inventory/transfers) submits transfers here.
 */
export { submitStockTransfer } from "./lib/stockTransferServer";
export type { SubmitStockTransferPayload } from "./lib/stockTransfer";

// LOT-2: the lot fields of inbound lines (imports, purchases, initial balance) and the lot flag.
export {
  EMPTY_LOT,
  addLot,
  defaultExpiry,
  isEmptyLot,
  lotFromRow,
  lotHref,
  lotIssues,
  lotPayloadKeys,
  lotQuantities,
  lotSplitIssue,
  lotSummary,
  normalizeLot,
  receiptLotsPayload,
  removeLot,
  singleLot,
} from "./lib/lotFields";
export type { LotFieldsValue, LotIssue, LotPolicy, LotSplitIssue, LotSplitRow } from "./lib/lotFields";
export { LotChip, LotDateCell, LotFieldsEditor, LotLabelsSheet, LotSplitEditor, lotLineColumns } from "./components/LotFields";
export type { LotLabelData } from "./components/LotFields";
export { LotTrackingProvider, useLotTracking } from "./components/LotTrackingFlag";

// LOT-3: choosing the lots of outbound lines, the lots a posted document took, the transfer path.
export {
  NEAR_EXPIRY_DAYS,
  addSplitRow,
  chooseSingle,
  choiceFromPayload,
  choiceSummary,
  followQuantity,
  lotChoiceErrorCode,
  lotChoiceIssue,
  lotExpiry,
  lotsOfLine,
  lotsPayload,
  sortLotsFefo,
  suggestFefo,
} from "./lib/lotPicker";
export type { DocumentLotRow, LotChoice, LotChoiceIssue, LotExpiry, LotOption, LotStatus } from "./lib/lotPicker";
export { DocumentLotChips, LotAutoText, LotPicker, LotStatusBadge, useDocumentLots, useProductLots } from "./components/LotPicker";
export type { LotPickerProps } from "./components/LotPicker";
export { getLotPrintOnInvoice, listDocumentLots } from "./actions/lots";
export { transferPath } from "./lib/stockTransferRpc";

// LOT-4: links to the lot screens and the lot search of the barcode lookup and the command palette.
export { exactLotMatch, lotCardHref, lotSearchTerm, lotsOfProductHref } from "./lib/lotScreens";
export { findLotsAction } from "./actions/lotScreens";
export type { FoundLot } from "./actions/lotScreens";
export { useLotPaletteGroup } from "./components/LotPaletteSearch";
