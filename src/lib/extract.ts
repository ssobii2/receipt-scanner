// Turns Gemini's raw JSON response into a validated Extraction. Every field
// is validated independently -- one bad field must never null out the rest,
// since a partially-readable receipt is still worth showing the user.

import { CATEGORIES, type Category } from './category';
import { merchantKey } from './merchant';
import { normalizeSpentOn } from './dates';
import { parseAmountToMinor } from './money';

export type Extraction = {
  merchant: string | null;
  merchantKey: string | null;
  amountMinor: number | null;
  currency: string | null;
  totalSourceText: string | null;
  spentOn: string | null;
  category: Category | null;
};

const EMPTY_EXTRACTION: Extraction = {
  merchant: null,
  merchantKey: null,
  amountMinor: null,
  currency: null,
  totalSourceText: null,
  spentOn: null,
  category: null,
};

const CURRENCY_RE = /^[A-Z]{3}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Validates Gemini's wire shape into an Extraction. Never throws -- any
 * input that isn't the expected object shape simply yields all nulls. */
export function validateExtraction(raw: unknown, today: string): Extraction {
  if (!isRecord(raw)) return { ...EMPTY_EXTRACTION };

  const trimmedMerchant = asString(raw.merchant)?.trim() ?? '';
  const merchant = trimmedMerchant.length > 0 ? trimmedMerchant : null;

  const trimmedCurrency = asString(raw.currency)?.trim().toUpperCase() ?? null;
  const currency = trimmedCurrency !== null && CURRENCY_RE.test(trimmedCurrency) ? trimmedCurrency : null;

  // Exponent is unknown without a valid currency, so the amount cannot be scaled.
  const totalValue = asString(raw.total_value);
  const amountMinor = currency !== null && totalValue !== null
    ? parseAmountToMinor(totalValue, currency)
    : null;

  const categoryGuess = asString(raw.category);
  const category = categoryGuess !== null && (CATEGORIES as readonly string[]).includes(categoryGuess)
    ? (categoryGuess as Category)
    : null;

  return {
    merchant,
    merchantKey: merchantKey(merchant),
    amountMinor,
    currency,
    totalSourceText: asString(raw.total_text),
    spentOn: normalizeSpentOn(asString(raw.date_iso), today),
    category,
  };
}

/** True when nothing usable came back at all -- the "this photo was of a
 * cat" case, indistinguishable from a torn-off total in what the user does
 * next. */
export function isEmptyExtraction(e: Extraction): boolean {
  return Object.values(e).every((v) => v === null);
}
