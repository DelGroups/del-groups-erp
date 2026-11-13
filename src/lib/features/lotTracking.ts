/**
 * LOT_TRACKING (LOT-1..5): lot / batch tracking screens and reports. Server-only switch, off unless
 * the env value is "true". LOT_TRACKING_AUDIENCE: "admins" (default) shows them to admins only,
 * "all" to everyone with the lots permissions (lots.view / lots.manage).
 *
 * The database part (20261115100000_lot_core.sql) attributes every stock change to lots whether
 * or not the flag is on; the flag only decides who sees the lot screens.
 */
export type LotTrackingAudience = "admins" | "all";

export function isLotTrackingEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.LOT_TRACKING ?? "").trim().toLowerCase() === "true";
}

export function lotTrackingAudience(env: Readonly<Record<string, string | undefined>> = process.env): LotTrackingAudience {
  return (env.LOT_TRACKING_AUDIENCE ?? "").trim().toLowerCase() === "all" ? "all" : "admins";
}

/** Does this user get the lot screens? */
export function lotTrackingActive(input: { enabled: boolean; audience: LotTrackingAudience; isAdmin: boolean }): boolean {
  return input.enabled && (input.audience === "all" || input.isAdmin);
}
