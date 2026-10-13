import { NextResponse } from "next/server";
import { requireAuthenticatedApi, type ApiAuthFailure, type ApiAuthSuccess } from "@/lib/auth/apiAuth";
import { isAdminRole } from "@/types/database.types";
import { billingPageEnabled } from "./overview";

/** Billing routes: 404 while the page is off; otherwise only the tenant's administrators. */
export async function requireBillingAdmin(): Promise<ApiAuthSuccess | ApiAuthFailure> {
  if (!billingPageEnabled(process.env)) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  const auth = await requireAuthenticatedApi();
  if (auth.error) return auth;
  if (!isAdminRole(auth.profile?.role)) return { ...auth, error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return auth;
}
