"use server";

/**
 * System folders of the Documents module (phase 23): existing attachments shown where they
 * already are, nothing is copied or moved. Each folder is checked with its own module's rule,
 * exactly as that module's screens check it:
 *   expenses   receipts (expense_attachments, private bucket)   can_view_expenses or can_manage_expenses
 *   contracts  contract files (contracts.attachment_path)        can_view_sales
 *   products   product images (products.image_url, public)       can_view_products
 * Links are short-lived signed URLs made with the service role after the check.
 */
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { ActionAuthError } from "@/lib/auth/serverActionAuth";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { assertModulesEnabled } from "@/lib/modules/server";
import type { ActionResult } from "@/lib/supabase/actionResult";
import type { PermissionKey } from "@/types/database.types";
import type { SystemFile, SystemFolder } from "../lib/documents";

const RULES: Record<SystemFolder, { module: "expenses" | "contracts" | "core"; permissions: PermissionKey[] }> = {
  expenses: { module: "expenses", permissions: ["can_view_expenses", "can_manage_expenses"] },
  contracts: { module: "contracts", permissions: ["can_view_sales"] },
  products: { module: "core", permissions: ["can_view_products"] },
};

const LIMIT = 500;
const LINK_SECONDS = 600;

async function requireFolder(folder: SystemFolder): Promise<void> {
  const { user, profile } = await getServerAuthContext();
  if (!user) throw new ActionAuthError("Giriş tələb olunur");
  if (profile?.is_active === false) throw new ActionAuthError("Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.");
  const rule = RULES[folder];
  if (!rule.permissions.some((p) => userHasPermission(profile, p))) throw new ActionAuthError("İcazəniz yoxdur");
  if (rule.module !== "core") await assertModulesEnabled(rule.module);
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

export async function listSystemFolderAction(folder: SystemFolder): Promise<ActionResult<SystemFile[]>> {
  try {
    if (!(folder in RULES)) return { success: false, error: "Qovluq tapılmadı" };
    await requireFolder(folder);
    const admin = await createSupabaseAdminClient();

    if (folder === "expenses") {
      const { data, error } = await admin
        .from("expense_attachments" as never)
        .select("id,expense_id,storage_path,file_name,mime_type,size_bytes,created_at")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) return { success: false, error: error.message };
      const rows = (data ?? []) as Record<string, unknown>[];
      const signed = rows.length ? await admin.storage.from("expense-attachments").createSignedUrls(rows.map((r) => String(r.storage_path)), LINK_SECONDS) : { data: [] };
      const urls = new Map((signed.data ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
      return {
        success: true,
        data: rows.map((r) => ({
          id: String(r.id),
          name: String(r.file_name ?? ""),
          mime_type: str(r.mime_type),
          size_bytes: num(r.size_bytes),
          created_at: str(r.created_at),
          url: urls.get(String(r.storage_path)) ?? null,
          res_model: "expenses",
          res_id: String(r.expense_id),
        })),
      };
    }

    if (folder === "contracts") {
      const { data, error } = await admin
        .from("contracts" as never)
        .select("id,contract_number,title,attachment_path,created_at")
        .not("attachment_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) return { success: false, error: error.message };
      const rows = (data ?? []) as Record<string, unknown>[];
      const signed = rows.length ? await admin.storage.from("contract-attachments").createSignedUrls(rows.map((r) => String(r.attachment_path)), LINK_SECONDS) : { data: [] };
      const urls = new Map((signed.data ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
      return {
        success: true,
        data: rows.map((r) => {
          const path = String(r.attachment_path);
          const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
          return {
            id: String(r.id),
            name: `${String(r.contract_number ?? "")} ${String(r.title ?? "")}`.trim() + ext,
            mime_type: ext.toLowerCase() === ".pdf" ? "application/pdf" : null,
            size_bytes: null,
            created_at: str(r.created_at),
            url: urls.get(path) ?? null,
            res_model: "contracts",
            res_id: String(r.id),
          };
        }),
      };
    }

    const { data, error } = await admin
      .from("products")
      .select("id,name,image_url,created_at")
      .not("image_url", "is", null)
      .order("name")
      .limit(LIMIT);
    if (error) return { success: false, error: error.message };
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return {
      success: true,
      data: rows.map((r) => {
        const image = String(r.image_url);
        // image_url holds the public URL (public bucket) or, in older rows, the storage path.
        const url = /^https?:\/\//.test(image) ? image : admin.storage.from("product-images").getPublicUrl(image).data.publicUrl;
        const ext = image.split("?")[0].split(".").pop() ?? "";
        return {
          id: String(r.id),
          name: `${String(r.name ?? "")}${ext && ext.length <= 5 ? `.${ext}` : ""}`,
          mime_type: "image/*",
          size_bytes: null,
          created_at: str(r.created_at),
          url,
          res_model: "products",
          res_id: String(r.id),
        };
      }),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Sənədlər yüklənmədi" };
  }
}
