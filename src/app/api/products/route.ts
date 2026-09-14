import { type NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/apiSecurity";
import { requirePermissionApi } from "@/lib/auth/apiAuth";
import type { ProductBomInput } from "@/lib/products/bom";
import {
  createProductWithRelations,
  type CreateProductWithRelationsInput,
} from "@/lib/products/createProductService";
import { PRODUCT_CREATE_REQUEST_TIMEOUT_MS } from "@/lib/products/productCreateConstants";
import type { ProductInsert } from "@/types/database.types";

export const maxDuration = 30;
export const runtime = "nodejs";

interface CreateProductBody {
  product?: Partial<ProductInsert> & Pick<ProductInsert, "name">;
  bomRows?: ProductBomInput[];
  isComposite?: boolean;
}

export function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const auth = await requirePermissionApi("can_manage_products");
  if (auth.error) return auth.error;

  let body: CreateProductBody;
  try {
    body = (await request.json()) as CreateProductBody;
  } catch {
    return NextResponse.json({ success: false, error: "Sorğu formatı yanlışdır" }, { status: 400 });
  }

  const product = body.product;
  if (!product?.name?.trim()) {
    return NextResponse.json(
      { success: false, error: "Məhsul adı tələb olunur" },
      { status: 400 }
    );
  }

  const input: CreateProductWithRelationsInput = {
    product,
    bomRows: body.bomRows ?? [],
    isComposite: Boolean(body.isComposite),
  };

  const result = await createProductWithRelations(input);

  if (!result.ok) {
    const status = result.errorCode === "duplicate" ? 409 : 400;
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        errorCode: result.errorCode,
      },
      { status }
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: result.product,
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Timeout-Ms": String(PRODUCT_CREATE_REQUEST_TIMEOUT_MS),
      },
    }
  );
}
