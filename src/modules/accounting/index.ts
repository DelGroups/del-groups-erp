/**
 * Public API of the accounting module. Other code imports accounting only from
 * here (`@/modules/accounting`), never from its components/, lib/ or actions/.
 *
 * No other module uses accounting's screens. The ledger engine that sales, purchases,
 * payroll, expenses and production post to (journal, chart of accounts, accounts and
 * transactions, GL posting, partner balances; src/lib/finance and src/lib/accounting)
 * stays in core. This module owns the cash & bank, payments, finance, opening balances
 * and financial report screens.
 */
export {};
