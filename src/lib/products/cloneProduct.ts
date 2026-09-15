import type { Product } from "@/types/database.types";

export type ProductClonePrefill = Omit<Product, "id" | "created_at" | "image_url">;

export function buildProductClonePrefill(source: Product): ProductClonePrefill {
  const { id: _id, created_at: _createdAt, image_url: _imageUrl, ...rest } = source;
  const baseCode = (rest.code || "").trim();
  return {
    ...rest,
    code: baseCode ? `${baseCode}-COPY` : "COPY",
    image_url: null,
    barcode: null,
    qr_code: null,
    stock: 0,
  };
}
