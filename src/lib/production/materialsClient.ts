import { buildStrictMaterialInsertPayload } from "@/app/production/materialInsert";
import type { ProductionMaterialInsertPayload } from "@/lib/production/payloads";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FromClient = { from: (table: string) => any };

/** Hard-coded insert whitelist — never spread raw UI/form objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function insertProductionMaterials(client: FromClient, rows: any | any[]) {
  const list = (Array.isArray(rows) ? rows : [rows]).map((item) =>
    buildStrictMaterialInsertPayload(item)
  );
  return client.from("production_materials").insert(list);
}

/** Hard-coded upsert whitelist — never spread raw UI/form objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function upsertProductionMaterials(
  client: FromClient,
  rows: any | any[],
  options?: { onConflict?: string }
) {
  const list = (Array.isArray(rows) ? rows : [rows]).map((item) =>
    buildStrictMaterialInsertPayload(item)
  );
  let query = client.from("production_materials").upsert(list);
  if (options?.onConflict) query = query.onConflict(options.onConflict);
  return query;
}

export type { ProductionMaterialInsertPayload as ProductionMaterialDbInsert };
