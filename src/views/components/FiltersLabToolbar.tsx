"use client";

import { useMemo, useState } from "react";
import { defaultSearchState, withValueFilters } from "../logic";
import type { FavoritesApi } from "../data";
import type { SearchState, ViewDefinition, ViewRecord } from "../types";
import { SearchPanel } from "./SearchPanel";
import { useFormatter } from "./ViewScope";

const noFavorites: FavoritesApi = {
  favorites: [],
  loading: false,
  save: async () => ({ ok: true }),
  remove: async () => undefined,
  setDefault: async () => undefined,
};

/**
 * UI lab only (FLT-2): a list's search panel with its "Filtrlər" menu on sample records, value
 * filters on, no database and no favourites. Each module passes its own definition and rows.
 */
export function FiltersLabToolbar({ definition, title, records }: { definition: ViewDefinition; title: string; records: ViewRecord[] }) {
  const fmt = useFormatter();
  const def = useMemo(() => withValueFilters(definition, true), [definition]);
  const [state, setState] = useState<SearchState>(() => defaultSearchState(def));
  return (
    <section className="flex flex-col gap-2 rounded-[var(--ds-radius-lg)] border p-3" style={{ borderColor: "var(--ds-border)" }} data-filters-lab={title}>
      <SearchPanel definition={def} title={title} state={state} onChange={setState} fmt={fmt} count={records.length} favorites={noFavorites} onExport={() => undefined} records={records} />
    </section>
  );
}
