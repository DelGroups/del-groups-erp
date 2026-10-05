// Upgrade phase 2: Studio custom fields — definition and value validation.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomFieldValues,
  coerceFieldValue,
  fieldNameFromLabel,
  formatFieldValue,
  parseStudioField,
  validateFieldDefinition,
} from "../src/lib/studio/fields.ts";

test("technical names are x_ slugs from AZ/RU/EN labels", () => {
  assert.equal(fieldNameFromLabel("Çatdırılma prioriteti"), "x_catdirilma_prioriteti");
  assert.equal(fieldNameFromLabel("Срок доставки"), "x_srok_dostavki");
  assert.equal(fieldNameFromLabel("  Delivery Priority! "), "x_delivery_priority");
  assert.equal(fieldNameFromLabel("!!!"), "");
});

test("field definition: selection needs options, name is derived and validated", () => {
  const ok = validateFieldDefinition({
    model_key: "sales",
    label: "Delivery priority",
    field_type: "selection",
    options: [{ label: "Normal" }, { label: "Urgent" }, { label: "Urgent" }, ""],
    required: true,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, "x_delivery_priority");
  assert.deepEqual(ok.value.options, [
    { value: "normal", label: "Normal" },
    { value: "urgent", label: "Urgent" },
  ]);
  assert.equal(validateFieldDefinition({ model_key: "sales", label: "X", field_type: "selection", options: [] }).error, "studio.errors.options");
  assert.equal(validateFieldDefinition({ model_key: "users", label: "X", field_type: "text" }).error, "studio.errors.model");
  assert.equal(validateFieldDefinition({ model_key: "sales", label: "X", field_type: "blob" }).error, "studio.errors.type");
  assert.equal(validateFieldDefinition({ model_key: "sales", name: "bad name", label: "X", field_type: "text" }).error, "studio.errors.name");
});

test("values are coerced per type", () => {
  assert.deepEqual(coerceFieldValue({ field_type: "integer", options: [] }, "12"), { ok: true, value: 12 });
  assert.equal(coerceFieldValue({ field_type: "integer", options: [] }, "1.5").ok, false);
  assert.deepEqual(coerceFieldValue({ field_type: "money", options: [] }, "10,456"), { ok: true, value: 10.46 });
  assert.deepEqual(coerceFieldValue({ field_type: "date", options: [] }, "2026-10-05"), { ok: true, value: "2026-10-05" });
  assert.equal(coerceFieldValue({ field_type: "date", options: [] }, "05.10.2026").ok, false);
  assert.deepEqual(coerceFieldValue({ field_type: "checkbox", options: [] }, undefined), { ok: true, value: false });
  assert.equal(coerceFieldValue({ field_type: "url", options: [] }, "javascript:alert(1)").ok, false);
  assert.deepEqual(coerceFieldValue({ field_type: "text", options: [] }, "  "), { ok: true, value: null });
});

test("required fields block save; archived fields keep their stored value", () => {
  const fields = [
    { name: "x_priority", label: "Priority", field_type: "selection", options: [{ value: "urgent", label: "Urgent" }], required: true, active: true },
    { name: "x_old", label: "Old", field_type: "text", options: [], required: true, active: false },
  ];
  const missing = buildCustomFieldValues(fields, {}, {});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors.map((e) => e.error), ["studio.errors.required"]);

  const saved = buildCustomFieldValues(fields, { x_priority: "urgent" }, { x_old: "kept", not_custom: "dropped" });
  assert.deepEqual(saved, { ok: true, value: { x_old: "kept", x_priority: "urgent" } });
});

test("display text and row parsing", () => {
  const field = parseStudioField({
    id: "1", model_key: "sales", name: "x_priority", label: "Priority", field_type: "selection",
    options: [{ value: "urgent", label: "Urgent" }], required: false, show_in_list: true, active: true, sequence: 5,
  });
  assert.equal(formatFieldValue(field, "urgent"), "Urgent");
  assert.equal(formatFieldValue({ field_type: "money", options: [] }, 5), "5.00 AZN");
  assert.equal(parseStudioField({ model_key: "sales", name: "priority", field_type: "text" }), null);
});
