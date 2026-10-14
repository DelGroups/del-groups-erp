"use client";

/**
 * The view engine's one data layer (prompt 17), on TanStack Query. Reads go through the
 * browser Supabase client with the user's own session, so row level security applies to every
 * row; nothing is read while the model's module is off or the user lacks its read permission.
 * Writes go through the module's server actions (which keep their business rules) and then
 * refresh the cached rows.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { parseStudioField, type StudioField } from "@/lib/studio/fields";
import type { PermissionKey } from "@/types/database.types";
import type { ModuleId } from "@/modules/types";
import { accessFor, customValues, DEFAULT_LIMIT, sanitizeSearchState, validFavoriteName, withStudioFields, type Favorite } from "./logic";
import type { SearchState, ViewDefinition, ViewRecord } from "./types";

// The engine reads tables by name from view definitions (and view_favorites, which the
// generated database types do not know yet), so it uses the client without table typing.
const supabase = typedClient as unknown as SupabaseClient;

export type ViewStatus = "forbidden" | "loading" | "error" | "ready";

const keys = {
  rows: (model: string) => ["views", model, "rows"] as const,
  row: (model: string, id: string) => ["views", model, "row", id] as const,
  studio: (studioModel: string) => ["views", "studio", studioModel] as const,
  favorites: (viewKey: string) => ["views", "favorites", viewKey] as const,
};

/** Read and write access of the current user to a model. */
export function useViewAccess(def: Pick<ViewDefinition, "model">): { read: boolean; write: boolean; ready: boolean } {
  const { can, isAdmin, ready, loading } = useAuth();
  const { isEnabled } = useEnabledModules();
  const { module, readPermission, writePermission } = def.model;
  return useMemo(
    () => ({
      ...accessFor(
        { module, readPermission, writePermission },
        { isEnabled: (m) => isEnabled(m as ModuleId), isAdmin, can: (p) => can(p as PermissionKey) }
      ),
      ready: ready && !loading,
    }),
    [module, readPermission, writePermission, isEnabled, isAdmin, can, ready, loading]
  );
}

/** Active Studio fields of a model (empty when the model has none). */
export function useStudioFields(studioModel: string | undefined, enabled: boolean): StudioField[] {
  const query = useQuery({
    queryKey: keys.studio(studioModel ?? ""),
    enabled: enabled && !!studioModel,
    queryFn: async () => {
      const { data, error } = await supabase.from("studio_fields").select("*").eq("model_key", studioModel!).eq("active", true).order("sequence");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => parseStudioField(row as Record<string, unknown>)).filter((f): f is StudioField => !!f);
    },
  });
  return query.data ?? EMPTY_FIELDS;
}
const EMPTY_FIELDS: StudioField[] = [];

function selectWithCustom(def: ViewDefinition): string {
  return def.model.studioModel ? `${def.model.select}, custom_fields` : def.model.select;
}

function toRecord<R extends ViewRecord>(def: ViewDefinition<R>, row: Record<string, unknown>, studio: readonly StudioField[]): R {
  const record = def.model.toRecord(row);
  return studio.length ? { ...record, ...customValues(row, studio) } : record;
}

export interface ViewData<R extends ViewRecord> {
  status: ViewStatus;
  /** The definition with the model's Studio fields. */
  definition: ViewDefinition<R>;
  records: R[];
  /** More rows exist than were read (the model's limit). */
  capped: boolean;
  canWrite: boolean;
  error: string | null;
  refetch: () => void;
}

