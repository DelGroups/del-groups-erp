import { supabase } from "@/lib/supabase";

export const PRODUCT_IMAGE_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

function extensionForMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

export async function uploadProductImage(
  file: File
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (file.size <= 0) {
    return { ok: false, error: "Şəkil seçin" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Şəkil 5 MB-dan kiçik olmalıdır" };
  }

  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mime)) {
    return { ok: false, error: "Yalnız PNG, JPG və ya WEBP qəbul olunur" };
  }

  const ext = extensionForMime(mime);
  const path = `catalog/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: mime,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
