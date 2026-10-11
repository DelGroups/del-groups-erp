/**
 * Public API of the contracts module. Other code imports contracts only from
 * here (`@/modules/contracts`), never from its components/ or lib/.
 *
 * Official sales and purchase invoices are linked to a contract, so the
 * invoice forms use the contract picker pieces below.
 */
export { fetchActiveContractsForParty, formatContractOptionLabel } from "./lib/api";
export type { Contract } from "./lib/api";
export { default as ContractQuickCreateModal } from "./components/ContractQuickCreateModal";
