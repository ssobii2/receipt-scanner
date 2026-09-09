// Money helpers. amount_minor is a persisted, integer value, so its scale
// (how many minor units make one major unit) must never move once written.
//
// WHY THE TABLE BELOW IS NOT DERIVED FROM Intl:
// Intl reports CLDR *display* digits, which encode local writing convention
// and differ between ICU builds shipped with different JS engines (observed:
// node's ICU says PKR has 0 minor digits, bun's says 2). If isoMinorDigits
// used Intl, the same stored amount_minor value would decode to a value 100x
// off depending on which runtime read it back. ISO 4217 is the fixed,
// engine-independent standard for how many minor units a currency has, so it
// is hand-coded here. Intl is only ever used for presentation (formatMoney).

const EXPONENT_0 = new Set([
  'BIF', 'BYR', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
  'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const EXPONENT_3 = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const EXPONENT_4 = new Set(['CLF', 'UYW']);

/** Number of minor units per major unit for a currency, per ISO 4217. */
export function isoMinorDigits(currency: string): number {
  const code = currency.toUpperCase();
  if (EXPONENT_0.has(code)) return 0;
  if (EXPONENT_3.has(code)) return 3;
  if (EXPONENT_4.has(code)) return 4;
  return 2;
}

const CANONICAL_DECIMAL_RE = /^\d+(\.\d+)?$/;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/** Parses a canonical decimal string (as normalised by the model upstream)
 * into integer minor units for `currency`, or null if the string isn't
 * canonical or the amount is not positive. Never uses float math to scale --
 * digit-string manipulation only, so precision holds at any magnitude. */
export function parseAmountToMinor(value: string, currency: string): number | null {
  const trimmed = value.trim();
  if (!CANONICAL_DECIMAL_RE.test(trimmed)) return null;

  const [intPart, fracPart = ''] = trimmed.split('.');
  const exponent = isoMinorDigits(currency);

  let combined: bigint;
  if (fracPart.length <= exponent) {
    combined = BigInt(intPart + fracPart.padEnd(exponent, '0'));
  } else {
    const kept = fracPart.slice(0, exponent);
    const firstDropped = fracPart[exponent];
    combined = BigInt(intPart + kept) + (firstDropped >= '5' ? 1n : 0n);
  }

  if (combined <= 0n) return null;

  // Guard in BigInt space, before converting to Number: Number(combined)
  // rounds silently once the value exceeds MAX_SAFE_INTEGER (e.g. the
  // absurd-total case scales to 1e+22 and comes back looking like a normal
  // number). Comparing the exact BigInt against the BigInt-cast ceiling
  // catches that up front, instead of laundering the precision loss through
  // a Number conversion first and inspecting the already-damaged result.
  if (combined > MAX_SAFE_BIGINT) return null;

  return Number(combined);
}

/** Formats integer minor units as a localized currency string. Fraction
 * digits are pinned to the ISO exponent (not left to the host's CLDR data)
 * so display always matches how the value is stored. */
export function formatMoney(minorUnits: number, currency: string, locale?: string): string {
  const digits = isoMinorDigits(currency);
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits).toString().padStart(digits + 1, '0');
  const major = digits === 0
    ? `${sign}${abs}`
    : `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;

  // minorUnits is only unsafe here because it arrived already corrupted
  // (parseAmountToMinor now refuses to produce such a value) -- e.g. a bad
  // row read back from storage. Number(major) + Intl would silently
  // re-round that already-bad double a second time (999999999999999999
  // minor units prints as $10,000,000,000,000,000.00, a different number
  // again). Skip Intl and emit the exact digit string we just built by hand
  // above, grouped ourselves, so the output is at least an honest echo of
  // what was stored rather than a second layer of silent rounding.
  if (!Number.isSafeInteger(minorUnits)) {
    const [intPart, fracPart] = major.split('.');
    const negative = intPart.startsWith('-');
    const digitsOnly = negative ? intPart.slice(1) : intPart;
    const grouped = digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const groupedMajor = `${negative ? '-' : ''}${grouped}${fracPart !== undefined ? `.${fracPart}` : ''}`;
    return `${currency.toUpperCase()} ${groupedMajor}`;
  }

  try {
    return new Intl.NumberFormat(locale ?? 'default', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(major));
  } catch {
    return `${currency.toUpperCase()} ${major}`;
  }
}
