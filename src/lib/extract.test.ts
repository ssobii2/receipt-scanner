import { describe, it, expect } from 'bun:test';
import { validateExtraction, isEmptyExtraction } from './extract';

const today = '2026-09-09';

// Wire shape from Gemini. total_value is the model-normalised canonical decimal
// ('.' separator, no grouping); total_text is the literal string it read, kept so
// a wrong read is visible to the user rather than mysterious.
const good = {
  merchant: 'Foodpanda',
  total_value: '1850.00',
  total_text: 'Rs. 1,850/-',
  currency: 'PKR',
  date_iso: '2026-09-08',
  date_text: '08/09/2026',
  category: 'Eating out',
};

describe('validateExtraction', () => {
  it('maps a well-formed response', () => {
    const e = validateExtraction(good, today);
    expect(e.merchant).toBe('Foodpanda');
    expect(e.merchantKey).toBe('foodpanda');
    expect(e.amountMinor).toBe(185000); // ISO exponent 2, not CLDR's 0
    expect(e.currency).toBe('PKR');
    expect(e.totalSourceText).toBe('Rs. 1,850/-');
    expect(e.spentOn).toBe('2026-09-08');
    expect(e.category).toBe('Eating out');
  });

  // Never throws. A bad response is a response full of nulls, not a crash.
  it('returns all nulls for input that is not an object', () => {
    for (const junk of [null, undefined, 'text', 42, [], true]) {
      expect(isEmptyExtraction(validateExtraction(junk, today))).toBe(true);
    }
  });

  it('nulls only the fields that fail, keeping the rest', () => {
    const e = validateExtraction({ ...good, total_value: 'TOTAL' }, today);
    expect(e.amountMinor).toBeNull();
    expect(e.merchant).toBe('Foodpanda');
    expect(e.spentOn).toBe('2026-09-08');
  });

  it('nulls a future date but keeps the amount', () => {
    const e = validateExtraction({ ...good, date_iso: '2026-12-25' }, today);
    expect(e.spentOn).toBeNull();
    expect(e.amountMinor).toBe(185000);
  });

  // Without a currency the exponent is unknown, so the amount cannot be scaled.
  it('nulls the amount when the currency is missing or invalid', () => {
    expect(validateExtraction({ ...good, currency: null }, today).amountMinor).toBeNull();
    expect(validateExtraction({ ...good, currency: 'RUPEES' }, today).currency).toBeNull();
    expect(validateExtraction({ ...good, currency: 'RUPEES' }, today).amountMinor).toBeNull();
  });

  it('uppercases a lowercase currency code', () => {
    expect(validateExtraction({ ...good, currency: 'pkr' }, today).currency).toBe('PKR');
  });

  it('nulls a category outside the fixed list', () => {
    expect(validateExtraction({ ...good, category: 'Grocery' }, today).category).toBeNull();
    expect(validateExtraction({ ...good, category: 'Other' }, today).category).toBe('Other');
  });

  it('keeps the source text even when the value fails to parse', () => {
    const e = validateExtraction({ ...good, total_value: null }, today);
    expect(e.amountMinor).toBeNull();
    expect(e.totalSourceText).toBe('Rs. 1,850/-');
  });

  it('accepts a currency whose exponent is not 2', () => {
    const jp = validateExtraction(
      { ...good, currency: 'JPY', total_value: '3450', total_text: '¥3,450' }, today,
    );
    expect(jp.amountMinor).toBe(3450);
    const kw = validateExtraction(
      { ...good, currency: 'KWD', total_value: '12.345', total_text: 'KD 12.345' }, today,
    );
    expect(kw.amountMinor).toBe(12345);
  });
});

describe('isEmptyExtraction', () => {
  // This is what "that photo was a cat" looks like. Identical to a blurry receipt
  // and a torn-off total, because the user's next action is identical.
  it('is true when nothing usable came back', () => {
    const e = validateExtraction(
      { merchant: null, total_value: null, total_text: null, currency: null, date_iso: null, category: null },
      today,
    );
    expect(isEmptyExtraction(e)).toBe(true);
  });

  it('is false when anything usable came back', () => {
    expect(isEmptyExtraction(validateExtraction({ ...good, total_value: null }, today))).toBe(false);
    expect(isEmptyExtraction(validateExtraction(good, today))).toBe(false);
  });
});

describe('validateExtraction type strictness', () => {
  // The Gemini responseSchema declares total_value as a string. Accepting a
  // JSON number instead would route the amount through float64 before we ever
  // see it, defeating the string-math parser. Strict here surfaces schema
  // drift as an empty field the user fills, not as a silently wrong total.
  it('rejects a numeric total_value rather than coercing it', () => {
    expect(validateExtraction({ ...good, total_value: 1850 }, today).amountMinor).toBeNull();
    expect(validateExtraction({ ...good, total_value: 1850 }, today).totalSourceText).toBe('Rs. 1,850/-');
  });

  it('ignores wrong-typed fields without throwing', () => {
    const e = validateExtraction(
      { merchant: 42, total_value: {}, total_text: [], currency: 7, date_iso: true, category: null },
      today,
    );
    expect(isEmptyExtraction(e)).toBe(true);
  });
});
