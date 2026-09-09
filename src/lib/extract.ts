// Turns the extraction model's raw JSON response into a validated Extraction. Every field
// is validated independently -- one bad field must never null out the rest,
// since a partially-readable receipt is still worth showing the user.

import { CATEGORIES, type Category } from './category';
import { merchantKey } from './merchant';
import { normalizeSpentOn } from './dates';
import { parseAmountToMinor, normalizeAmountText } from './money';

export type Extraction = {
  merchant: string | null;
  merchantKey: string | null;
  amountMinor: number | null;
  currency: string | null;
  totalValueRaw: string | null;
  totalSourceText: string | null;
  spentOn: string | null;
  category: Category | null;
};

const EMPTY_EXTRACTION: Extraction = {
  merchant: null,
  merchantKey: null,
  amountMinor: null,
  currency: null,
  totalValueRaw: null,
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

/** Validates the extraction model's wire shape into an Extraction. Never throws -- any
 * input that isn't the expected object shape simply yields all nulls. */
export function validateExtraction(raw: unknown, today: string): Extraction {
  if (!isRecord(raw)) return { ...EMPTY_EXTRACTION };

  const trimmedMerchant = asString(raw.merchant)?.trim() ?? '';
  const merchant = trimmedMerchant.length > 0 ? trimmedMerchant : null;

  const trimmedCurrency = asString(raw.currency)?.trim().toUpperCase() ?? null;
  const currency = trimmedCurrency !== null && CURRENCY_RE.test(trimmedCurrency) ? trimmedCurrency : null;

  // total_value is normalised here because real receipts (and models that
  // don't fully comply with the canonical-form instruction) print money as
  // "Rs 3,450.75" or "1.234,56" -- parseAmountToMinor stays strict and would
  // silently discard those. The normalised digits are kept even when the
  // currency is null (below) since the exponent, not the digits, is what's
  // actually unknowable in that case.
  const totalValueRaw = normalizeAmountText(asString(raw.total_value));

  // Exponent is unknown without a valid currency, so the amount cannot be scaled.
  const amountMinor = currency !== null && totalValueRaw !== null
    ? parseAmountToMinor(totalValueRaw, currency)
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
    totalValueRaw,
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
