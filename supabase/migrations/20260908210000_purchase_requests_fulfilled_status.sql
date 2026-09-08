-- Allow fulfilled status on production purchase requests.

ALTER TABLE purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('pending', 'ordered', 'received', 'fulfilled', 'cancelled'));
