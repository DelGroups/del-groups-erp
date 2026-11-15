/**
 * Public API of the expenses module. Other code imports expenses only from
 * here (`@/modules/expenses`), never from its components/, lib/ or actions/.
 *
 * Del Assistant (AST-4) saves a confirmed expense proposal as a draft with the form's own action.
 */
export { saveExpenseAction } from "./actions/expenses";
