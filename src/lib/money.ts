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

/** Turns printed money into the canonical decimal form `parseAmountToMinor`
 * demands (`.` decimal, no grouping), or null when the input is genuinely
 * ambiguous or not a number. `parseAmountToMinor` itself stays strict --
 * this is the explicit normalisation step in front of it, for the real
 * receipts that don't print the canonical form the model was asked for. */
export function normalizeAmountText(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  // South Asian receipts commonly total with "1850/-" or "1850/=" (the dash
  // marks "no paisa"), or a bare trailing "1850-". Strip that notation up
  // front, before the general symbol stripping below removes the "/" and
  // leaves a bare trailing dash indistinguishable from a negative sign. The
  // pattern only matches at the very end of the string, so a LEADING minus
  // ("-12.00", a genuine negative) is untouched and still rejected below.
  const withoutTrailingNotation = raw.trim().replace(/\/?[-=]\s*$/, '');

  // Drop currency words/codes and a trailing abbreviation dot ("Rs.", "PKR"),
  // then drop everything left that isn't a digit, separator, or minus sign
  // (symbols, whitespace, stray punctuation).
  const stripped = withoutTrailingNotation
    .replace(/\p{L}+\.?/gu, ' ')
    .replace(/[^0-9.,-]/g, '');
  if (stripped.length === 0) return null;
  if (stripped.includes('-')) return null; // reject negatives outright

  const dotCount = (stripped.match(/\./g) ?? []).length;
  const commaCount = (stripped.match(/,/g) ?? []).length;

  let digits: string;

  if (dotCount === 0 && commaCount === 0) {
    digits = stripped;
  } else if (dotCount > 0 && commaCount > 0) {
    // Both separators appear: the rightmost one is the decimal point, the
    // other is grouping. No locale guess needed -- the position settles it.
    const decimalChar = stripped.lastIndexOf('.') > stripped.lastIndexOf(',') ? '.' : ',';
    const groupChar = decimalChar === '.' ? ',' : '.';
    const decimalCount = decimalChar === '.' ? dotCount : commaCount;
    if (decimalCount !== 1) return null; // more than one decimal separator: invalid
    digits = stripped.split(groupChar).join('').replace(decimalChar, '.');
  } else {
    // Exactly one separator type, possibly repeated.
    const sep = dotCount > 0 ? '.' : ',';
    const count = dotCount > 0 ? dotCount : commaCount;
    const parts = stripped.split(sep);
    if (count === 1) {
      const [intPart, fracPart] = parts;
      if (fracPart.length === 0) return null; // trailing separator, no digits after
      if (fracPart.length === 3) {
        // A lone separator followed by exactly three digits is ambiguous
        // in general ("1,005" / "1.005") -- a leading zero on the group
        // means it could equally be a thousands group (1005) or a genuine
        // fraction (x.005), so refuse rather than guess. Without a leading
        // zero, fall back to the canonical role of each character: comma
        // reads as grouping ("1,234" -> 1234, the common receipt case),
        // dot reads as decimal ("12.345" -> a 3-decimal currency like KWD,
        // which parseAmountToMinor already expects '.' for).
        if (fracPart[0] === '0') return null;
        digits = sep === ',' ? intPart + fracPart : `${intPart}.${fracPart}`;
      } else {
        digits = `${intPart}.${fracPart}`;
      }
    } else {
      // Repeated grouping separator with no decimal shown at all -- every
      // group after the first must be exactly three digits, like real
      // thousands grouping.
      const [first, ...rest] = parts;
      if (first.length === 0 || first.length > 3 || rest.some((g) => g.length !== 3)) return null;
      digits = parts.join('');
    }
  }

  return /^\d+(\.\d+)?$/.test(digits) ? digits : null;
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
