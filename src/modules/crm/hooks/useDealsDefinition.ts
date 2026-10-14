"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCrmConfig } from "./useCrmConfig";
import { fetchCrmCustomers } from "../lib/api";
import { dealsDefinition } from "../views/deals";

/** The deals view definition with this tenant's stages and customers. */
export function useDealsDefinition() {
  const { config } = useCrmConfig();
  const customers = useQuery({ queryKey: ["crm", "customers"], queryFn: fetchCrmCustomers });
  const list = customers.data;
  return useMemo(() => dealsDefinition(config, list ?? []), [config, list]);
}
