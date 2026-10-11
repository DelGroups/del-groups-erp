import { InventoryTurnoverPage } from "@/modules/inventory/pages";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { productId } = await searchParams;
  return <InventoryTurnoverPage productId={typeof productId === "string" && productId ? productId : null} />;
}
