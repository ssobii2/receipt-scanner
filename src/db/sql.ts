// Plain SQL strings — no expo imports. Exercised as-is by sql.test.ts
// (bun:sqlite) and by src/db/index.ts (expo-sqlite) so both run identical SQL.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant TEXT NOT NULL,
  merchant_key TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  spent_on TEXT NOT NULL,
  category TEXT NOT NULL,
  image_path TEXT,
  total_source_text TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS merchant_categories (
  merchant_key TEXT PRIMARY KEY,
  category TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_spent_on ON receipts(spent_on);
`;

export const INSERT_RECEIPT = `
INSERT INTO receipts
  (merchant, merchant_key, amount_minor, currency, spent_on, category, image_path, total_source_text, created_at)
VALUES
  ($merchant, $merchant_key, $amount_minor, $currency, $spent_on, $category, $image_path, $total_source_text, $created_at)
`;

export const LIST_RECEIPTS = `
SELECT *, strftime('%Y-%m', spent_on) AS month
FROM receipts
ORDER BY spent_on DESC, created_at DESC
`;

// One row per (month, currency) — never summed across currencies. $limit
// counts MONTHS, not rows: a month spanning several currencies is several
// rows, so the month set is picked first and every currency of an included
// month comes back.
export const MONTHLY_TOTALS = `
SELECT
  strftime('%Y-%m', spent_on) AS month,
  currency,
  SUM(amount_minor) AS total_minor,
  COUNT(*) AS n
FROM receipts
WHERE strftime('%Y-%m', spent_on) IN (
  SELECT DISTINCT strftime('%Y-%m', spent_on) FROM receipts ORDER BY 1 DESC LIMIT $limit
)
GROUP BY month, currency
ORDER BY month DESC, currency
`;

export const CATEGORY_BREAKDOWN = `
SELECT
  category,
  SUM(amount_minor) AS total_minor,
  COUNT(*) AS n
FROM receipts
WHERE strftime('%Y-%m', spent_on) = $month AND currency = $currency
GROUP BY category
ORDER BY total_minor DESC
`;

export const UPSERT_MERCHANT_CATEGORY = `
INSERT INTO merchant_categories (merchant_key, category)
VALUES ($merchant_key, $category)
ON CONFLICT(merchant_key) DO UPDATE SET category = excluded.category
`;

export const ALL_MERCHANT_CATEGORIES = `
SELECT merchant_key, category FROM merchant_categories
`;

// Deliberately does not touch merchant_categories — what the app learned
// outlives the receipt that taught it.
export const DELETE_RECEIPT = `
DELETE FROM receipts WHERE id = $id
`;

export const UPDATE_RECEIPT = `
UPDATE receipts
SET merchant = $merchant,
    merchant_key = $merchant_key,
    amount_minor = $amount_minor,
    currency = $currency,
    spent_on = $spent_on,
    category = $category,
    image_path = $image_path
WHERE id = $id
`;
