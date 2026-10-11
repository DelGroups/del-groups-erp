import { PRODUCT_NAME } from "@/lib/brand";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { getTenantConfig, type TenantConfigSource } from "@/lib/tenant/config";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import {
  companyDisplayName,
  EMPTY_COMPANY_PROFILE,
  type CompanyProfile,
} from "@/lib/company/profile";

/** What every visitor may see, signed in or not (login page, first paint). */
export interface PublicCompanyInfo {
  displayName: string;
  emailDomain: string;
}

const PUBLIC_TTL_MS = 60_000;
const FAILURE_TTL_MS = 5_000;
/** Every page render waits for this read, so never longer than this. */
const PUBLIC_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
const publicCache = new Map<string, { value: PublicCompanyInfo; expires: number }>();

/**
 * Display name and e-mail domain of the tenant serving this request, read
 * with the service role (anonymous visitors cannot read the profile) and
 * cached in memory per tenant.
 */
export async function getPublicCompanyInfo(source?: TenantConfigSource): Promise<PublicCompanyInfo> {
  const { tenantId } = getTenantConfig(source);
  const cached = publicCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value: PublicCompanyInfo;
  let ttl = PUBLIC_TTL_MS;
  try {
    const { profile } = await withTimeout(
      loadCompanyProfile(createSupabaseAdminClient(source)),
      PUBLIC_TIMEOUT_MS
    );
    value = {
      displayName: companyDisplayName(profile, PRODUCT_NAME),
      emailDomain: profile.email.split("@")[1]?.trim().toLowerCase() ?? "",
    };
  } catch (error) {
    console.warn("[company] public profile unavailable:", error instanceof Error ? error.message : error);
    value = { displayName: PRODUCT_NAME, emailDomain: "" };
    ttl = FAILURE_TTL_MS;
  }
  publicCache.set(tenantId, { value, expires: Date.now() + ttl });
  return value;
}

/** Drops the cached public info, e.g. after the profile was saved. */
export function invalidatePublicCompanyInfo(source?: TenantConfigSource): void {
  publicCache.delete(getTenantConfig(source).tenantId);
}

/** Full profile for server actions and route handlers, read as the current user. */
export async function getServerCompanyProfile(): Promise<CompanyProfile> {
  try {
    const { profile } = await loadCompanyProfile(await createSupabaseServerClient());
    return profile;
  } catch (error) {
    console.warn("[company] profile unavailable:", error instanceof Error ? error.message : error);
    return EMPTY_COMPANY_PROFILE;
  }
}
