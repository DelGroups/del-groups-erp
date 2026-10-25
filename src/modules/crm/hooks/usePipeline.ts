"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchCrmCustomers } from "../lib/api";
import { fetchPipelineDeal, fetchPipelineDeals, fetchPipelineSettings, fetchSalespeople, PIPELINE_SETTINGS_KEY, type PipelineSettings } from "../lib/pipelineData";
import { leadsDefinition, opportunitiesDefinition, type PipelineContext } from "../views/pipeline";

const EMPTY: PipelineSettings = { teams: [], stages: [], lostReasons: [], targets: [] };

/** The new CRM's settings and view definitions (prompt 21). */
export function usePipeline() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: PIPELINE_SETTINGS_KEY, queryFn: fetchPipelineSettings, staleTime: 60_000 });
  const customers = useQuery({ queryKey: ["crm", "customers"], queryFn: fetchCrmCustomers, staleTime: 60_000 });
  const people = useQuery({ queryKey: ["crm", "salespeople"], queryFn: fetchSalespeople, staleTime: 5 * 60_000 });
  const data = settings.data ?? EMPTY;

  const ctx = useMemo<PipelineContext>(
    () => ({
      teams: data.teams,
      stages: data.stages,
      lostReasons: data.lostReasons,
      customers: customers.data ?? [],
      salespeople: people.data ?? [],
      t,
      fetchAll: fetchPipelineDeals,
      fetchOne: fetchPipelineDeal,
    }),
    [data, customers.data, people.data, t]
  );
  const opportunities = useMemo(() => opportunitiesDefinition(ctx), [ctx]);
  const leads = useMemo(() => leadsDefinition(ctx), [ctx]);

  return {
    settings: data,
    ready: settings.isSuccess,
    error: settings.error ? settings.error.message : null,
    refetchSettings: () => void settings.refetch(),
    salespeople: people.data ?? [],
    customers: customers.data ?? [],
    opportunities,
    leads,
  };
}
