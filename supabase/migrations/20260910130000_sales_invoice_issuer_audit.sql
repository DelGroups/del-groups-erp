-- Invoice issuer delegation with immutable created_by audit trail.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_sales_created_by ON sales (created_by);
CREATE INDEX IF NOT EXISTS idx_sales_issued_by ON sales (issued_by);

CREATE OR REPLACE FUNCTION public.can_delegate_invoice_issuer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_active, true)
      AND r.name IN ('Admin', 'Manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_sale_invoice_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_delegate BOOLEAN;
  v_profile_id UUID;
  v_employee_id UUID;
  v_display_name TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.created_by := v_actor;
  v_delegate := public.can_delegate_invoice_issuer();

  IF v_delegate AND NEW.issued_by IS NOT NULL AND NEW.issued_by <> v_actor THEN
    SELECT p.id, p.employee_id, COALESCE(NULLIF(trim(e.full_name), ''), NULLIF(trim(p.full_name), ''), '')
    INTO v_profile_id, v_employee_id, v_display_name
    FROM profiles p
    LEFT JOIN employees e ON e.id = p.employee_id
    WHERE p.id = NEW.issued_by
      AND COALESCE(p.is_active, true);

    IF NOT FOUND THEN
      NEW.issued_by := v_actor;
    ELSE
      IF NEW.seller_id IS NULL AND v_employee_id IS NOT NULL THEN
        NEW.seller_id := v_employee_id;
      END IF;
      IF COALESCE(NULLIF(trim(NEW.seller_name), ''), '') = '' AND v_display_name <> '' THEN
        NEW.seller_name := v_display_name;
      END IF;
    END IF;
  ELSIF v_delegate AND NEW.seller_id IS NOT NULL THEN
    SELECT p.id, COALESCE(NULLIF(trim(e.full_name), ''), NULLIF(trim(p.full_name), ''), '')
    INTO v_profile_id, v_display_name
    FROM profiles p
    LEFT JOIN employees e ON e.id = p.employee_id
    WHERE p.employee_id = NEW.seller_id
      AND COALESCE(p.is_active, true)
    ORDER BY p.created_at
    LIMIT 1;

    NEW.issued_by := COALESCE(v_profile_id, v_actor);
    IF COALESCE(NULLIF(trim(NEW.seller_name), ''), '') = '' AND v_display_name <> '' THEN
      NEW.seller_name := v_display_name;
    END IF;
  ELSE
    NEW.issued_by := v_actor;

    SELECT p.employee_id, COALESCE(NULLIF(trim(e.full_name), ''), NULLIF(trim(p.full_name), ''), '')
    INTO v_employee_id, v_display_name
    FROM profiles p
    LEFT JOIN employees e ON e.id = p.employee_id
    WHERE p.id = v_actor;

    IF NOT v_delegate THEN
      IF v_employee_id IS NOT NULL THEN
        NEW.seller_id := v_employee_id;
      END IF;
      IF COALESCE(NULLIF(trim(NEW.seller_name), ''), '') = '' AND v_display_name <> '' THEN
        NEW.seller_name := v_display_name;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_invoice_audit_fields ON public.sales;
CREATE TRIGGER trg_sale_invoice_audit_fields
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sale_invoice_audit_fields();
