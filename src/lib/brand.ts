/**
 * Product identity. This is the only place in src/ that names the product;
 * everything about the company using it (name, VÖEN, logo, seal, bank…) lives
 * in the company_profile table and is edited under Settings → Company.
 *
 * Kept free of imports so `node --test` can load it.
 */

/** Product name shown in the browser title, PWA and AI assistant. */
export const PRODUCT_NAME = "DEL GROUPS ERP";

/**
 * Machine id of the product. Backups are stamped with it and browser storage
 * keys start with it, so changing it makes old backups unrestorable and
 * resets saved column layouts; keep it when the display name is renamed.
 */
export const PRODUCT_SLUG = "del-groups-erp";

/** Short name under the PWA icon. */
export const PRODUCT_SHORT_NAME = "Del ERP";

export const PRODUCT_DESCRIPTION = `${PRODUCT_NAME} — İdarəetmə və biznes prosesləri sistemi`;
