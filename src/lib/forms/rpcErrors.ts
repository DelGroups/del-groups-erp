export type TFunction = (key: string, params?: Record<string, string | number>) => string;

type RpcErrorRule = {
  match: (raw: string) => boolean;
  key: string;
  params?: (raw: string) => Record<string, string | number> | undefined;
};

const RPC_ERROR_RULES: RpcErrorRule[] = [
  {
    match: (raw) =>
      /materials_pending|material sətirləri verilməlidir|Bütün material|Bütün BOM materialları|Bütün xammal/i.test(
        raw
      ),
    key: "rpcErrors.materialsPending",
  },
  {
    match: (raw) =>
      /insufficient_finished_stock|Hazır məhsul stok|finished_goods_not_posted|Hazır məhsul anbara yazılmayıb/i.test(
        raw
      ),
    key: "rpcErrors.insufficientFinishedStock",
  },
  {
    match: (raw) => /insufficient_stock|Stok kifayət etmir|stok kifayət/i.test(raw),
    key: "rpcErrors.insufficientStock",
  },
  {
    match: (raw) => /chk_products_stock_positive|qalığı mənfi|stock_positive/i.test(raw),
    key: "rpcErrors.stockCannotBeNegative",
  },
  {
    match: (raw) => /customer_required|Müştəri seçilməlidir|Təhvil üçün müştəri/i.test(raw),
    key: "rpcErrors.customerRequired",
  },
  {
    match: (raw) => /order_not_ready|yalnız «Hazır» statusundan/i.test(raw),
    key: "rpcErrors.orderNotReady",
  },
  {
    match: (raw) => /advance_account_required|Avans ödənişi üçün kassa/i.test(raw),
    key: "rpcErrors.advanceAccountRequired",
  },
  {
    match: (raw) => /invalid_total_price|Layihə qiyməti|Satış qiyməti sıfırdan/i.test(raw),
    key: "rpcErrors.invalidTotalPrice",
  },
  {
    match: (raw) => /forbidden|İcazəniz yoxdur/i.test(raw),
    key: "rpcErrors.forbidden",
  },
  {
    match: (raw) => /overpayment|Qalan borc/i.test(raw),
    key: "rpcErrors.overpayment",
  },
];

/** Map Postgres / RPC error strings to localized user-facing messages. */
export function formatRpcError(rawError: string | null | undefined, t: TFunction): string {
  const raw = rawError?.trim() || "";
  if (!raw) return t("common.error");

  if (raw.startsWith("Təhvil")) {
    return raw;
  }

  for (const rule of RPC_ERROR_RULES) {
    if (rule.match(raw)) {
      return t(rule.key, rule.params?.(raw));
    }
  }

  if (/^[a-z_]+$/i.test(raw) && raw.includes("_")) {
    const key = `rpcErrors.${raw}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }

  return raw;
}
