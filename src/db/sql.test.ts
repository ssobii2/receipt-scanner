import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  SCHEMA_SQL, INSERT_RECEIPT, LIST_RECEIPTS, MONTHLY_TOTALS,
  CATEGORY_BREAKDOWN, UPSERT_MERCHANT_CATEGORY, ALL_MERCHANT_CATEGORIES,
  DELETE_RECEIPT, UPDATE_RECEIPT,
} from './sql';

// These statements run under expo-sqlite in the app and bun:sqlite here.
// ponytail: this tests the SQL, not expo-sqlite's binding to it. Upgrade path
// is an on-device smoke test if a binding-level bug ever appears.
let db: Database;

type Row = Record<string, unknown>;

function insert(o: Partial<Row> = {}) {
  db.query(INSERT_RECEIPT).run({
    $merchant: 'Foodpanda',
    $merchant_key: 'foodpanda',
    $amount_minor: 185000,
    $currency: 'PKR',
    $spent_on: '2026-09-08',
    $category: 'Eating out',
    $image_path: null,
    $total_source_text: 'Rs. 1,850/-',
    $created_at: '2026-09-08T10:00:00Z',
    ...o,
  } as never);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.run(SCHEMA_SQL);
});

describe('schema', () => {
  it('creates both tables', () => {
    const names = db.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const t = names.map((r) => r.name);
    expect(t).toContain('receipts');
    expect(t).toContain('merchant_categories');
  });

  it('is idempotent so app startup can run it every launch', () => {
    expect(() => { db.run(SCHEMA_SQL); db.run(SCHEMA_SQL); }).not.toThrow();
  });

  it('rejects a receipt missing a required field', () => {
    expect(() => insert({ $amount_minor: null })).toThrow();
    expect(() => insert({ $currency: null })).toThrow();
    expect(() => insert({ $spent_on: null })).toThrow();
  });

  it('allows a null image_path and null source text', () => {
    expect(() => insert({ $image_path: null, $total_source_text: null })).not.toThrow();
  });
});

describe('LIST_RECEIPTS', () => {
  it('returns newest spend first', () => {
    insert({ $spent_on: '2026-07-01', $merchant: 'A' });
    insert({ $spent_on: '2026-09-08', $merchant: 'B' });
    insert({ $spent_on: '2026-08-15', $merchant: 'C' });
    const rows = db.query(LIST_RECEIPTS).all() as Array<{ merchant: string }>;
    expect(rows.map((r) => r.merchant)).toEqual(['B', 'C', 'A']);
  });

  it('breaks same-day ties by most recently added', () => {
    insert({ $spent_on: '2026-09-08', $merchant: 'first', $created_at: '2026-09-08T09:00:00Z' });
    insert({ $spent_on: '2026-09-08', $merchant: 'second', $created_at: '2026-09-08T18:00:00Z' });
    const rows = db.query(LIST_RECEIPTS).all() as Array<{ merchant: string }>;
    expect(rows.map((r) => r.merchant)).toEqual(['second', 'first']);
  });

  it('exposes the month so the list can group without parsing dates in JS', () => {
    insert({ $spent_on: '2026-09-08' });
    const [row] = db.query(LIST_RECEIPTS).all() as Array<{ month: string }>;
    expect(row.month).toBe('2026-09');
  });
});

describe('MONTHLY_TOTALS', () => {
  it('sums per month, newest month first', () => {
    insert({ $spent_on: '2026-09-01', $amount_minor: 100000 });
    insert({ $spent_on: '2026-09-30', $amount_minor: 50000 });
    insert({ $spent_on: '2026-08-14', $amount_minor: 20000 });
    const rows = db.query(MONTHLY_TOTALS).all({ $limit: 6 } as never) as Array<Row>;
    expect(rows[0]).toMatchObject({ month: '2026-09', currency: 'PKR', total_minor: 150000, n: 2 });
    expect(rows[1]).toMatchObject({ month: '2026-08', currency: 'PKR', total_minor: 20000, n: 1 });
  });

  // PKR + USD in one bar is a meaningless number.
  it('never sums across currencies', () => {
    insert({ $spent_on: '2026-09-01', $amount_minor: 100000, $currency: 'PKR' });
    insert({ $spent_on: '2026-09-02', $amount_minor: 1000, $currency: 'USD' });
    const rows = db.query(MONTHLY_TOTALS).all({ $limit: 6 } as never) as Array<Row>;
    expect(rows).toHaveLength(2);
    const byCur = Object.fromEntries(rows.map((r) => [r.currency, r.total_minor]));
    expect(byCur).toEqual({ PKR: 100000, USD: 1000 });
  });

  it('honours the month limit', () => {
    for (const m of ['04', '05', '06', '07', '08', '09']) insert({ $spent_on: `2026-${m}-10` });
    expect(db.query(MONTHLY_TOTALS).all({ $limit: 3 } as never)).toHaveLength(3);
    expect(db.query(MONTHLY_TOTALS).all({ $limit: 6 } as never)).toHaveLength(6);
  });

  it('keeps totals as exact integers', () => {
    insert({ $spent_on: '2026-09-01', $amount_minor: 1 });
    insert({ $spent_on: '2026-09-02', $amount_minor: 2 });
    const [row] = db.query(MONTHLY_TOTALS).all({ $limit: 6 } as never) as Array<Row>;
    expect(row.total_minor).toBe(3);
    expect(Number.isInteger(row.total_minor)).toBe(true);
  });

  // Regression: LIMIT bounded ROWS, but this groups by month AND currency, so
  // one month spanning two currencies is two rows. Asking for 6 months could
  // silently return 3. The fixture that let this through was single-currency,
  // where rows and months happen to be the same number.
  it('limits by month, not by row, when a month spans several currencies', () => {
    for (const m of ['04', '05', '06', '07', '08', '09']) {
      insert({ $spent_on: `2026-${m}-10`, $currency: 'PKR', $amount_minor: 100000 });
      insert({ $spent_on: `2026-${m}-11`, $currency: 'USD', $amount_minor: 1000 });
    }
    const rows = db.query(MONTHLY_TOTALS).all({ $limit: 3 } as never) as Array<Row>;
    const months = [...new Set(rows.map((r) => r.month))];
    expect(months).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(rows).toHaveLength(6);
  });

  it('returns every currency of the oldest month it includes', () => {
    // The boundary month must not be half-reported: whichever months make the
    // cut, all of their currencies come back.
    insert({ $spent_on: '2026-09-01', $currency: 'PKR', $amount_minor: 100000 });
    insert({ $spent_on: '2026-08-01', $currency: 'PKR', $amount_minor: 200000 });
    insert({ $spent_on: '2026-08-02', $currency: 'USD', $amount_minor: 3000 });
    insert({ $spent_on: '2026-08-03', $currency: 'EUR', $amount_minor: 4000 });
    const rows = db.query(MONTHLY_TOTALS).all({ $limit: 2 } as never) as Array<Row>;
    const aug = rows.filter((r) => r.month === '2026-08').map((r) => r.currency).sort();
    expect(aug).toEqual(['EUR', 'PKR', 'USD']);
  });
});

