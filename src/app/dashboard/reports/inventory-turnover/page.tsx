import PageClient from "./page.client";

export const dynamic = "force-dynamic";

export default async function InventoryTurnoverPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { productId } = await searchParams;
  return <PageClient productId={typeof productId === "string" && productId ? productId : null} />;
}
