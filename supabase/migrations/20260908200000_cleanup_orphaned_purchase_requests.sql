-- Cancel orphaned production purchase requests when the linked material line no longer exists.

UPDATE purchase_requests pr
SET
  status = 'cancelled',
  updated_at = NOW()
WHERE pr.status IN ('pending', 'ordered')
  AND NOT EXISTS (
    SELECT 1
    FROM production_materials pm
    WHERE pm.production_order_id = pr.production_order_id
      AND pm.product_id IS NOT DISTINCT FROM pr.product_id
  );

-- Explicit cleanup for order PRC-2026-65799.
UPDATE purchase_requests pr
SET
  status = 'cancelled',
  updated_at = NOW()
FROM production_orders po
WHERE pr.production_order_id = po.id
  AND po.order_no = 'PRC-2026-65799'
  AND pr.status IN ('pending', 'ordered');

-- Cancel linked draft purchase invoices for cancelled requests.
UPDATE purchases p
SET status = 'cancelled'
FROM purchase_requests pr
WHERE pr.purchase_id = p.id
  AND pr.status = 'cancelled'
  AND p.status = 'draft';
