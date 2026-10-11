import {
  resolveContractAdvancePayment,
  resolveContractCustomerId,
  resolveContractCustomerName,
  resolveContractDate,
  resolveContractDeliveryDate,
  resolveContractContent,
  resolveContractNumber,
} from "./contractInsert";
import {
  remainingBalanceFromOrder,
  resolveContractTerms,
  resolveProjectScope,
  type ProductionContract,
  type ProductionOrder,
} from "./types";

/** Build printable contract metadata from order fields when DB row/table is unavailable. */
export function buildSyntheticProductionContract(
  order: ProductionOrder,
  overrides?: Partial<Pick<ProductionContract, "contract_no" | "contract_date" | "terms" | "project_scope">>,
  companyName = ""
): ProductionContract {
  const terms =
    overrides?.terms?.trim() ||
    resolveContractTerms(order, companyName) ||
    resolveContractContent(order) ||
    "";

  return {
    id: order.contract?.id || `local-${order.id}`,
    production_order_id: order.id,
    contract_no:
      overrides?.contract_no ||
      resolveContractNumber({ ...order, ...(order.contract ? { contract: order.contract } : {}) }) ||
      order.order_no,
    contract_date: resolveContractDate({
      contract_date: overrides?.contract_date,
      contractDate: overrides?.contract_date,
      signed_date: order.contract?.contract_date,
      created_at: order.created_at,
      expected_delivery_date: order.expected_delivery_date,
      ...(order.contract ? { contract_date: order.contract.contract_date } : {}),
    }),
    customer_id: resolveContractCustomerId(order),
    customer_name: resolveContractCustomerName(order),
    project_name: order.project_name,
    project_scope: overrides?.project_scope ?? (resolveProjectScope(order) || null),
    expected_delivery_date: resolveContractDeliveryDate(order) || order.expected_delivery_date,
    total_project_price: Number(order.total_project_price || 0),
    installation_fee: Number(order.installation_fee || 0),
    advance_payment: resolveContractAdvancePayment({
      ...order,
      ...(order.contract ? { deposit_amount: order.contract.advance_payment } : {}),
    }),
    remaining_balance: remainingBalanceFromOrder(order),
    terms,
    notes: order.notes,
  };
}

/** Ensure order has contract fields populated for print preview. */
export function withPrintableProductionContract(order: ProductionOrder, companyName = ""): ProductionOrder {
  const contract = order.contract ?? buildSyntheticProductionContract(order, undefined, companyName);
  return {
    ...order,
    project_scope: order.project_scope || contract.project_scope,
    terms: order.terms || contract.terms,
    contract,
  };
}
