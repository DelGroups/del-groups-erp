import type { Customer, Supplier } from "@/types/database.types";

export type EntityType = "physical" | "legal";

export function isLegalEntity(entity: { entity_type?: EntityType | null }): boolean {
  return entity.entity_type === "legal";
}

export function hasValidVoen(entity: { voen?: string | null }): boolean {
  return Boolean(entity.voen?.trim());
}

export function isLegalEntityWithVoen(
  entity: { entity_type?: EntityType | null; voen?: string | null }
): boolean {
  return isLegalEntity(entity) && hasValidVoen(entity);
}

export function filterLegalCustomers<T extends Customer>(customers: T[]): T[] {
  return customers.filter(isLegalEntityWithVoen);
}

export function filterLegalSuppliers<T extends Supplier>(suppliers: T[]): T[] {
  return suppliers.filter(isLegalEntityWithVoen);
}

export function entityTypeLabel(
  entityType: EntityType,
  t: (key: string) => string
): string {
  return entityType === "legal" ? t("customers.entityLegal") : t("customers.entityPhysical");
}
