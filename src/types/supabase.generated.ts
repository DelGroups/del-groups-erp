export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          balance: number | null
          coa_id: string | null
          code: string
          created_at: string | null
          id: string
          name: string
          type: string | null
        }
        Insert: {
          balance?: number | null
          coa_id?: string | null
          code: string
          created_at?: string | null
          id?: string
          name: string
          type?: string | null
        }
        Update: {
          balance?: number | null
          coa_id?: string | null
          code?: string
          created_at?: string | null
          id?: string
          name?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          parent_id: string | null
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          parent_id?: string | null
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          category_name: string
          commission_percentage: number | null
          commission_rate: number
          created_at: string | null
          id: string
          max_amount: number | null
          max_sales: number | null
          min_amount: number | null
          min_sales: number | null
        }
        Insert: {
          category_name: string
          commission_percentage?: number | null
          commission_rate: number
          created_at?: string | null
          id?: string
          max_amount?: number | null
          max_sales?: number | null
          min_amount?: number | null
          min_sales?: number | null
        }
        Update: {
          category_name?: string
          commission_percentage?: number | null
          commission_rate?: number
          created_at?: string | null
          id?: string
          max_amount?: number | null
          max_sales?: number | null
          min_amount?: number | null
          min_sales?: number | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          address: string | null
          bank_name: string | null
          company_name: string | null
          created_at: string | null
          currency: string | null
          email: string | null
          iban: string | null
          id: string
          phone: string | null
          vat_rate: number | null
          voen: string | null
        }
        Insert: {
          address?: string | null
          bank_name?: string | null
          company_name?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          phone?: string | null
          vat_rate?: number | null
          voen?: string | null
        }
        Update: {
          address?: string | null
          bank_name?: string | null
          company_name?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          phone?: string | null
          vat_rate?: number | null
          voen?: string | null
        }
        Relationships: []
      }
      consignment_items: {
        Row: {
          consignment_id: string | null
          id: string
          product_id: string | null
          remaining_qty: number | null
          returned_qty: number | null
          sent_qty: number | null
          sold_qty: number | null
          unit_price: number
        }
        Insert: {
          consignment_id?: string | null
          id?: string
          product_id?: string | null
          remaining_qty?: number | null
          returned_qty?: number | null
          sent_qty?: number | null
          sold_qty?: number | null
          unit_price: number
        }
        Update: {
          consignment_id?: string | null
          id?: string
          product_id?: string | null
          remaining_qty?: number | null
          returned_qty?: number | null
          sent_qty?: number | null
          sold_qty?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "consignment_items_consignment_id_fkey"
            columns: ["consignment_id"]
            isOneToOne: false
            referencedRelation: "consignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      consignment_orders: {
        Row: {
          created_at: string | null
          customer_name: string
          id: string
          order_date: string | null
          seller_name: string | null
        }
        Insert: {
          created_at?: string | null
          customer_name: string
          id?: string
          order_date?: string | null
          seller_name?: string | null
        }
        Update: {
          created_at?: string | null
          customer_name?: string
          id?: string
          order_date?: string | null
          seller_name?: string | null
        }
        Relationships: []
      }
      consignments: {
        Row: {
          code: string
          created_at: string | null
          customer_id: string | null
          id: string
          notes: string | null
          status: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          status?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          balance: number | null
          code: string | null
          company_name: string | null
          created_at: string | null
          full_name: string
          id: string
          name: string | null
          phone: string | null
          voen: string | null
        }
        Insert: {
          address?: string | null
          balance?: number | null
          code?: string | null
          company_name?: string | null
          created_at?: string | null
          full_name: string
          id?: string
          name?: string | null
          phone?: string | null
          voen?: string | null
        }
        Update: {
          address?: string | null
          balance?: number | null
          code?: string | null
          company_name?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          name?: string | null
          phone?: string | null
          voen?: string | null
        }
        Relationships: []
      }
      document_expenses: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string | null
          document_id: string
          document_type: string
          id: string
          title: string
          transaction_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          created_at?: string | null
          document_id: string
          document_type: string
          id?: string
          title: string
          transaction_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string | null
          document_id?: string
          document_type?: string
          id?: string
          title?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_expenses_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          base_salary: number | null
          code: string
          created_at: string | null
          default_commission: number | null
          department: string | null
          employee_code: string | null
          full_name: string
          id: string
          phone: string | null
          position: string | null
          role: string | null
          salary: number | null
          status: string | null
        }
        Insert: {
          base_salary?: number | null
          code: string
          created_at?: string | null
          default_commission?: number | null
          department?: string | null
          employee_code?: string | null
          full_name: string
          id?: string
          phone?: string | null
          position?: string | null
          role?: string | null
          salary?: number | null
          status?: string | null
        }
        Update: {
          base_salary?: number | null
          code?: string
          created_at?: string | null
          default_commission?: number | null
          department?: string | null
          employee_code?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          position?: string | null
          role?: string | null
          salary?: number | null
          status?: string | null
        }
        Relationships: []
      }
      erp_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          journal_entry_id: string | null
          payload: Json
          result: Json | null
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          payload?: Json
          result?: Json | null
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          payload?: Json
          result?: Json | null
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_events_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          account_id: string | null
          amount: number
          category: string
          code: string
          created_at: string | null
          id: string
          notes: string | null
          production_order_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          category: string
          code: string
          created_at?: string | null
          id?: string
          notes?: string | null
          production_order_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string
          code?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          production_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustment_vouchers: {
        Row: {
          applied_at: string
          applied_by: string | null
          audit_date: string | null
          audit_id: string
          audit_type: string
          auditor_name: string | null
          created_at: string
          id: string
          items: Json
          notes: string | null
          voucher_number: string
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          audit_date?: string | null
          audit_id: string
          audit_type: string
          auditor_name?: string | null
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          voucher_number: string
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          audit_date?: string | null
          audit_id?: string
          audit_type?: string
          auditor_name?: string | null
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          voucher_number?: string
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustment_vouchers_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "inventory_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_vouchers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_audit_items: {
        Row: {
          actual_cut_pieces: Json | null
          actual_full_sheet_count: number | null
          actual_qty: number
          audit_id: string
          created_at: string
          full_sheet_length_m: number | null
          id: string
          product_code: string | null
          product_id: string
          product_name: string
          system_cut_pieces: Json | null
          system_full_sheet_count: number | null
          system_qty: number
          unit: string | null
          variance_qty: number
        }
        Insert: {
          actual_cut_pieces?: Json | null
          actual_full_sheet_count?: number | null
          actual_qty?: number
          audit_id: string
          created_at?: string
          full_sheet_length_m?: number | null
          id?: string
          product_code?: string | null
          product_id: string
          product_name: string
          system_cut_pieces?: Json | null
          system_full_sheet_count?: number | null
          system_qty?: number
          unit?: string | null
          variance_qty?: number
        }
        Update: {
          actual_cut_pieces?: Json | null
          actual_full_sheet_count?: number | null
          actual_qty?: number
          audit_id?: string
          created_at?: string
          full_sheet_length_m?: number | null
          id?: string
          product_code?: string | null
          product_id?: string
          product_name?: string
          system_cut_pieces?: Json | null
          system_full_sheet_count?: number | null
          system_qty?: number
          unit?: string | null
          variance_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_audit_items_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "inventory_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_audits: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          audit_date: string
          audit_type: string
          auditor_name: string
          created_at: string
          created_by: string | null
          document_number: string
          id: string
          notes: string | null
          status: string
          voucher_id: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          audit_date?: string
          audit_type: string
          auditor_name: string
          created_at?: string
          created_by?: string | null
          document_number: string
          id?: string
          notes?: string | null
          status?: string
          voucher_id?: string | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          audit_date?: string
          audit_type?: string
          auditor_name?: string
          created_at?: string
          created_by?: string | null
          document_number?: string
          id?: string
          notes?: string | null
          status?: string
          voucher_id?: string | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_audits_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_writeoffs: {
        Row: {
          checker_name: string
          created_at: string | null
          document_number: string
          id: string
          items: Json
          notes: string | null
          warehouse_id: string | null
          writeoff_date: string | null
        }
        Insert: {
          checker_name: string
          created_at?: string | null
          document_number: string
          id?: string
          items?: Json
          notes?: string | null
          warehouse_id?: string | null
          writeoff_date?: string | null
        }
        Update: {
          checker_name?: string
          created_at?: string | null
          document_number?: string
          id?: string
          items?: Json
          notes?: string | null
          warehouse_id?: string | null
          writeoff_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_writeoffs_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_by: string | null
          entry_date: string
          entry_no: string
          id: string
          idempotency_key: string | null
          memo: string | null
          posted_at: string
          source_id: string | null
          source_type: string
        }
        Insert: {
          created_by?: string | null
          entry_date?: string
          entry_no: string
          id?: string
          idempotency_key?: string | null
          memo?: string | null
          posted_at?: string
          source_id?: string | null
          source_type: string
        }
        Update: {
          created_by?: string | null
          entry_date?: string
          entry_no?: string
          id?: string
          idempotency_key?: string | null
          memo?: string | null
          posted_at?: string
          source_id?: string | null
          source_type?: string
        }
        Relationships: []
      }
      journal_entry_lines: {
        Row: {
          account_id: string | null
          coa_id: string
          credit: number
          debit: number
          id: string
          journal_entry_id: string
          line_memo: string | null
          partner_id: string | null
          partner_type: string | null
        }
        Insert: {
          account_id?: string | null
          coa_id: string
          credit?: number
          debit?: number
          id?: string
          journal_entry_id: string
          line_memo?: string | null
          partner_id?: string | null
          partner_type?: string | null
        }
        Update: {
          account_id?: string | null
          coa_id?: string
          credit?: number
          debit?: number
          id?: string
          journal_entry_id?: string
          line_memo?: string | null
          partner_id?: string | null
          partner_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_commission_details: {
        Row: {
          applied_rate: number
          calculated_commission: number
          category_name: string
          category_sales_amount: number
          id: string
          monthly_commission_id: string | null
        }
        Insert: {
          applied_rate: number
          calculated_commission: number
          category_name: string
          category_sales_amount: number
          id?: string
          monthly_commission_id?: string | null
        }
        Update: {
          applied_rate?: number
          calculated_commission?: number
          category_name?: string
          category_sales_amount?: number
          id?: string
          monthly_commission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_commission_details_monthly_commission_id_fkey"
            columns: ["monthly_commission_id"]
            isOneToOne: false
            referencedRelation: "monthly_commissions"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_commissions: {
        Row: {
          approved_at: string | null
          calculated_at: string | null
          id: string
          notes: string | null
          salesperson_id: string | null
          status: string | null
          total_commission_amount: number | null
          total_sales_amount: number | null
          year_month: string
        }
        Insert: {
          approved_at?: string | null
          calculated_at?: string | null
          id?: string
          notes?: string | null
          salesperson_id?: string | null
          status?: string | null
          total_commission_amount?: number | null
          total_sales_amount?: number | null
          year_month: string
        }
        Update: {
          approved_at?: string | null
          calculated_at?: string | null
          id?: string
          notes?: string | null
          salesperson_id?: string | null
          status?: string | null
          total_commission_amount?: number | null
          total_sales_amount?: number | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_commissions_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      polywood_pieces: {
        Row: {
          created_at: string
          id: string
          length_m: number
          notes: string | null
          piece_type: string
          product_id: string
          sale_item_id: string | null
          status: string
          updated_at: string
          warehouse_id: string
          barcode: string | null
          qr_code: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          length_m: number
          notes?: string | null
          piece_type?: string
          product_id: string
          sale_item_id?: string | null
          status?: string
          updated_at?: string
          warehouse_id: string
          barcode?: string | null
          qr_code?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          length_m?: number
          notes?: string | null
          piece_type?: string
          product_id?: string
          sale_item_id?: string | null
          status?: string
          updated_at?: string
          warehouse_id?: string
          barcode?: string | null
          qr_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "polywood_pieces_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polywood_pieces_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      production_contractors: {
        Row: {
          calculated_fee: number | null
          commission_percentage: number | null
          contractor_name: string
          created_at: string | null
          id: string
          production_order_id: string | null
          status: string | null
        }
        Insert: {
          calculated_fee?: number | null
          commission_percentage?: number | null
          contractor_name: string
          created_at?: string | null
          id?: string
          production_order_id?: string | null
          status?: string | null
        }
        Update: {
          calculated_fee?: number | null
          commission_percentage?: number | null
          contractor_name?: string
          created_at?: string | null
          id?: string
          production_order_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_contractors_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      production_contracts: {
        Row: {
          advance_payment: number | null
          content: string | null
          contract_date: string | null
          contract_no: string | null
          contract_number: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          delivery_date: string | null
          delivery_terms: string | null
          deposit_amount: number | null
          discount_amount: number | null
          expected_delivery_date: string | null
          id: string
          installation_fee: number | null
          notes: string | null
          payment_terms: string | null
          production_order_id: string | null
          project_code: string | null
          project_name: string | null
          project_scope: string | null
          remaining_amount: number | null
          remaining_balance: number | null
          status: string | null
          terms: string | null
          title: string | null
          total_amount: number | null
          transport_fee: number | null
          updated_at: string | null
        }
        Insert: {
          advance_payment?: number | null
          content?: string | null
          contract_date?: string | null
          contract_no?: string | null
          contract_number?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_name?: string | null
          delivery_date?: string | null
          delivery_terms?: string | null
          deposit_amount?: number | null
          discount_amount?: number | null
          expected_delivery_date?: string | null
          id?: string
          installation_fee?: number | null
          notes?: string | null
          payment_terms?: string | null
          production_order_id?: string | null
          project_code?: string | null
          project_name?: string | null
          project_scope?: string | null
          remaining_amount?: number | null
          remaining_balance?: number | null
          status?: string | null
          terms?: string | null
          title?: string | null
          total_amount?: number | null
          transport_fee?: number | null
          updated_at?: string | null
        }
        Update: {
          advance_payment?: number | null
          content?: string | null
          contract_date?: string | null
          contract_no?: string | null
          contract_number?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_name?: string | null
          delivery_date?: string | null
          delivery_terms?: string | null
          deposit_amount?: number | null
          discount_amount?: number | null
          expected_delivery_date?: string | null
          id?: string
          installation_fee?: number | null
          notes?: string | null
          payment_terms?: string | null
          production_order_id?: string | null
          project_code?: string | null
          project_name?: string | null
          project_scope?: string | null
          remaining_amount?: number | null
          remaining_balance?: number | null
          status?: string | null
          terms?: string | null
          title?: string | null
          total_amount?: number | null
          transport_fee?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_contracts_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      production_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          finance_transaction_id: string | null
          id: string
          is_posted_to_finance: boolean | null
          notes: string | null
          production_order_id: string | null
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string | null
          finance_transaction_id?: string | null
          id?: string
          is_posted_to_finance?: boolean | null
          notes?: string | null
          production_order_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          finance_transaction_id?: string | null
          id?: string
          is_posted_to_finance?: boolean | null
          notes?: string | null
          production_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_expenses_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      production_materials: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          id: string
          inventory_mode: string | null
          issued: boolean | null
          issued_at: string | null
          issued_qty: number | null
          line_cost: number | null
          notes: string | null
          planned_qty: number | null
          polywood_cut_details: Json | null
          polywood_length_m: number | null
          polywood_sale_mode: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          production_order_id: string | null
          qty: number | null
          quantity: number | null
          stage_label: string | null
          stage_no: number | null
          total_price: number | null
          unit: string | null
          unit_cost: number | null
          unit_price: number | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          inventory_mode?: string | null
          issued?: boolean | null
          issued_at?: string | null
          issued_qty?: number | null
          line_cost?: number | null
          notes?: string | null
          planned_qty?: number | null
          polywood_cut_details?: Json | null
          polywood_length_m?: number | null
          polywood_sale_mode?: string | null
          product_code?: string | null
          product_id?: string | null
          product_name?: string | null
          production_order_id?: string | null
          qty?: number | null
          quantity?: number | null
          stage_label?: string | null
          stage_no?: number | null
          total_price?: number | null
          unit?: string | null
          unit_cost?: number | null
          unit_price?: number | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          inventory_mode?: string | null
          issued?: boolean | null
          issued_at?: string | null
          issued_qty?: number | null
          line_cost?: number | null
          notes?: string | null
          planned_qty?: number | null
          polywood_cut_details?: Json | null
          polywood_length_m?: number | null
          polywood_sale_mode?: string | null
          product_code?: string | null
          product_id?: string | null
          product_name?: string | null
          production_order_id?: string | null
          qty?: number | null
          quantity?: number | null
          stage_label?: string | null
          stage_no?: number | null
          total_price?: number | null
          unit?: string | null
          unit_cost?: number | null
          unit_price?: number | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_materials_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_materials_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          additional_cost: number | null
          additional_expenses: Json
          additional_expenses_total: number
          advance_account_id: string | null
          advance_payment: number | null
          advance_posted_at: string | null
          advance_transaction_id: string | null
          assigned_to: string | null
          client_signature: string | null
          code: string | null
          company_signature: string | null
          contract_date: string | null
          contractor_fee: number | null
          contractor_id: string | null
          contractor_name: string | null
          created_at: string | null
          created_by: string | null
          custom_product_id: string | null
          custom_workflow: string | null
          customer_id: string | null
          customer_name: string | null
          delivered_at: string | null
          description: string | null
          document_no: string | null
          end_date: string | null
          expected_delivery_date: string | null
          finished_goods_posted: boolean | null
          finished_product_id: string | null
          finished_product_name: string | null
          furniture_warehouse_id: string | null
          id: string
          installation_fee: number | null
          materials_allocated: boolean
          net_profit: number | null
          notes: string | null
          order_no: string | null
          ousta_id: string | null
          payment_status: string | null
          priority: string | null
          produced_quantity: number | null
          production_model: string
          profit_margin: number | null
          project_name: string
          project_scope: string | null
          quantity: number | null
          raw_material_warehouse_id: string | null
          remaining_balance: number | null
          sale_id: string | null
          start_date: string | null
          status: string | null
          subcontractor_fee_amount: number
          subcontractor_fee_percent: number
          subcontractor_id: string | null
          supplier_id: string | null
          supplier_name: string | null
          target_quantity: number | null
          terms: string | null
          terms_and_conditions: string | null
          total_cost: number | null
          total_expense_cost: number | null
          total_material_cost: number | null
          total_outsourcing_cost: number | null
          total_paid: number | null
          total_project_price: number | null
          type: string | null
          updated_at: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          additional_cost?: number | null
          additional_expenses?: Json
          additional_expenses_total?: number
          advance_account_id?: string | null
          advance_payment?: number | null
          advance_posted_at?: string | null
          advance_transaction_id?: string | null
          assigned_to?: string | null
          client_signature?: string | null
          code?: string | null
          company_signature?: string | null
          contract_date?: string | null
          contractor_fee?: number | null
          contractor_id?: string | null
          contractor_name?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_product_id?: string | null
          custom_workflow?: string | null
          customer_id?: string | null
          customer_name?: string | null
          delivered_at?: string | null
          description?: string | null
          document_no?: string | null
          end_date?: string | null
          expected_delivery_date?: string | null
          finished_goods_posted?: boolean | null
          finished_product_id?: string | null
          finished_product_name?: string | null
          furniture_warehouse_id?: string | null
          id?: string
          installation_fee?: number | null
          materials_allocated?: boolean
          net_profit?: number | null
          notes?: string | null
          order_no?: string | null
          ousta_id?: string | null
          payment_status?: string | null
          priority?: string | null
          produced_quantity?: number | null
          production_model?: string
          profit_margin?: number | null
          project_name: string
          project_scope?: string | null
          quantity?: number | null
          raw_material_warehouse_id?: string | null
          remaining_balance?: number | null
          sale_id?: string | null
          start_date?: string | null
          status?: string | null
          subcontractor_fee_amount?: number
          subcontractor_fee_percent?: number
          subcontractor_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          target_quantity?: number | null
          terms?: string | null
          terms_and_conditions?: string | null
          total_cost?: number | null
          total_expense_cost?: number | null
          total_material_cost?: number | null
          total_outsourcing_cost?: number | null
          total_paid?: number | null
          total_project_price?: number | null
          type?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          additional_cost?: number | null
          additional_expenses?: Json
          additional_expenses_total?: number
          advance_account_id?: string | null
          advance_payment?: number | null
          advance_posted_at?: string | null
          advance_transaction_id?: string | null
          assigned_to?: string | null
          client_signature?: string | null
          code?: string | null
          company_signature?: string | null
          contract_date?: string | null
          contractor_fee?: number | null
          contractor_id?: string | null
          contractor_name?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_product_id?: string | null
          custom_workflow?: string | null
          customer_id?: string | null
          customer_name?: string | null
          delivered_at?: string | null
          description?: string | null
          document_no?: string | null
          end_date?: string | null
          expected_delivery_date?: string | null
          finished_goods_posted?: boolean | null
          finished_product_id?: string | null
          finished_product_name?: string | null
          furniture_warehouse_id?: string | null
          id?: string
          installation_fee?: number | null
          materials_allocated?: boolean
          net_profit?: number | null
          notes?: string | null
          order_no?: string | null
          ousta_id?: string | null
          payment_status?: string | null
          priority?: string | null
          produced_quantity?: number | null
          production_model?: string
          profit_margin?: number | null
          project_name?: string
          project_scope?: string | null
          quantity?: number | null
          raw_material_warehouse_id?: string | null
          remaining_balance?: number | null
          sale_id?: string | null
          start_date?: string | null
          status?: string | null
          subcontractor_fee_amount?: number
          subcontractor_fee_percent?: number
          subcontractor_id?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          target_quantity?: number | null
          terms?: string | null
          terms_and_conditions?: string | null
          total_cost?: number | null
          total_expense_cost?: number | null
          total_material_cost?: number | null
          total_outsourcing_cost?: number | null
          total_paid?: number | null
          total_project_price?: number | null
          type?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_advance_account_id_fkey"
            columns: ["advance_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_advance_transaction_id_fkey"
            columns: ["advance_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_custom_product_id_fkey"
            columns: ["custom_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_finished_product_id_fkey"
            columns: ["finished_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_furniture_warehouse_id_fkey"
            columns: ["furniture_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_ousta_id_fkey"
            columns: ["ousta_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_raw_material_warehouse_id_fkey"
            columns: ["raw_material_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_subcontractor_id_fkey"
            columns: ["subcontractor_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      production_outsourcing: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          material_description: string | null
          notes: string | null
          price_per_sqm: number | null
          production_order_id: string | null
          sqm_quantity: number | null
          supplier_id: string | null
          supplier_name: string | null
          total_cost: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          material_description?: string | null
          notes?: string | null
          price_per_sqm?: number | null
          production_order_id?: string | null
          sqm_quantity?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_cost?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          material_description?: string | null
          notes?: string | null
          price_per_sqm?: number | null
          production_order_id?: string | null
          sqm_quantity?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_outsourcing_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_outsourcing_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          qr_code: string | null
          base_length: number | null
          base_width: number | null
          buy_price: number | null
          category: string | null
          category_id: string | null
          code: string
          color: string | null
          created_at: string | null
          extra_info: string | null
          full_sheet_length_m: number
          id: string
          inventory_mode: string
          is_dimensional: boolean
          min_stock: number | null
          name: string
          sell_price: number | null
          stock: number | null
          subcategory: string | null
          unit: string | null
          weight: string | null
        }
        Insert: {
          barcode?: string | null
          qr_code?: string | null
          base_length?: number | null
          base_width?: number | null
          buy_price?: number | null
          category?: string | null
          category_id?: string | null
          code: string
          color?: string | null
          created_at?: string | null
          extra_info?: string | null
          full_sheet_length_m?: number
          id?: string
          inventory_mode?: string
          is_dimensional?: boolean
          min_stock?: number | null
          name: string
          sell_price?: number | null
          stock?: number | null
          subcategory?: string | null
          unit?: string | null
          weight?: string | null
        }
        Update: {
          barcode?: string | null
          qr_code?: string | null
          base_length?: number | null
          base_width?: number | null
          buy_price?: number | null
          category?: string | null
          category_id?: string | null
          code?: string
          color?: string | null
          created_at?: string | null
          extra_info?: string | null
          full_sheet_length_m?: number
          id?: string
          inventory_mode?: string
          is_dimensional?: boolean
          min_stock?: number | null
          name?: string
          sell_price?: number | null
          stock?: number | null
          subcategory?: string | null
          unit?: string | null
          weight?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          phone: string | null
          role_id: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          phone?: string | null
          role_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          phone?: string | null
          role_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          id: string
          product_id: string | null
          purchase_id: string | null
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          id?: string
          product_id?: string | null
          purchase_id?: string | null
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          id?: string
          product_id?: string | null
          purchase_id?: string | null
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchase_items_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          additional_cost: number | null
          additional_expenses: Json
          additional_expenses_total: number
          created_at: string | null
          debt_amount: number | null
          id: string
          invoice_number: string
          paid_amount: number | null
          responsible_id: string | null
          responsible_name: string | null
          status: string | null
          supplier_id: string | null
          total_amount: number | null
          warehouse_sent: boolean | null
          warehouse_sent_at: string | null
          warehouse_slip_id: string | null
          warehouse_slip_status: string | null
        }
        Insert: {
          additional_cost?: number | null
          additional_expenses?: Json
          additional_expenses_total?: number
          created_at?: string | null
          debt_amount?: number | null
          id?: string
          invoice_number: string
          paid_amount?: number | null
          responsible_id?: string | null
          responsible_name?: string | null
          status?: string | null
          supplier_id?: string | null
          total_amount?: number | null
          warehouse_sent?: boolean | null
          warehouse_sent_at?: string | null
          warehouse_slip_id?: string | null
          warehouse_slip_status?: string | null
        }
        Update: {
          additional_cost?: number | null
          additional_expenses?: Json
          additional_expenses_total?: number
          created_at?: string | null
          debt_amount?: number | null
          id?: string
          invoice_number?: string
          paid_amount?: number | null
          responsible_id?: string | null
          responsible_name?: string | null
          status?: string | null
          supplier_id?: string | null
          total_amount?: number | null
          warehouse_sent?: boolean | null
          warehouse_sent_at?: string | null
          warehouse_slip_id?: string | null
          warehouse_slip_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_purchases_supplier"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_warehouse_slip_id_fkey"
            columns: ["warehouse_slip_id"]
            isOneToOne: false
            referencedRelation: "warehouse_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_system: boolean | null
          name: string
          permissions: Json | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          permissions?: Json | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          permissions?: Json | null
        }
        Relationships: []
      }
      salary_payments: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string | null
          employee_id: string | null
          id: string
          month_year: string
          notes: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          created_at?: string | null
          employee_id?: string | null
          id?: string
          month_year: string
          notes?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string | null
          employee_id?: string | null
          id?: string
          month_year?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salary_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_payments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          barcode: string | null
          discount_amount: number | null
          discount_percent: number | null
          extra_info: string | null
          id: string
          line_total: number | null
          piece_count: number
          polywood_area_m2: number | null
          polywood_cut_details: Json | null
          polywood_cutting_option: string | null
          polywood_edge_option: string | null
          polywood_length_m: number | null
          polywood_pieces: number | null
          polywood_sale_mode: string | null
          polywood_total_area_m2: number | null
          polywood_width_m: number | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity: number
          sale_id: string | null
          sale_item_type: string
          sku: string | null
          tax_amount: number | null
          tax_percent: number | null
          total_amount: number | null
          total_price: number | null
          unit: string | null
          unit_name: string | null
          unit_price: number
          vat_amount: number | null
          vat_rate: number | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          barcode?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          extra_info?: string | null
          id?: string
          line_total?: number | null
          piece_count?: number
          polywood_area_m2?: number | null
          polywood_cut_details?: Json | null
          polywood_cutting_option?: string | null
          polywood_edge_option?: string | null
          polywood_length_m?: number | null
          polywood_pieces?: number | null
          polywood_sale_mode?: string | null
          polywood_total_area_m2?: number | null
          polywood_width_m?: number | null
          product_code?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity: number
          sale_id?: string | null
          sale_item_type?: string
          sku?: string | null
          tax_amount?: number | null
          tax_percent?: number | null
          total_amount?: number | null
          total_price?: number | null
          unit?: string | null
          unit_name?: string | null
          unit_price: number
          vat_amount?: number | null
          vat_rate?: number | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          barcode?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          extra_info?: string | null
          id?: string
          line_total?: number | null
          piece_count?: number
          polywood_area_m2?: number | null
          polywood_cut_details?: Json | null
          polywood_cutting_option?: string | null
          polywood_edge_option?: string | null
          polywood_length_m?: number | null
          polywood_pieces?: number | null
          polywood_sale_mode?: string | null
          polywood_total_area_m2?: number | null
          polywood_width_m?: number | null
          product_code?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          sale_id?: string | null
          sale_item_type?: string
          sku?: string | null
          tax_amount?: number | null
          tax_percent?: number | null
          total_amount?: number | null
          total_price?: number | null
          unit?: string | null
          unit_name?: string | null
          unit_price?: number
          vat_amount?: number | null
          vat_rate?: number | null
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sale_items_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          additional_cost: number | null
          additional_expenses: Json
          additional_expenses_total: number
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          debt_amount: number | null
          delivery_address: string | null
          delivery_fee: number | null
          delivery_type: string | null
          discount_total: number | null
          doc_date: string | null
          doc_no: string | null
          id: string
          invoice_number: string | null
          items: Json | null
          note: string | null
          notes: string | null
          paid_amount: number | null
          payments: Json | null
          production_order_id: string | null
          remaining_balance: number | null
          salesperson_id: string | null
          seller_id: string | null
          seller_name: string | null
          status: string | null
          subtotal: number | null
          total_amount: number | null
          vat_total: number | null
          warehouse_name: string | null
          warehouse_sent: boolean | null
          warehouse_sent_at: string | null
          warehouse_slip_id: string | null
          warehouse_slip_status: string | null
        }
        Insert: {
          additional_cost?: number | null
          additional_expenses?: Json
          additional_expenses_total?: number
          created_at?: string | null
          customer_id?: string | null
          customer_name?: string | null
          debt_amount?: number | null
          delivery_address?: string | null
          delivery_fee?: number | null
          delivery_type?: string | null
          discount_total?: number | null
          doc_date?: string | null
          doc_no?: string | null
          id?: string
          invoice_number?: string | null
          items?: Json | null
          note?: string | null
          notes?: string | null
          paid_amount?: number | null
          payments?: Json | null
          production_order_id?: string | null
          remaining_balance?: number | null
          salesperson_id?: string | null
          seller_id?: string | null
          seller_name?: string | null
          status?: string | null
          subtotal?: number | null
          total_amount?: number | null
          vat_total?: number | null
          warehouse_name?: string | null
          warehouse_sent?: boolean | null
          warehouse_sent_at?: string | null
          warehouse_slip_id?: string | null
          warehouse_slip_status?: string | null
        }
        Update: {
          additional_cost?: number | null
          additional_expenses?: Json
          additional_expenses_total?: number
          created_at?: string | null
          customer_id?: string | null
          customer_name?: string | null
          debt_amount?: number | null
          delivery_address?: string | null
          delivery_fee?: number | null
          delivery_type?: string | null
          discount_total?: number | null
          doc_date?: string | null
          doc_no?: string | null
          id?: string
          invoice_number?: string | null
          items?: Json | null
          note?: string | null
          notes?: string | null
          paid_amount?: number | null
          payments?: Json | null
          production_order_id?: string | null
          remaining_balance?: number | null
          salesperson_id?: string | null
          seller_id?: string | null
          seller_name?: string | null
          status?: string | null
          subtotal?: number | null
          total_amount?: number | null
          vat_total?: number | null
          warehouse_name?: string | null
          warehouse_sent?: boolean | null
          warehouse_sent_at?: string | null
          warehouse_slip_id?: string | null
          warehouse_slip_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_customer"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_warehouse_slip_id_fkey"
            columns: ["warehouse_slip_id"]
            isOneToOne: false
            referencedRelation: "warehouse_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          address: string | null
          company_name: string | null
          id: string
          logo_url: string | null
          phone: string | null
          updated_at: string | null
          voen: string | null
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          updated_at?: string | null
          voen?: string | null
        }
        Update: {
          address?: string | null
          company_name?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          updated_at?: string | null
          voen?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          balance: number | null
          code: string | null
          company_name: string | null
          created_at: string | null
          full_name: string
          id: string
          phone: string | null
        }
        Insert: {
          balance?: number | null
          code?: string | null
          company_name?: string | null
          created_at?: string | null
          full_name: string
          id?: string
          phone?: string | null
        }
        Update: {
          balance?: number | null
          code?: string | null
          company_name?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category: string | null
          created_at: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          production_order_id: string | null
          source_id: string | null
          source_type: string | null
          type: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category?: string | null
          created_at?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          production_order_id?: string | null
          source_id?: string | null
          source_type?: string | null
          type: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string | null
          created_at?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          production_order_id?: string | null
          source_id?: string | null
          source_type?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_transactions_account"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_slips: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          delivery_due_at: string | null
          document_number: string | null
          id: string
          items: Json
          notes: string | null
          slip_number: string
          source_document_id: string | null
          source_document_no: string | null
          source_document_type: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["slip_status"] | null
          type: Database["public"]["Enums"]["slip_type"]
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_due_at?: string | null
          document_number?: string | null
          id?: string
          items: Json
          notes?: string | null
          slip_number: string
          source_document_id?: string | null
          source_document_no?: string | null
          source_document_type?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["slip_status"] | null
          type: Database["public"]["Enums"]["slip_type"]
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_due_at?: string | null
          document_number?: string | null
          id?: string
          items?: Json
          notes?: string | null
          slip_number?: string
          source_document_id?: string | null
          source_document_no?: string | null
          source_document_type?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["slip_status"] | null
          type?: Database["public"]["Enums"]["slip_type"]
          warehouse_id?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_slips_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_slips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          code: string
          created_at: string | null
          id: string
          is_default: boolean | null
          is_polywood: boolean | null
          location: string | null
          name: string
          warehouse_type: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          is_polywood?: boolean | null
          location?: string | null
          name: string
          warehouse_type?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          is_polywood?: boolean | null
          location?: string | null
          name?: string
          warehouse_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _apply_table_rls: {
        Args: {
          manage_perm?: string
          read_perm?: string
          target_table: unknown
          write_perm?: string
        }
        Returns: undefined
      }
      apply_document_additional_expenses: {
        Args: {
          p_doc_ref: string
          p_expenses: Json
          p_source_id: string
          p_source_type: string
        }
        Returns: number
      }
      check_customer_ar_discrepancies: { Args: never; Returns: Json }
      check_payment_permissions: {
        Args: { p_type: string; p_user_id: string }
        Returns: boolean
      }
      coa_credit_for_cash_in: { Args: { p_category: string }; Returns: string }
      coa_debit_for_cash_out: { Args: { p_category: string }; Returns: string }
      complete_custom_production_delivery_atomic: {
        Args: { p_account_id?: string; p_order_id: string }
        Returns: Json
      }
      compute_customer_open_ar: {
        Args: { p_customer_id: string }
        Returns: number
      }
      compute_production_issued_material_cost: {
        Args: { p_order_id: string }
        Returns: number
      }
      compute_production_wip_cost: {
        Args: { p_order_id: string }
        Returns: number
      }
      compute_supplier_open_ap: {
        Args: { p_supplier_id: string }
        Returns: number
      }
      create_account_atomic: {
        Args: {
          p_code: string
          p_name: string
          p_opening_balance?: number
          p_type: string
        }
        Returns: string
      }
      create_production_expense_atomic: {
        Args: {
          p_account_id: string
          p_account_name?: string
          p_actor_name?: string
          p_amount: number
          p_category: string
          p_code: string
          p_description: string
          p_expense_date: string
          p_notes?: string
          p_production_order_id: string
        }
        Returns: string
      }
      create_production_warehouse_slip: {
        Args: {
          p_items: Json
          p_notes?: string
          p_order_id: string
          p_slip_type: string
          p_warehouse_id: string
          p_warehouse_name: string
        }
        Returns: string
      }
      create_purchase_atomic: { Args: { p_payload: Json }; Returns: Json }
      create_sale_atomic: { Args: { p_payload: Json }; Returns: Json }
      current_user_permissions: { Args: never; Returns: Json }
      find_erp_event_by_idempotency: { Args: { p_key: string }; Returns: Json }
      has_permission: { Args: { perm: string }; Returns: boolean }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      log_erp_event: {
        Args: {
          p_event_type: string
          p_idempotency_key: string
          p_journal_entry_id: string
          p_payload: Json
          p_result: Json
          p_source_id: string
          p_source_table: string
        }
        Returns: string
      }
      post_cash_transaction:
        | {
            Args: {
              p_account_id: string
              p_amount: number
              p_category: string
              p_notes?: string
              p_production_order_id?: string
              p_source_id?: string
              p_source_type?: string
              p_type: string
            }
            Returns: string
          }
        | { Args: { p_payload: Json }; Returns: string }
      post_journal_entry: { Args: { p_payload: Json }; Returns: string }
      post_sale: {
        Args: {
          p_account_id: string
          p_customer_id: string
          p_items: Json
          p_notes?: string
          p_paid_amount: number
          p_seller_id: string
          p_warehouse_id: string
        }
        Returns: string
      }
      process_invoice_payment_event: {
        Args: { p_payload: Json }
        Returns: Json
      }
      process_mixed_dimensional_sale: {
        Args: {
          p_amount?: number
          p_item_type: string
          p_piece_count?: number
          p_product_id: string
          p_sale_item_id?: string
          p_sale_mode?: string
          p_warehouse_id: string
        }
        Returns: Json
      }
      process_production_advance_payment_event: {
        Args: { p_payload: Json }
        Returns: Json
      }
      process_production_delivery_event: {
        Args: { p_account_id?: string; p_order_id: string }
        Returns: Json
      }
      process_production_material_issue_event: {
        Args: {
          p_material_ids?: string[]
          p_order_id: string
          p_update_status?: boolean
        }
        Returns: Json
      }
      process_production_ready_event: {
        Args: { p_order_id: string }
        Returns: Json
      }
      process_purchase_receipt_event: {
        Args: { p_payload: Json }
        Returns: Json
      }
      process_sales_invoice_event: { Args: { p_payload: Json }; Returns: Json }
      production_material_line_cost: {
        Args: { p_line_cost: number; p_quantity: number; p_unit_cost: number }
        Returns: number
      }
      production_record_furniture_receipt_from_order: {
        Args: { p_order_id: string }
        Returns: string
      }
      production_record_material_issue_slip: {
        Args: { p_material_ids?: string[]; p_order_id: string }
        Returns: string
      }
      reconcile_account_balance_atomic: {
        Args: { p_account_id?: string }
        Returns: Json
      }
      reconcile_customer_ar_balances: {
        Args: { p_customer_id?: string }
        Returns: Json
      }
      record_payment_atomic: { Args: { p_payload: Json }; Returns: Json }
      refresh_customer_ar_balance: {
        Args: { p_customer_id: string }
        Returns: number
      }
      refresh_supplier_ap_balance: {
        Args: { p_supplier_id: string }
        Returns: number
      }
      require_permission: { Args: { perm: string }; Returns: boolean }
      resolve_coa_id: { Args: { p_code: string }; Returns: string }
      rollback_mixed_dimensional_sale: {
        Args: { p_sale_item_id: string }
        Returns: Json
      }
      set_account_opening_balance_atomic: {
        Args: { p_account_id: string; p_target_balance: number }
        Returns: Json
      }
      user_has_permission: { Args: { perm: string }; Returns: boolean }
      void_sale_atomic: {
        Args: { p_reason?: string; p_sale_id: string }
        Returns: Json
      }
      void_purchase_atomic: {
        Args: { p_purchase_id: string; p_reason?: string }
        Returns: Json
      }
    }
    Enums: {
      slip_status: "pending" | "approved" | "rejected"
      slip_type: "inbound" | "outbound" | "waste"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      slip_status: ["pending", "approved", "rejected"],
      slip_type: ["inbound", "outbound", "waste"],
    },
  },
} as const