/** All rows of a view (up to the model's limit). */
export function useViewData<R extends ViewRecord>(def: ViewDefinition<R>): ViewData<R> {
  const access = useViewAccess(def);
  const allowed = access.ready && access.read;
  const studio = useStudioFields(def.model.studioModel, allowed);
  const limit = def.model.limit ?? DEFAULT_LIMIT;
  const query = useQuery({
    queryKey: keys.rows(def.model.key),
    enabled: allowed,
    queryFn: async () => {
      if (def.model.fetchAll) return def.model.fetchAll();
      const { data, error } = await supabase
        .from(def.model.table)
        .select(selectWithCustom(def))
        .order(def.model.order.field, { ascending: def.model.order.dir === "asc" })
        .limit(limit + 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
  });
  const patches = usePatches(def.model.key);
  const definition = useMemo(() => withStudioFields(def, studio), [def, studio]);
  const records = useMemo(
    () =>
      (def.model.fetchAll ? (query.data ?? []) : (query.data ?? []).slice(0, limit)).map((row) => {
        const record = toRecord(def, row, studio);
        return patches[record.id] ? { ...record, ...patches[record.id] } : record;
      }),
    [query.data, def, studio, limit, patches]
  );
  const status: ViewStatus = !access.ready ? "loading" : !access.read ? "forbidden" : query.isError ? "error" : query.data ? "ready" : "loading";
  return {
    status,
    definition,
    records,
    capped: !def.model.fetchAll && (query.data?.length ?? 0) > limit,
    canWrite: access.write,
    error: query.error ? query.error.message : null,
    refetch: () => void query.refetch(),
  };
}

export interface RecordData<R extends ViewRecord> {
  status: ViewStatus | "missing";
  definition: ViewDefinition<R>;
  record: R | null;
  /** The raw row, for screen-specific parts (related lists). */
  row: Record<string, unknown> | null;
  canWrite: boolean;
  refetch: () => void;
}

/** One record of a model (the form view). */
export function useViewRecord<R extends ViewRecord>(def: ViewDefinition<R>, id: string): RecordData<R> {
  const access = useViewAccess(def);
  const allowed = access.ready && access.read;
  const studio = useStudioFields(def.model.studioModel, allowed);
  const query = useQuery({
    queryKey: keys.row(def.model.key, id),
    enabled: allowed && !!id,
    queryFn: async () => {
      if (def.model.fetchOne) return def.model.fetchOne(id);
      const { data, error } = await supabase.from(def.model.table).select(selectWithCustom(def)).eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as Record<string, unknown> | null;
    },
  });
  const patches = usePatches(def.model.key);
  const definition = useMemo(() => withStudioFields(def, studio), [def, studio]);
  const record = useMemo(() => {
    if (!query.data) return null;
    const r = toRecord(def, query.data, studio);
    return patches[r.id] ? { ...r, ...patches[r.id] } : r;
  }, [query.data, def, studio, patches]);
  const status = !access.ready ? "loading" : !access.read ? "forbidden" : query.isError ? "error" : query.isPending ? "loading" : query.data ? "ready" : "missing";
  return { status, definition, record, row: query.data ?? null, canWrite: access.write, refetch: () => void query.refetch() };
}

type ActionResult = { success: boolean; error?: string };

/** Cached rows of a model are stale: list, kanban and every open form refetch. */
export function invalidateModel(client: QueryClient, modelKey: string): Promise<void> {
  return client.invalidateQueries({ queryKey: ["views", modelKey] });
}

// Optimistic patches (kanban drag): field values shown at once, per model and record, until
// the server answered and the rows were read again.
type Patches = Record<string, Record<string, unknown>>;
const patchStore = new Map<string, Patches>();
const patchListeners = new Set<() => void>();
const NO_PATCHES: Patches = {};
function setPatch(model: string, id: string, patch: Record<string, unknown> | null) {
  const current = { ...(patchStore.get(model) ?? {}) };
  if (patch) current[id] = { ...(current[id] ?? {}), ...patch };
  else delete current[id];
  patchStore.set(model, current);
  for (const fn of patchListeners) fn();
}
function usePatches(model: string): Patches {
  return useSyncExternalStore(
    (fn) => {
      patchListeners.add(fn);
      return () => patchListeners.delete(fn);
    },
    () => patchStore.get(model) ?? NO_PATCHES,
    () => NO_PATCHES
  );
}

/**
 * A write through a server action. `optimistic` gives field values to show at once (kanban
 * drag); they are dropped when the action fails. Either way the rows are read again.
 */
export function useRecordMutation<V>(
  def: Pick<ViewDefinition, "model">,
  action: (vars: V) => Promise<ActionResult>,
  optimistic?: (vars: V) => { id: string; patch: Record<string, unknown> }
) {
  const client = useQueryClient();
  const model = def.model.key;
  return useMutation({
    mutationFn: async (vars: V) => {
      const result = await action(vars);
      if (!result.success) throw new Error(result.error || "error");
      return result;
    },
    onMutate: (vars: V) => {
      const o = optimistic?.(vars);
      if (o) setPatch(model, o.id, o.patch);
      return { id: o?.id };
    },
    onError: (_error, _vars, context) => {
      if (context?.id) setPatch(model, context.id, null);
    },
    onSettled: async (_data, _error, _vars, context) => {
      await invalidateModel(client, model);
      if (context?.id) setPatch(model, context.id, null);
    },
  });
}

// ── Favourites (public.view_favorites, private per user) ─────────────────────

export interface FavoritesApi {
  favorites: Favorite[];
  loading: boolean;
  save: (name: string, state: SearchState, isDefault: boolean) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string | null) => Promise<void>;
}

export function useFavorites(def: ViewDefinition, enabled: boolean): FavoritesApi {
  const client = useQueryClient();
  const { user } = useAuth();
  const viewKey = def.model.key;
  const key = keys.favorites(viewKey);
  const query = useQuery({
    queryKey: key,
    enabled: enabled && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("view_favorites").select("id, name, state, is_default").eq("view_key", viewKey).order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; state: unknown; is_default: boolean }[];
    },
  });
  const favorites = useMemo(
    () => (query.data ?? []).map((row) => ({ id: row.id, name: row.name, isDefault: row.is_default, state: sanitizeSearchState(row.state, def) })),
    [query.data, def]
  );
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: key }), [client, key]);

  const clearDefault = useCallback(async () => {
    await supabase.from("view_favorites").update({ is_default: false, updated_at: new Date().toISOString() }).eq("view_key", viewKey).eq("is_default", true);
  }, [viewKey]);

  const save = useCallback<FavoritesApi["save"]>(
    async (rawName, state, isDefault) => {
      const name = validFavoriteName(rawName);
      if (!name) return { ok: false, error: "views.favorites.badName" };
      if (isDefault) await clearDefault();
      const { error } = await supabase.from("view_favorites").insert({ view_key: viewKey, name, state, is_default: isDefault });
      await refresh();
      if (error) return { ok: false, error: error.code === "23505" ? "views.favorites.duplicate" : "views.favorites.saveFailed" };
      return { ok: true };
    },
    [clearDefault, refresh, viewKey]
  );
  const remove = useCallback(
    async (id: string) => {
      await supabase.from("view_favorites").delete().eq("id", id);
      await refresh();
    },
    [refresh]
  );
  const setDefault = useCallback(
    async (id: string | null) => {
      await clearDefault();
      if (id) await supabase.from("view_favorites").update({ is_default: true, updated_at: new Date().toISOString() }).eq("id", id);
      await refresh();
    },
    [clearDefault, refresh]
  );
  return { favorites, loading: query.isPending && query.fetchStatus !== "idle", save, remove, setDefault };
}
