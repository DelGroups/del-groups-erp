/**
 * Del Groups Studio — custom field definitions and value validation.
 *
 * Admins define extra fields per business model in public.studio_fields; the
 * values live in each record's `custom_fields` JSONB column, keyed by the
 * field's technical name (always prefixed `x_`, like Odoo Studio's x_studio_).
 *
 * Pure module (no "@/..." imports) so `npm test` can load it directly.
 */

export const STUDIO_MODELS = [
  "customers",
  "suppliers",
  "products",
  "sales",
  "purchases",
  "production_orders",
] as const;

export type StudioModelKey = (typeof STUDIO_MODELS)[number];

export const STUDIO_FIELD_TYPES = [
  "text",
  "textarea",
  "integer",
  "decimal",
  "money",
  "date",
  "checkbox",
  "selection",
  "url",
] as const;

export type StudioFieldType = (typeof STUDIO_FIELD_TYPES)[number];

export type StudioFieldOption = { value: string; label: string };

export type StudioField = {
  id: string;
  model_key: StudioModelKey;
  name: string;
  label: string;
  field_type: StudioFieldType;
  options: StudioFieldOption[];
  required: boolean;
  show_in_list: boolean;
  help: string | null;
  sequence: number;
  active: boolean;
};

export type CustomFieldValues = Record<string, string | number | boolean | null>;

export const FIELD_NAME_PATTERN = /^x_[a-z0-9_]{1,40}$/;

const TRANSLIT: Record<string, string> = {
  ə: "e", ı: "i", ö: "o", ü: "u", ç: "c", ş: "s", ğ: "g", İ: "i",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya",
};

/** "Çatdırılma prioriteti" → "x_catdirilma_prioriteti". Returns "" when nothing usable is left. */
export function fieldNameFromLabel(label: string): string {
  const ascii = String(label || "")
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return ascii ? `x_${ascii}` : "";
}

export function isStudioModel(value: unknown): value is StudioModelKey {
  return typeof value === "string" && (STUDIO_MODELS as readonly string[]).includes(value);
}

export function isStudioFieldType(value: unknown): value is StudioFieldType {
  return typeof value === "string" && (STUDIO_FIELD_TYPES as readonly string[]).includes(value);
}

export type FieldDefinitionInput = {
  model_key: unknown;
  name?: unknown;
  label: unknown;
  field_type: unknown;
  options?: unknown;
  required?: unknown;
  show_in_list?: unknown;
  help?: unknown;
  sequence?: unknown;
};

export type FieldDefinition = Omit<StudioField, "id" | "active">;

/** Validates an admin's field definition. Errors are message keys the UI translates. */
export function validateFieldDefinition(
  input: FieldDefinitionInput
): { ok: true; value: FieldDefinition } | { ok: false; error: string } {
  if (!isStudioModel(input.model_key)) return { ok: false, error: "studio.errors.model" };
  const label = String(input.label ?? "").trim().slice(0, 80);
  if (!label) return { ok: false, error: "studio.errors.label" };
  if (!isStudioFieldType(input.field_type)) return { ok: false, error: "studio.errors.type" };
  const name = String(input.name ?? "").trim() || fieldNameFromLabel(label);
  if (!FIELD_NAME_PATTERN.test(name)) return { ok: false, error: "studio.errors.name" };

  let options: StudioFieldOption[] = [];
  if (input.field_type === "selection") {
    const raw = Array.isArray(input.options) ? input.options : [];
    const seen = new Set<string>();
    for (const item of raw) {
      const optionLabel = String((item as { label?: unknown })?.label ?? item ?? "").trim().slice(0, 80);
      if (!optionLabel) continue;
      const value =
        String((item as { value?: unknown })?.value ?? "").trim() ||
        fieldNameFromLabel(optionLabel).replace(/^x_/, "") ||
        optionLabel;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value: value.slice(0, 60), label: optionLabel });
    }
    if (options.length === 0) return { ok: false, error: "studio.errors.options" };
    options = options.slice(0, 50);
  }

  const sequence = Math.floor(Number(input.sequence));
  return {
    ok: true,
    value: {
      model_key: input.model_key,
      name,
      label,
      field_type: input.field_type,
      options,
      required: input.required === true,
      show_in_list: input.show_in_list === true,
      help: String(input.help ?? "").trim().slice(0, 300) || null,
      sequence: Number.isFinite(sequence) ? sequence : 100,
    },
  };
}