describe('CATEGORY_BREAKDOWN', () => {
  it('totals one month of one currency by category, largest first', () => {
    insert({ $spent_on: '2026-09-02', $category: 'Groceries', $amount_minor: 30000 });
    insert({ $spent_on: '2026-09-03', $category: 'Eating out', $amount_minor: 90000 });
    insert({ $spent_on: '2026-09-04', $category: 'Groceries', $amount_minor: 20000 });
    insert({ $spent_on: '2026-08-04', $category: 'Transport', $amount_minor: 99999 });
    insert({ $spent_on: '2026-09-05', $category: 'Transport', $amount_minor: 700, $currency: 'USD' });

    const rows = db.query(CATEGORY_BREAKDOWN)
      .all({ $month: '2026-09', $currency: 'PKR' } as never) as Array<Row>;

    expect(rows).toEqual([
      { category: 'Eating out', total_minor: 90000, n: 1 },
      { category: 'Groceries', total_minor: 50000, n: 2 },
    ]);
  });

  it('returns nothing for a month with no spend', () => {
    insert({ $spent_on: '2026-09-02' });
    expect(db.query(CATEGORY_BREAKDOWN).all({ $month: '2026-01', $currency: 'PKR' } as never)).toEqual([]);
  });
});

describe('merchant_categories', () => {
  it('stores and reads back a learned correction', () => {
    db.query(UPSERT_MERCHANT_CATEGORY).run({ $merchant_key: 'imtiaz', $category: 'Groceries' } as never);
    const rows = db.query(ALL_MERCHANT_CATEGORIES).all() as Array<Row>;
    expect(rows).toEqual([{ merchant_key: 'imtiaz', category: 'Groceries' }]);
  });

  it('overwrites rather than duplicating when the user re-corrects', () => {
    db.query(UPSERT_MERCHANT_CATEGORY).run({ $merchant_key: 'imtiaz', $category: 'Groceries' } as never);
    db.query(UPSERT_MERCHANT_CATEGORY).run({ $merchant_key: 'imtiaz', $category: 'Shopping' } as never);
    const rows = db.query(ALL_MERCHANT_CATEGORIES).all() as Array<Row>;
    expect(rows).toEqual([{ merchant_key: 'imtiaz', category: 'Shopping' }]);
  });

  // What the app learned must outlive the receipt that taught it.
  it('survives deletion of every receipt from that merchant', () => {
    insert({ $merchant_key: 'imtiaz' });
    db.query(UPSERT_MERCHANT_CATEGORY).run({ $merchant_key: 'imtiaz', $category: 'Groceries' } as never);
    const [{ id }] = db.query(`SELECT id FROM receipts`).all() as Array<{ id: number }>;
    db.query(DELETE_RECEIPT).run({ $id: id } as never);
    expect(db.query(`SELECT COUNT(*) AS n FROM receipts`).get()).toMatchObject({ n: 0 });
    expect(db.query(ALL_MERCHANT_CATEGORIES).all()).toHaveLength(1);
  });
});

describe('UPDATE_RECEIPT / DELETE_RECEIPT', () => {
  it('edits a row in place without changing its id', () => {
    insert();
    const [{ id }] = db.query(`SELECT id FROM receipts`).all() as Array<{ id: number }>;
    db.query(UPDATE_RECEIPT).run({
      $id: id, $merchant: 'Careem', $merchant_key: 'careem', $amount_minor: 64000,
      $currency: 'PKR', $spent_on: '2026-09-07', $category: 'Transport', $image_path: null,
    } as never);
    const row = db.query(`SELECT * FROM receipts`).get() as Row;
    expect(row).toMatchObject({ id, merchant: 'Careem', amount_minor: 64000, category: 'Transport' });
  });

  it('deletes only the row asked for', () => {
    insert({ $merchant: 'A' });
    insert({ $merchant: 'B' });
    const rows = db.query(`SELECT id, merchant FROM receipts ORDER BY merchant`).all() as Array<{ id: number }>;
    db.query(DELETE_RECEIPT).run({ $id: rows[0].id } as never);
    expect(db.query(`SELECT merchant FROM receipts`).all()).toEqual([{ merchant: 'B' }]);
  });
});
