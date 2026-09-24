import { permanentRedirect } from "next/navigation";

/** The flat audit form was replaced by document-based counts. */
export default function InventoryAuditPage() {
  permanentRedirect("/inventory/counts");
}