function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

/** Turns one raw form value into the stored JSON value, or an error key. */
export function coerceFieldValue(
  field: Pick<StudioField, "field_type" | "options">,
  raw: unknown
): { ok: true; value: string | number | boolean | null } | { ok: false; error: string } {
  if (field.field_type === "checkbox") {
    return { ok: true, value: raw === true || raw === "true" || raw === "on" || raw === 1 };
  }
  if (isEmpty(raw)) return { ok: true, value: null };
  const text = String(raw).trim();
  switch (field.field_type) {
    case "text":
      return { ok: true, value: text.slice(0, 255) };
    case "textarea":
      return { ok: true, value: text.slice(0, 5000) };
    case "integer": {
      const n = Number(text.replace(",", "."));
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, error: "studio.errors.integer" };
    }
    case "decimal":
    case "money": {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, error: "studio.errors.number" };
      return { ok: true, value: field.field_type === "money" ? Math.round(n * 100) / 100 : n };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))
        ? { ok: true, value: text }
        : { ok: false, error: "studio.errors.date" };
    case "selection":
      return field.options.some((option) => option.value === text)
        ? { ok: true, value: text }
        : { ok: false, error: "studio.errors.selection" };
    case "url":
      return /^https?:\/\/\S+$/i.test(text) ? { ok: true, value: text.slice(0, 500) } : { ok: false, error: "studio.errors.url" };
    default:
      return { ok: false, error: "studio.errors.type" };
  }
}

/**
 * Validates all active fields of a model against the submitted values and returns
 * the JSON object to store. Keys of archived/unknown fields already on the record
 * are kept as they were, so archiving a field never loses data.
 */
export function buildCustomFieldValues(
  fields: Array<Pick<StudioField, "name" | "label" | "field_type" | "options" | "required" | "active">>,
  submitted: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined = {}
): { ok: true; value: CustomFieldValues } | { ok: false; errors: Array<{ field: string; label: string; error: string }> } {
  const result: CustomFieldValues = {};
  for (const [key, value] of Object.entries(previous || {})) {
    if (FIELD_NAME_PATTERN.test(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))) {
      result[key] = value as string | number | boolean | null;
    }
  }
  const errors: Array<{ field: string; label: string; error: string }> = [];
  for (const field of fields) {
    if (!field.active) continue;
    const coerced = coerceFieldValue(field, submitted[field.name]);
    if (!coerced.ok) {
      errors.push({ field: field.name, label: field.label, error: coerced.error });
      continue;
    }
    if (field.required && field.field_type !== "checkbox" && coerced.value === null) {
      errors.push({ field: field.name, label: field.label, error: "studio.errors.required" });
      continue;
    }
    result[field.name] = coerced.value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: result };
}

/** Display text for a stored value (lists, AI tools). */
export function formatFieldValue(
  field: Pick<StudioField, "field_type" | "options">,
  value: unknown,
  yesNo: { yes: string; no: string } = { yes: "✓", no: "—" }
): string {
  if (field.field_type === "checkbox") return value === true ? yesNo.yes : yesNo.no;
  if (value === null || value === undefined || value === "") return "";
  if (field.field_type === "selection") {
    return field.options.find((option) => option.value === value)?.label ?? String(value);
  }
  if (field.field_type === "money" && typeof value === "number") return `${value.toFixed(2)} AZN`;
  return String(value);
}

/** Normalises a DB row from studio_fields. */
export function parseStudioField(row: Record<string, unknown>): StudioField | null {
  if (!isStudioModel(row.model_key) || !isStudioFieldType(row.field_type)) return null;
  const name = String(row.name ?? "");
  if (!FIELD_NAME_PATTERN.test(name)) return null;
  const options = Array.isArray(row.options)
    ? (row.options as Array<Record<string, unknown>>)
        .map((option) => ({ value: String(option?.value ?? ""), label: String(option?.label ?? option?.value ?? "") }))
        .filter((option) => option.value)
    : [];
  return {
    id: String(row.id ?? ""),
    model_key: row.model_key,
    name,
    label: String(row.label ?? name),
    field_type: row.field_type,
    options,
    required: row.required === true,
    show_in_list: row.show_in_list === true,
    help: row.help ? String(row.help) : null,
    sequence: Number(row.sequence) || 0,
    active: row.active !== false,
  };
}
