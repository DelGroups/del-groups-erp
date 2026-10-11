"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { ensurePolywoodWarehouseAdmin } from "@/lib/polywood/warehouse";
import type { Warehouse } from "@/types/database.types";

export type PolywoodActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export async function ensurePolywoodWarehouseAction(): Promise<
  PolywoodActionResult<{ warehouse: Warehouse }>
> {
  try {
    // Not gated by the polywood module: the sales invoice form calls it too.
    await requirePermissionAction("can_view_products");
    const warehouse = await ensurePolywoodWarehouseAdmin();
    return { success: true, data: { warehouse } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
