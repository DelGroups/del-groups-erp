-- ۱. اضافه کردن ستون آیتم‌ها (اقلام فاکتور) و اطلاعات تکمیلی به جدول sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payments JSONB DEFAULT '[]'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS doc_no TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS doc_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_total NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'free';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_name TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vat_total NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS warehouse_name TEXT;
ALTER TABLE sales ALTER COLUMN invoice_number DROP NOT NULL;


-- ۲. اضافه کردن ستون‌های آدرس و وئن به جدول customers (برای ثبت سریع مشتری)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS voen TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;

-- ۳. Genişləndirilmiş məhsul sahələri (Products & Inventory modulu)
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS extra_info TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_id UUID;

-- ۴. Anbar zədələnməsi / tullantı sənədləri
CREATE TABLE IF NOT EXISTS inventory_writeoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no TEXT NOT NULL,
  doc_date DATE DEFAULT CURRENT_DATE,
  warehouse_id UUID,
  warehouse_name TEXT,
  inspector_name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_writeoffs_doc_no ON inventory_writeoffs (doc_no);

