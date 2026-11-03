/** The standard lookup field with inline quick-create (UI-2 lookups, docs/ui-standard.md "Lookups"). */
export { EntityLookup, LookupFieldView, type EntityLookupProps, type LookupFieldViewProps } from "./EntityLookup";
export { QuickCreateDialog, type QuickCreateDefaults } from "./QuickCreateDialog";
export { LookupScope } from "./LookupScope";
export { mergeRecord } from "./logic";
export { LOOKUP_ENTITIES, canQuickCreate, lookupDef, lookupQueryKey, type LookupEntity, type LookupRecord, type LookupWhere } from "./registry";
