// Thin async wrapper binding sql.ts statements to expo-sqlite. No business
// logic or validation here — that lives in src/lib.
import * as SQLite from 'expo-sqlite';
import type { Category } from '../lib/category';
import {
  SCHEMA_SQL, INSERT_RECEIPT, LIST_RECEIPTS, MONTHLY_TOTALS,
  CATEGORY_BREAKDOWN, UPSERT_MERCHANT_CATEGORY, ALL_MERCHANT_CATEGORIES,
  DELETE_RECEIPT, UPDATE_RECEIPT,
} from './sql';

export type ReceiptRow = {
  id: number;
  merchant: string;
  merchant_key: string;
  amount_minor: number;
  currency: string;
  spent_on: string;
  category: string;
  image_path: string | null;
  total_source_text: string | null;
  created_at: string;
  month: string;
};

export type MonthTotal = { month: string; currency: string; total_minor: number; n: number };
export type CategoryTotal = { category: string; total_minor: number; n: number };

export type NewReceipt = {
  merchant: string;
  merchant_key: string;
  amount_minor: number;
  currency: string;
  spent_on: string;
  category: string;
  image_path: string | null;
  total_source_text: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('receipts.db');
  return dbPromise;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync(SCHEMA_SQL);
}

export async function addReceipt(r: NewReceipt): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(INSERT_RECEIPT, {
    $merchant: r.merchant,
    $merchant_key: r.merchant_key,
    $amount_minor: r.amount_minor,
    $currency: r.currency,
    $spent_on: r.spent_on,
    $category: r.category,
    $image_path: r.image_path,
    $total_source_text: r.total_source_text,
    $created_at: new Date().toISOString(),
  });
  return result.lastInsertRowId;
}

export async function listReceipts(): Promise<ReceiptRow[]> {
  const db = await getDb();
  return db.getAllAsync<ReceiptRow>(LIST_RECEIPTS);
}

// limit is a count of MONTHS, not rows — a month with several currencies
// returns several rows, all included.
export async function monthlyTotals(limit = 6): Promise<MonthTotal[]> {
  const db = await getDb();
  return db.getAllAsync<MonthTotal>(MONTHLY_TOTALS, { $limit: limit });
}

export async function categoryBreakdown(month: string, currency: string): Promise<CategoryTotal[]> {
  const db = await getDb();
  return db.getAllAsync<CategoryTotal>(CATEGORY_BREAKDOWN, { $month: month, $currency: currency });
}

export async function learnedCategories(): Promise<Record<string, Category>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ merchant_key: string; category: Category }>(ALL_MERCHANT_CATEGORIES);
  // Object.create(null): merchant_key comes from OCR of arbitrary photos, so a
  // key of "__proto__" must not be able to pollute a plain object's prototype.
  const out: Record<string, Category> = Object.create(null);
  for (const row of rows) out[row.merchant_key] = row.category;
  return out;
}

export async function rememberCategory(merchantKey: string, category: Category): Promise<void> {
  const db = await getDb();
  await db.runAsync(UPSERT_MERCHANT_CATEGORY, { $merchant_key: merchantKey, $category: category });
}

export async function updateReceipt(id: number, r: NewReceipt): Promise<void> {
  const db = await getDb();
  await db.runAsync(UPDATE_RECEIPT, {
    $id: id,
    $merchant: r.merchant,
    $merchant_key: r.merchant_key,
    $amount_minor: r.amount_minor,
    $currency: r.currency,
    $spent_on: r.spent_on,
    $category: r.category,
    $image_path: r.image_path,
  });
}

export async function deleteReceipt(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(DELETE_RECEIPT, { $id: id });
}
