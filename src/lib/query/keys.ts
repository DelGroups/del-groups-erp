export const queryKeys = {
  suppliers: {
    all: ["suppliers"] as const,
  },
  sales: {
    list: ["sales", "list"] as const,
  },
  products: {
    catalog: ["products", "catalog"] as const,
    polywoodSummaries: (warehouseId: string) =>
      ["products", "polywood-summaries", warehouseId] as const,
  },
} as const;
