/**
 * DELIVERY_ACT: the delivery act (Təhvil-təslim aktı) printed from a sales invoice, from the sales list's
 * row menu and inside the invoice. Server-only switch, off unless the env value is "true". The root layout
 * passes it to client screens through DeliveryActProvider; while off, nothing changes on screen.
 */
export function isDeliveryActEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.DELIVERY_ACT ?? "").trim().toLowerCase() === "true";
}
