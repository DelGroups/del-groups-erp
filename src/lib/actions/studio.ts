"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { catchActionError, type ActionResult } from "@/lib/supabase/actionResult";
import {
  isStudioModel,
  parseStudioField,
  validateFieldDefinition,
  type FieldDefinitionInput,
  type StudioField,
  type StudioModelKey,
} from "@/lib/studio/fields";

/** studio_fields is not in the generated DB types yet; use an untyped client for it. */
async function studioClient(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const COLUMNS = "id, model_key, name, label, field_type, options, required, show_in_list, help, sequence, active";

function mapDbError(message: string): string {
  if (message.includes("studio_fields_model_name_key")) return "studio.errors.duplicate";
  if (message.includes("studio_fields") && message.includes("does not exist")) return "studio.errors.notInstalled";
  if (message.includes("schema cache")) return "studio.errors.notInstalled";
  return message;
}

/** All field definitions of a model (archived included), for the Studio settings page. */
export async function listStudioFieldsAction(modelKey: StudioModelKey): Promise<ActionResult<StudioField[]>> {
  try {
    await requirePermissionAction("can_manage_settings");
    if (!isStudioModel(modelKey)) return { success: false, error: "studio.errors.model" };
    const client = await studioClient();
    const { data, error } = await client
      .from("studio_fields")
      .select(COLUMNS)
      .eq("model_key", modelKey)
      .order("sequence")
      .order("created_at");
    if (error) return { success: false, error: mapDbError(error.message) };
    return {
      success: true,
      data: (data || [])
        .map((row) => parseStudioField(row as Record<string, unknown>))
        .filter((field): field is StudioField => Boolean(field)),
    };
  } catch (err) {
    return catchActionError(err, "Studio fields could not be loaded") as ActionResult<StudioField[]>;
  }
}

export async function createStudioFieldAction(input: FieldDefinitionInput): Promise<ActionResult<StudioField>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const checked = validateFieldDefinition(input);
    if (!checked.ok) return { success: false, error: checked.error };
    const client = await studioClient();
    const { data, error } = await client.from("studio_fields").insert(checked.value).select(COLUMNS).single();
    if (error) return { success: false, error: mapDbError(error.message) };
    const field = parseStudioField(data as Record<string, unknown>);
    return field ? { success: true, data: field } : { success: false, error: "studio.errors.type" };
  } catch (err) {
    return catchActionError(err, "Studio field could not be created") as ActionResult<StudioField>;
  }
}

/**
 * Updates label, options, flags and order. Model, technical name and type are
 * fixed after creation so values already stored on records stay valid.
 */
export async function updateStudioFieldAction(
  id: string,
  input: Omit<FieldDefinitionInput, "model_key" | "name" | "field_type"> & { active?: boolean }
): Promise<ActionResult<StudioField>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const client = await studioClient();
    const { data: current, error: loadError } = await client.from("studio_fields").select(COLUMNS).eq("id", id).single();
    if (loadError || !current) return { success: false, error: mapDbError(loadError?.message || "not found") };
    const existing = parseStudioField(current as Record<string, unknown>);
    if (!existing) return { success: false, error: "studio.errors.type" };

    const checked = validateFieldDefinition({
      ...input,
      model_key: existing.model_key,
      name: existing.name,
      field_type: existing.field_type,
    });
    if (!checked.ok) return { success: false, error: checked.error };

    const { data, error } = await client
      .from("studio_fields")
      .update({
        label: checked.value.label,
        options: checked.value.options,
        required: checked.value.required,
        show_in_list: checked.value.show_in_list,
        help: checked.value.help,
        sequence: checked.value.sequence,
        active: input.active === undefined ? existing.active : input.active === true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) return { success: false, error: mapDbError(error.message) };
    const field = parseStudioField(data as Record<string, unknown>);
    return field ? { success: true, data: field } : { success: false, error: "studio.errors.type" };
  } catch (err) {
    return catchActionError(err, "Studio field could not be updated") as ActionResult<StudioField>;
  }
}
