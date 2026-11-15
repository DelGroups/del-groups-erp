/**
 * Public API of the purchases module. Other code imports purchases only from
 * here (`@/modules/purchases`), never from its components/, lib/ or actions/.
 *
 * No other module uses purchases. Purchase document helpers (src/lib/purchases/helpers),
 * supplier scores and the procurement config stay in core: the suppliers screen, the
 * dashboard, invoice defaults and production use them.
 */
// AST-4: Del Assistant saves a confirmed purchase proposal as a draft with the form's own function.
export { submitPurchase } from "./lib/submitPurchase";
export type { SubmitPurchasePayload, SubmitPurchaseResult } from "./lib/submitPurchase";
