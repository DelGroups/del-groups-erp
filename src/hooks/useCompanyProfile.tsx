"use client";

import React, { createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_NAME } from "@/lib/brand";
import { supabase } from "@/lib/supabase";
import { loadCompanyProfile, type CompanyProfileSource } from "@/lib/company/loadCompanyProfile";
import {
  companyDisplayName,
  companyInitials,
  companyLegalName,
  EMPTY_COMPANY_PROFILE,
  emailPlaceholder,
  type CompanyProfile,
} from "@/lib/company/profile";
import type { PublicCompanyInfo } from "@/lib/company/server";

export const COMPANY_PROFILE_QUERY_KEY = ["company-profile"] as const;

const PublicCompanyContext = createContext<PublicCompanyInfo>({
  displayName: PRODUCT_NAME,
  emailDomain: "",
});

/** Provides the server-read public company info for the first paint and the login page. */
export function CompanyInfoProvider({
  value,
  children,
}: {
  value: PublicCompanyInfo;
  children: React.ReactNode;
}) {
  return <PublicCompanyContext.Provider value={value}>{children}</PublicCompanyContext.Provider>;
}

/** Public company info only; works before sign-in. */
export function usePublicCompanyInfo(): PublicCompanyInfo & { initials: string; emailPlaceholder: string } {
  const info = useContext(PublicCompanyContext);
  return {
    ...info,
    initials: companyInitials(info.displayName),
    emailPlaceholder: emailPlaceholder({ email: info.emailDomain ? `x@${info.emailDomain}` : "" }),
  };
}

export interface CompanyProfileState {
  profile: CompanyProfile;
  /** Header/UI name; the server-provided name until the profile has loaded. */
  displayName: string;
  /** Name for printed documents. */
  legalName: string;
  initials: string;
  emailPlaceholder: string;
  loaded: boolean;
  source: CompanyProfileSource | null;
}

/** The company profile for signed-in screens and prints, shared through React Query. */
export function useCompanyProfile(): CompanyProfileState {
  const publicInfo = useContext(PublicCompanyContext);
  const query = useQuery({
    queryKey: COMPANY_PROFILE_QUERY_KEY,
    queryFn: () => loadCompanyProfile(supabase as unknown as SupabaseClient),
    staleTime: 5 * 60_000,
  });

  const profile = query.data?.profile ?? EMPTY_COMPANY_PROFILE;
  // An empty row (e.g. read before the session was ready) falls back to the
  // server-provided name rather than the product name.
  const displayName = companyDisplayName(profile, publicInfo.displayName);
  const legalName = companyLegalName(profile, publicInfo.displayName);

  return {
    profile,
    displayName,
    legalName,
    initials: companyInitials(displayName),
    emailPlaceholder: query.data
      ? emailPlaceholder(profile)
      : emailPlaceholder({ email: publicInfo.emailDomain ? `x@${publicInfo.emailDomain}` : "" }),
    loaded: Boolean(query.data),
    source: query.data?.source ?? null,
  };
}

/** Call after saving the profile so every screen picks up the change. */
export function useRefreshCompanyProfile(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: COMPANY_PROFILE_QUERY_KEY });
}
