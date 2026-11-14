/**
 * Skills of Del Assistant (AST-1): groups of tools with a short instruction each. A turn gets only the
 * skills that fit the page, the record in view and the question, and only the tools the user may use
 * (permission + company plan; the tool registry checks both again when a tool runs).
 *
 * Pure module: no database, no SDK; the engine turns skill ids into tool definitions.
 */

export type SkillId = "sales" | "customers" | "inventory" | "finance" | "production" | "accountant";

export interface Skill {
  id: SkillId;
  /** Tool names (native read tools, or the guard's tools for `accountant`). */
  tools: readonly string[];
  /** One or two sentences the system prompt gets when the skill is on. */
  instructions: string;
  /** Only for admins (the guard's tools read across the whole company). */
  adminOnly?: boolean;
}

export const SKILLS: readonly Skill[] = [
  {
    id: "sales",
    tools: ["list_sales", "get_sale"],
    instructions: "Sales documents: find invoices by customer, number or date and open one with its lines. Quote document numbers with their links.",
  },
  {
    id: "customers",
    tools: ["search_customers", "top_debtors"],
    instructions: "Customers: find a customer and their balance; list who owes the most.",
  },
  {
    id: "inventory",
    tools: ["search_products", "stock_alerts"],
    instructions: "Products and stock: find products with prices and stock, and products below their minimum.",
  },
  {
    id: "finance",
    tools: ["finance_summary"],
    instructions: "Money: balances of cash and bank accounts and the totals of a period.",
  },
  {
    id: "production",
    tools: ["production_orders"],
    instructions: "Production: production orders and their status.",
  },
  {
    id: "accountant",
    tools: ["list_findings", "get_finding", "get_document", "trial_balance", "partner_statement", "guard_rules", "list_memory", "suggest_false_positive"],
    instructions:
      "Accountant (Accounting Guard): you review the guard's findings and the books like a sceptical chartered accountant. Separate real errors, suspicious items and probably-fine items; propose corrections in words (which entry to reverse, which to post) but never post anything. suggest_false_positive only records a suggestion an admin confirms.",
    adminOnly: true,
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

export function skillById(id: SkillId): Skill {
  return BY_ID.get(id) as Skill;
}

/** Page path prefix → skill. */
const PAGE_SKILLS: Array<[RegExp, SkillId]> = [
  [/^\/sales\b/, "sales"],
  [/^\/(customers|dashboard\/partners)\b/, "customers"],
  [/^\/(products|inventory|warehouse|warehouses)\b/, "inventory"],
  [/^\/(finance\/guard)\b/, "accountant"],
  [/^\/(finance(?!\/guard)|cash-bank|payments|expenses|reports)\b/, "finance"],
  [/^\/production\b/, "production"],
];

/** Record type in context → skill. */
const RECORD_SKILLS: Record<string, SkillId> = {
  sale: "sales",
  customer: "customers",
  product: "inventory",
  production_order: "production",
  guard_finding: "accountant",
};

/** Words of the question (az / en / ru / fa) → skill. */
const WORD_SKILLS: Array<[RegExp, SkillId]> = [
  [/(invoice|sale|sold|satış|faktura|qaimə|продаж|счёт|счет|накладн|فاکتور|فروش)/i, "sales"],
  [/(customer|client|debtor|owe|müştəri|borc|клиент|покупател|долж|задолж|مشتری|بدهکار|بدهی)/i, "customers"],
  [/(product|stock|warehouse|item|məhsul|anbar|qalıq|товар|склад|остат|کالا|محصول|انبار|موجودی)/i, "inventory"],
  [/(cash|bank|account|balance|profit|expense|kassa|bank|hesab|xərc|mənfəət|касс|банк|счет|расход|прибыл|صندوق|بانک|حساب|هزینه|سود)/i, "finance"],
  [/(production|manufactur|istehsal|производств|تولید)/i, "production"],
  [/(guard|finding|audit|ledger|trial balance|journal|mühasib|nəzarət|yoxla|бухгалт|проводк|журнал|حسابدار|گارد|دفتر|سند حسابداری|اشتباه)/i, "accountant"],
];

export const MAX_SKILLS = 6;

export interface SelectInput {
  page?: string | null;
  recordType?: string | null;
  question: string;
  isAdmin: boolean;
}

/**
 * The skills for a turn, in a fixed order (SKILLS order, so the tool list is stable for the prompt cache).
 * Page and record first, then the question's words; when nothing matches, every skill the user may have
 * (the tool registry still drops tools outside their permissions and plan).
 */
export function selectSkills(input: SelectInput): SkillId[] {
  const chosen = new Set<SkillId>();
  const page = (input.page ?? "").split("?")[0];
  for (const [pattern, id] of PAGE_SKILLS) if (pattern.test(page)) chosen.add(id);
  const fromRecord = input.recordType ? RECORD_SKILLS[input.recordType] : undefined;
  if (fromRecord) chosen.add(fromRecord);
  for (const [pattern, id] of WORD_SKILLS) if (pattern.test(input.question)) chosen.add(id);

  const allowed = (id: SkillId) => !skillById(id).adminOnly || input.isAdmin;
  let ids = SKILLS.map((s) => s.id).filter((id) => chosen.has(id) && allowed(id));
  if (ids.length === 0) ids = SKILLS.map((s) => s.id).filter((id) => allowed(id) && id !== "accountant");
  return ids.slice(0, MAX_SKILLS);
}
